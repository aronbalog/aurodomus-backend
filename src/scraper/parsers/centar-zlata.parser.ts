import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry, VendorPriceData } from '../interfaces/price.interface';

// Import cheerio types for proper typing
type CheerioAPI = ReturnType<typeof cheerio.load>;

export class CentarZlataParser extends BaseParser {
  /**
   * Fetch all prices (regular, discounted, current) from individual product page for accuracy
   */
  private async fetchProductPrices(productUrl: string): Promise<{ regularPrice?: number; discountedPrice?: number; currentPrice?: number } | null> {
    try {
      const response = await this.axiosInstance.get(productUrl);
      const $ = cheerio.load(response.data);
      
      let regularPrice: number | null = null;
      let discountedPrice: number | null = null;
      let currentPrice: number | null = null;
      
      // Method 1: Look for all price types in WooCommerce structure
      const $priceContainer = $('.price, .woocommerce-Price-amount, .product-price, .summary .price').first();
      if ($priceContainer.length > 0) {
        // Extract regular price (in <del> tag)
        const $regularPriceEl = $priceContainer.find('del .woocommerce-Price-amount, del bdi, del .amount, del').first();
        if ($regularPriceEl.length > 0) {
          const regularText = $regularPriceEl.text().trim();
          const regularMatch = regularText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
          if (regularMatch && regularMatch[1]) {
            regularPrice = this.parsePrice(regularMatch[1] + ' €');
          } else {
            regularPrice = this.parsePrice(regularText);
          }
        }
        
        // Extract discounted price (in <ins> tag)
        const $discountedPriceEl = $priceContainer.find('ins .woocommerce-Price-amount, ins bdi, ins .amount, ins').first();
        if ($discountedPriceEl.length > 0) {
          const discountedText = $discountedPriceEl.text().trim();
          const discountedMatch = discountedText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
          if (discountedMatch && discountedMatch[1]) {
            discountedPrice = this.parsePrice(discountedMatch[1] + ' €');
            currentPrice = discountedPrice; // Discounted is current
          } else {
            discountedPrice = this.parsePrice(discountedText);
            currentPrice = discountedPrice;
          }
        }
        
        // Extract current price (not in del)
        if (!currentPrice) {
          const $currentPriceEl = $priceContainer.find('.woocommerce-Price-amount, bdi, .amount').not($priceContainer.find('del .woocommerce-Price-amount, del bdi, del .amount')).first();
          if ($currentPriceEl.length > 0) {
            const currentText = $currentPriceEl.text().trim();
            const currentMatch = currentText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
            if (currentMatch && currentMatch[1]) {
              currentPrice = this.parsePrice(currentMatch[1] + ' €');
            } else {
              currentPrice = this.parsePrice(currentText);
            }
          }
        }
        
        // Method 2: Get from HTML (excluding del)
        if (!currentPrice) {
          const priceHtml = $priceContainer.html() || '';
          const cleanedHtml = priceHtml.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');
          const priceMatch = cleanedHtml.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
          if (priceMatch && priceMatch[1]) {
            currentPrice = this.parsePrice(priceMatch[1] + ' €');
          }
        }
        
        // Method 3: Try data attributes
        if (!currentPrice) {
          const dataPrice = $priceContainer.attr('data-price') || 
                           $('[data-price-amount]').first().attr('data-price-amount') ||
                           $('[data-price]').first().attr('data-price');
          if (dataPrice) {
            currentPrice = this.parsePrice(dataPrice);
          }
        }
      }
      
      // Method 4: Search in summary section
      if (!currentPrice) {
        const $summary = $('.summary, .product-info, .product-details, .entry-summary').first();
        if ($summary.length > 0) {
          const summaryHtml = $summary.html() || '';
          const cleanedSummary = summaryHtml.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');
          const summaryPriceMatch = cleanedSummary.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
          if (summaryPriceMatch && summaryPriceMatch[1]) {
            const price = this.parsePrice(summaryPriceMatch[1] + ' €');
            if (price !== null && price > 0 && price < 500) {
              currentPrice = price;
            }
          }
        }
      }
      
      // Return all found prices
      if (regularPrice || discountedPrice || currentPrice) {
        return {
          regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
          discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
          currentPrice: currentPrice !== null && currentPrice > 0 ? currentPrice : undefined,
        };
      }
    } catch (error) {
      // If fetching product page fails, return null
      return null;
    }
    return null;
  }

  parse(html: string): PriceEntry[] {
    const $ = cheerio.load(html);
    const prices: PriceEntry[] = [];

    try {
      // Centar Zlata uses WooCommerce - look for product items
      $('li.product, .product.type-product, .wc-block-grid__product, ul.products li.product').each((_, element) => {
        const $product = $(element);
        
        // Get product title/text to extract weight
        const $titleLink = $product.find('h2 a, h3 a, .woocommerce-loop-product__title a, .wp-block-post-title a, a.woocommerce-LoopProduct-link, .product-title a').first();
        const productTitle = ($titleLink.text() || $product.find('h2, h3, .woocommerce-loop-product__title, .wp-block-post-title, .product-title').text()).trim();
        const productLink = $titleLink.attr('href');
        const fullProductLink = productLink 
          ? (productLink.startsWith('http') ? productLink : new URL(productLink, this.vendorUrl).toString())
          : undefined;
        const productText = $product.text();

        // Look for ALL prices - regular, discounted, current
        // WooCommerce typically uses: .price > del (regular) and .price > ins (discounted/current)
        let regularPriceText = '';
        let discountedPriceText = '';
        let currentPriceText = '';
        
        const $priceContainer = $product.find('.price').first();
        if ($priceContainer.length > 0) {
          // Get the full HTML of the price container to extract all prices
          const priceHtml = $priceContainer.html() || '';
          
          // Extract regular price (usually in <del> tag - crossed out)
          const $regularPrice = $priceContainer.find('del .woocommerce-Price-amount, del bdi, del .amount, del').first();
          if ($regularPrice.length > 0) {
            regularPriceText = $regularPrice.text().trim();
            // Also try to extract from del tag directly in HTML
            const delMatch = priceHtml.match(/<del[^>]*>([\s\S]*?)<\/del>/i);
            if (delMatch && delMatch[1]) {
              const delPriceMatch = delMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
              if (delPriceMatch && delPriceMatch[1]) {
                regularPriceText = delPriceMatch[1] + ' €';
              }
            }
          }
          
          // Extract discounted/sale price (usually in <ins> tag)
          const $discountedPrice = $priceContainer.find('ins .woocommerce-Price-amount, ins bdi, ins .amount, ins').first();
          if ($discountedPrice.length > 0) {
            discountedPriceText = $discountedPrice.text().trim();
            currentPriceText = discountedPriceText; // Discounted price is the current price
            // Also try to extract from ins tag directly in HTML
            const insMatch = priceHtml.match(/<ins[^>]*>([\s\S]*?)<\/ins>/i);
            if (insMatch && insMatch[1]) {
              const insPriceMatch = insMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
              if (insPriceMatch && insPriceMatch[1]) {
                discountedPriceText = insPriceMatch[1] + ' €';
                currentPriceText = discountedPriceText;
              }
            }
          } else {
            // If no <ins> tag, try price amount that's NOT inside <del> (current price)
            const $currentPrice = $priceContainer.find('.woocommerce-Price-amount, bdi, .amount').not($priceContainer.find('del .woocommerce-Price-amount, del bdi, del .amount')).first();
            if ($currentPrice.length > 0) {
              currentPriceText = $currentPrice.text().trim();
            } else {
              // Get text from price container but exclude del text
              const cleanedHtml = priceHtml.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');
              const $cleaned = cheerio.load(cleanedHtml);
              const cleanedText = $cleaned('body').text().trim();
              if (cleanedText && cleanedText.length >= 3) {
                currentPriceText = cleanedText;
              }
            }
          }
          
          // If we have regular price but no discounted, check if there are multiple prices in the container
          if (regularPriceText && !discountedPriceText) {
            // Find all prices in the container
            const allPrices = Array.from(priceHtml.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/g));
            if (allPrices.length > 1) {
              // Parse all prices and find the lowest one (discounted is usually lower)
              const parsedPrices = allPrices.map(m => ({
                text: m[1] + ' €',
                value: this.parsePrice(m[1] + ' €')
              })).filter(p => p.value !== null && p.value > 0);
              
              if (parsedPrices.length > 1) {
                const regularParsed = this.parsePrice(regularPriceText);
                // Find the lowest price that's less than regular (discounted price)
                const discounted = parsedPrices.find(p => p.value && regularParsed && p.value < regularParsed);
                if (discounted) {
                  discountedPriceText = discounted.text;
                  currentPriceText = discounted.text;
                } else {
                  // If no discounted found, use the lowest price as current
                  const lowest = parsedPrices.reduce((min, p) => (p.value && (!min || p.value < min)) ? p.value : min, null as number | null);
                  if (lowest && regularParsed && lowest < regularParsed) {
                    discountedPriceText = parsedPrices.find(p => p.value === lowest)?.text || '';
                    currentPriceText = discountedPriceText;
                  }
                }
              }
            }
          }
          
          // If we still don't have both prices, try to find them from the full HTML structure
          if (!regularPriceText || !discountedPriceText) {
            // Look for all price elements in the product
            const allPriceElements = $product.find('.price, .woocommerce-Price-amount, [class*="price"]');
            const foundPrices: Array<{text: string, value: number | null, isDel: boolean}> = [];
            
            allPriceElements.each((_, el) => {
              const $el = $(el);
              const isDel = $el.closest('del').length > 0 || $el.parents('del').length > 0;
              const text = $el.text().trim();
              const priceMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
              if (priceMatch && priceMatch[1]) {
                const value = this.parsePrice(priceMatch[1] + ' €');
                if (value !== null && value > 0) {
                  foundPrices.push({text: priceMatch[1] + ' €', value, isDel});
                }
              }
            });
            
            // If we found multiple prices, identify regular (del/higher) and discounted (lower)
            if (foundPrices.length >= 2) {
              const delPrices = foundPrices.filter(p => p.isDel);
              const nonDelPrices = foundPrices.filter(p => !p.isDel);
              
              if (delPrices.length > 0 && nonDelPrices.length > 0) {
                // Regular price is from del (usually higher)
                const regular = delPrices.reduce((max, p) => (p.value && (!max || p.value > max)) ? p.value : max, null as number | null);
                // Discounted is from non-del (usually lower)
                const discounted = nonDelPrices.reduce((min, p) => (p.value && (!min || p.value < min)) ? p.value : min, null as number | null);
                
                if (regular && discounted && discounted < regular) {
                  if (!regularPriceText) regularPriceText = delPrices.find(p => p.value === regular)?.text || '';
                  if (!discountedPriceText) {
                    discountedPriceText = nonDelPrices.find(p => p.value === discounted)?.text || '';
                    currentPriceText = discountedPriceText;
                  }
                }
              } else if (foundPrices.length >= 2) {
                // No del tags, but we have multiple prices - highest is regular, lowest is discounted
                const sorted = foundPrices.sort((a, b) => (b.value || 0) - (a.value || 0));
                const highest = sorted[0];
                const lowest = sorted[sorted.length - 1];
                
                if (highest.value && lowest.value && highest.value > lowest.value) {
                  if (!regularPriceText) regularPriceText = highest.text;
                  if (!discountedPriceText) {
                    discountedPriceText = lowest.text;
                    currentPriceText = lowest.text;
                  }
                }
              }
            }
          }
        }
        
        // If no prices found in price container, try other selectors
        if ((!regularPriceText && !discountedPriceText && !currentPriceText)) {
          const priceSelectors = [
            '.sale-price',
            '.current-price',
            '.price-final',
            '.woocommerce-Price-amount:not(del .woocommerce-Price-amount)',
            '.amount:not(del .amount)',
            '[class*="price"]:not(:has(del))',
            '.fusion-price-rating .price',
          ];
          
          for (const selector of priceSelectors) {
            const $priceEl = $product.find(selector).first();
            if ($priceEl.length > 0 && !$priceEl.closest('del').length) {
              const candidate = $priceEl.text().trim();
              if (candidate && candidate.length >= 3 && /\d/.test(candidate)) {
                currentPriceText = candidate;
                break;
              }
            }
          }
        }
        
        // Also check data attributes
        if ((!regularPriceText && !discountedPriceText && !currentPriceText)) {
          let dataPrice: string | undefined = undefined;
          if ($priceContainer.length > 0) {
            dataPrice = $priceContainer.attr('data-price') || 
                       $priceContainer.find('[data-price-amount]').first().attr('data-price-amount') ||
                       $priceContainer.find('[data-price]').first().attr('data-price') ||
                       undefined;
          }
          if (!dataPrice) {
            dataPrice = $product.find('[data-price-amount]').first().attr('data-price-amount') ||
                       $product.find('[data-price]').first().attr('data-price') ||
                       $product.find('[data-price-final]').first().attr('data-price-final') ||
                       undefined;
          }
          if (dataPrice) {
            const parsed = this.parsePrice(dataPrice);
            if (parsed !== null) {
              currentPriceText = parsed.toFixed(2).replace('.', ',') + ' €';
            }
          }
        }
        
        // If still no prices, search in product text
        if ((!regularPriceText && !discountedPriceText && !currentPriceText)) {
          // Look for base price patterns
          const basePricePatterns = [
            /(?:od\s+1\s+kom\.|jedinična\s+cijena)[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/i,
          ];
          
          for (const pattern of basePricePatterns) {
            const match = productText.match(pattern);
            if (match && match[1]) {
              currentPriceText = match[1] + ' €';
              break;
            }
          }
          
          // Find all prices in product text
          if (!currentPriceText) {
            const productHtml = $product.html() || '';
            const cleanedHtml = productHtml.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');
            const currentPriceMatch = cleanedHtml.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
            if (currentPriceMatch && currentPriceMatch[1]) {
              currentPriceText = currentPriceMatch[1] + ' €';
            } else {
              const allEuropeanMatches = Array.from(productText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/gi));
              if (allEuropeanMatches.length > 0) {
                currentPriceText = allEuropeanMatches[0][1] + ' €';
              }
            }
          }
        }

        // Parse all price types
        let regularPrice = regularPriceText ? this.parsePrice(regularPriceText) : null;
        let discountedPrice = discountedPriceText ? this.parsePrice(discountedPriceText) : null;
        let currentPrice = currentPriceText ? this.parsePrice(currentPriceText) : null;
        
        // If we have both regular and current but no discounted, and current < regular, treat current as discounted
        if (regularPrice && currentPrice && !discountedPrice && currentPrice < regularPrice) {
          discountedPrice = currentPrice;
        }
        
        // If we have regular but no current/discounted, use regular as current
        if (regularPrice && !currentPrice && !discountedPrice) {
          currentPrice = regularPrice;
        }
        
        // Validate: don't set regularPrice and discountedPrice to the same value
        if (regularPrice && discountedPrice && Math.abs(regularPrice - discountedPrice) < 0.01) {
          // Same price - no actual discount, clear regular price
          regularPrice = null;
        }
        
        // Determine which price to use as the main price
        // Priority: discounted > current > regular
        const mainPrice = discountedPrice || currentPrice || regularPrice;
        
        if (mainPrice !== null) {
            // Extract weight/unit from product title or text FIRST
            let unit = 'gram';
            let weight: number | null = null;
            
            // Try to extract weight from title/text
            const textLower = (productTitle + ' ' + productText).toLowerCase();
            
            // Match patterns like "1g", "100g", "1 kg", "31,1035 g", "1 unca", etc.
            const weightPatterns = [
              /(\d+(?:[.,]\d+)?)\s*(g|gram|gr)\b/i,
              /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo)\b/i,
              /(\d+(?:[.,]\d+)?)\s*(oz|ounce|unca|unca troy)\b/i,
              /~?(\d+(?:[.,]\d+)?)\s*g/i, // like "~31,1035 g"
            ];
            
            for (const pattern of weightPatterns) {
              const match = textLower.match(pattern);
              if (match) {
                weight = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
                const unitStr = match[2].toLowerCase();
                
                // Normalize unit
                if (unitStr.includes('kg') || unitStr.includes('kilogram') || unitStr.includes('kilo')) {
                  unit = 'kg';
                } else if (unitStr.includes('oz') || unitStr.includes('ounce') || unitStr.includes('unca')) {
                  unit = 'ounce';
                } else {
                  unit = 'gram';
                  
                  // Convert grams to kg if >= 1000
                  if (weight && weight >= 1000) {
                    weight = weight / 1000;
                    unit = 'kg';
                  }
                }
                break;
              }
            }

            // If no weight found, try to infer from common patterns
            if (!weight) {
              if (textLower.includes('1000') || textLower.includes('1.000')) {
                unit = 'kg';
                weight = 1;
              } else if (textLower.includes('500')) {
                unit = 'gram';
                weight = 500;
              } else if (textLower.includes('250')) {
                unit = 'gram';
                weight = 250;
              } else if (textLower.includes('100')) {
                unit = 'gram';
                weight = 100;
              } else if (textLower.includes('50')) {
                unit = 'gram';
                weight = 50;
              } else if (textLower.includes('31') || textLower.includes('unca')) {
                unit = 'ounce';
                weight = 1;
              } else if (textLower.includes('20')) {
                unit = 'gram';
                weight = 20;
              } else if (textLower.includes('10')) {
                unit = 'gram';
                weight = 10;
              } else if (textLower.includes('5')) {
                unit = 'gram';
                weight = 5;
              } else if (textLower.includes('1 g') || textLower.match(/^1g|^1\s+g/)) {
                unit = 'gram';
                weight = 1;
              }
            }

            // Show scraped prices as-is, without normalization to per-unit
            // The price represents the actual product price (e.g., 80,000 EUR for a 1kg bar)
            
            // Basic validation: only skip prices that are clearly invalid
            if (mainPrice <= 0 || mainPrice > 1000000) {
              return; // Skip invalid prices
            }

            // Store all price types
            prices.push({
              unit,
              price: mainPrice, // Main/current price
              sellPrice: mainPrice, // For compatibility
              regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
              discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
              productTitle: productTitle || undefined,
              productLink: fullProductLink,
            });
          }
      });

      // If still no prices, try alternative parsing from tables or lists
      if (prices.length === 0) {
        // Look for any EUR prices in the document - prioritize current prices
        const bodyText = $('body').text();
        // Find all European format prices and take the highest (current prices are usually higher than old ones)
        const allEuropeanMatches = Array.from(bodyText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/gi));
        const europeanPrices: number[] = [];
        for (const match of allEuropeanMatches) {
          if (match[1]) {
            const parsed = this.parsePrice(match[1] + ' €');
            if (parsed !== null && parsed > 100 && parsed < 100000) {
              europeanPrices.push(parsed);
            }
          }
        }
        
        // Use unique prices, sorted (highest first - current prices are usually higher)
        const uniquePrices = Array.from(new Set(europeanPrices)).sort((a, b) => b - a);
        for (const price of uniquePrices.slice(0, 20)) { // Limit to top 20 to avoid duplicates
          prices.push({
            unit: 'gram',
            price,
            sellPrice: price,
          });
        }
      }
    } catch (error) {
      console.error(`Error parsing Centar Zlata HTML:`, error);
    }

    // Remove duplicates and sort
    const uniquePrices: PriceEntry[] = [];
    const seen = new Set<string>();
    prices.forEach((p) => {
      const key = `${p.unit}-${p.price || p.sellPrice || ''}-${p.productTitle || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePrices.push(p);
      }
    });

    return uniquePrices;
  }

  /**
   * Override scrape method to visit product pages for accurate current prices
   */
  async scrape(progressCallback?: (progress: number) => void): Promise<VendorPriceData> {
    // First, get prices from listing page using parent scrape method
    const result = await super.scrape(progressCallback);
    
    // For key products (1g products especially), visit product pages to get accurate current prices
    // This ensures we get the most up-to-date prices from the actual product page
    const keyProducts = result.prices.filter(p => 
      p.productLink && 
      p.productTitle?.toLowerCase().includes('1g') &&
      p.unit === 'gram'
    ).slice(0, 10); // Limit to first 10 1g products to avoid too many requests
    
    // Update prices from product pages (get all price types)
    for (let i = 0; i < keyProducts.length; i++) {
      const product = keyProducts[i];
      if (product.productLink) {
        try {
          const productPagePrices = await this.fetchProductPrices(product.productLink);
          if (productPagePrices) {
            const priceIndex = result.prices.findIndex(p => 
              p.productLink === product.productLink && 
              p.unit === product.unit &&
              p.productTitle === product.productTitle
            );
            if (priceIndex >= 0) {
              // Update with all price types from product page (product page is more accurate)
              if (productPagePrices.regularPrice) {
                result.prices[priceIndex].regularPrice = productPagePrices.regularPrice;
              }
              if (productPagePrices.discountedPrice) {
                result.prices[priceIndex].discountedPrice = productPagePrices.discountedPrice;
                // If we have a discounted price, use it as the current price
                result.prices[priceIndex].price = productPagePrices.discountedPrice;
                result.prices[priceIndex].sellPrice = productPagePrices.discountedPrice;
              } else if (productPagePrices.currentPrice) {
                result.prices[priceIndex].price = productPagePrices.currentPrice;
                result.prices[priceIndex].sellPrice = productPagePrices.currentPrice;
              }
            }
          }
          // Small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 400));
        } catch (error) {
          // If product page fetch fails, keep listing page price
          continue;
        }
      }
    }
    
    return result;
  }
}
