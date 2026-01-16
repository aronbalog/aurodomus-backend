import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class GvsCroatiaParser extends BaseParser {
  parse(html: string): PriceEntry[] {
    const $ = cheerio.load(html);
    const prices: PriceEntry[] = [];

    try {
      // GVS Croatia uses Magento - look for product items with broader selectors
      $('.product-item, .products-grid .product, .product-item-info, [data-product-id], .item.product-item, li.item, .products-grid .item').each((_, element) => {
        const $product = $(element);
        
        // Helper function to extract BASE price (od 1 kom.) with multiple methods
        const extractPrice = (): string | null => {
          // GVS Croatia shows tiered pricing (od 1 kom, od 50 kom, od 100 kom)
          // We need to extract the "od 1 kom." price which is the base single-unit price
          
          // Method 1: Look for the displayed price text that corresponds to "od 1 kom."
          // This is more accurate than data-price-amount as it shows the actual formatted price
          // Structure: <div>od 1 kom.</div><div id="product-price-X"><span class="price">145,80 €</span></div>
          const productHtml = $product.html() || '';
          
          // Find "od 1 kom." followed by price in HTML
          // Look for: od 1 kom. ... data-price-amount="X" ... <span class="price">145,80 €</span>
          const pattern = /od\s+1\s+kom[^<]*<[^>]*data-price-amount="[\d.]+"\s*>[\s\S]*?<span[^>]*class="price"[^>]*>([\d.,\s]+€)/i;
          const match = productHtml.match(pattern);
          if (match && match[1]) {
            // Extract the displayed price (e.g., "145,80 €")
            const displayedPrice = match[1].trim();
            return displayedPrice;
          }
          
          // Method 2: Alternative pattern - simpler match for "od 1 kom" followed by price
          const simpleMatch = productHtml.match(/od\s+1\s+kom[^€]*?<span[^>]*>([\d.,\s]+€)<\/span>/i);
          if (simpleMatch && simpleMatch[1]) {
            return simpleMatch[1].trim();
          }
          
          // Method 3: Look for the product-price element with data-price-amount as fallback
          const $productPrice = $product.find('[id*="product-price"][data-price-amount]').first();
          if ($productPrice.length > 0) {
            // Get the displayed price from the span.price element
            const displayedPrice = $productPrice.find('.price').text().trim();
            if (displayedPrice) {
              return displayedPrice;
            }
            // Fallback to data-price-amount
            const dataPrice = $productPrice.attr('data-price-amount');
            if (dataPrice) {
              return dataPrice + ' €';
            }
          }
          
          // Method 3: Try standard price selectors as fallback
          // Prioritize selectors that typically contain base price
          const priceSelectors = [
            '[id*="product-price"]',  // Main product price
            '[data-price-amount]',  // Data attribute (usually base)
            '.price-box .price-final',  // Final price (usually base)
            '.regular-price',  // Regular price (base)
            '.price',  // Generic price (will get first one)
          ];
          
          for (const selector of priceSelectors) {
            const $priceEl = $product.find(selector).first();
            if ($priceEl.length > 0) {
              // Try text content - clean it first to extract only the price
              let priceText = $priceEl.text().trim();
              if (priceText && priceText.length >= 3 && /\d/.test(priceText)) {
                // Check if this is a base price (not quantity discount)
                // Base prices usually don't have "od X kom" or quantity indicators
                if (priceText.match(/od\s+\d+\s+kom/i)) {
                  // This is a quantity discount, skip and try next selector
                  continue;
                }
                
                // Extract the price from text - might contain extra text
                // Try European format first
                const europeanMatch = priceText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/i);
                const americanMatch = priceText.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:€|EUR|eur)/i);
                if (europeanMatch) {
                  return europeanMatch[0];
                } else if (americanMatch) {
                  return americanMatch[0];
                }
                // If no currency symbol, try to extract just the number pattern
                const numberMatch = priceText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
                if (numberMatch) {
                  return numberMatch[0] + (priceText.includes('€') ? ' €' : '');
                }
                // Return as-is if it looks like a valid price
                return priceText;
              }
              
              // Try data attributes - these are usually already numeric, but may have formatting
              const dataPrice = $priceEl.attr('data-price-amount') || 
                               $priceEl.attr('data-price') ||
                               $priceEl.attr('data-price-final');
              if (dataPrice) {
                // Data attributes might be numeric or formatted - parse and return as European format
                const parsed = this.parsePrice(dataPrice);
                if (parsed !== null) {
                  // Return in European format for consistency
                  return parsed.toFixed(2).replace('.', ',') + ' €';
                }
                return `${dataPrice} €`;
              }
              
              // Try inner HTML for formatted prices
              const priceHtml = $priceEl.html() || '';
              // European format: dots for thousands, comma for decimal (e.g., "169,30" or "1.325,80")
              const htmlEuropeanMatch = priceHtml.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/);
              // American format: commas for thousands, dot for decimal (e.g., "1,234.56")
              const htmlAmericanMatch = priceHtml.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:€|EUR|eur)/);
              if (htmlEuropeanMatch) {
                return htmlEuropeanMatch[0];
              } else if (htmlAmericanMatch) {
                return htmlAmericanMatch[0];
              }
            }
          }
          
          // Method 4: Search in product text for "od 1 kom." pattern
          const productText = $product.text();
          
          // Try to find base price (single unit price from "od 1 kom.")
          // Use a more flexible pattern that handles whitespace and HTML structure
          const lines = productText.split('\n').map(l => l.trim());
          for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].match(/od\s+1\s+kom/i)) {
              // Next few lines should contain the price
              for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const priceMatch = lines[j].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
                if (priceMatch && priceMatch[1]) {
                  return priceMatch[1] + ' €';
                }
              }
            }
          }
          
          // If still not found, try all European patterns and take the FIRST price only
          // (In GVS structure, first price is "od 1 kom." base price)
          const allEuropeanMatches = Array.from(productText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/gi));
          if (allEuropeanMatches.length > 0 && allEuropeanMatches[0][1]) {
            // Take FIRST price (not highest) as it's the base price in GVS structure
            return allEuropeanMatches[0][1] + ' €';
          }
          
          // Method 5: Check product HTML for base price with data-price-amount
          // This is the most reliable source for GVS Croatia
          const htmlContent = $product.html() || '';
          const dataPriceMatch = htmlContent.match(/data-price-amount="([\d.]+)"/);
          if (dataPriceMatch && dataPriceMatch[1]) {
            return dataPriceMatch[1] + ' €';
          }
          
          return null;
        };
        
        const priceText = extractPrice();
        
        if (priceText) {
          // Parse the main price first
          let mainPrice = this.parsePrice(priceText);
          
          if (mainPrice !== null) {
            // Extract product title and link
            const $titleEl = $product.find('a.product-item-link, .product-name a, h2 a, h3 a, .product-name a').first();
            const productTitle = ($titleEl.text() || $product.find('h2, h3, .product-name').text()).trim();
            const productLink = $titleEl.attr('href') || '';
            const fullProductLink = productLink 
              ? (productLink.startsWith('http') ? productLink : new URL(productLink, this.vendorUrl).toString())
              : undefined;
            
            const productText = ($product.text() + ' ' + productTitle).toLowerCase();
            
            // Extract ALL price types: regular, discounted, current
            let regularPrice: number | null = null;
            let discountedPrice: number | null = null;
            let currentPrice: number | null = null;
            
            // Find price container for comprehensive price extraction
            const $priceBox = $product.find('.price-box, .price, [class*="price"]').first();
            
            if ($priceBox.length > 0) {
              // Method 1: Extract regular/old price (from <del> or .old-price)
              const $oldPrice = $priceBox.find('del .price, del .amount, .old-price, .regular-price, del');
              if ($oldPrice.length > 0) {
                const oldPriceText = $oldPrice.text().trim();
                regularPrice = this.parsePrice(oldPriceText);
              }
              
              // Method 2: Extract discounted/sale price (from .special-price or <ins>)
              const $salePrice = $priceBox.find('.special-price, .sale-price, ins .price, ins .amount, ins');
              if ($salePrice.length > 0) {
                const salePriceText = $salePrice.text().trim();
                discountedPrice = this.parsePrice(salePriceText);
              }
              
              // Method 3: Extract current price (not in <del>)
              const $finalPrice = $priceBox.find('.price-final, .final-price, .amount').not('del .price, del .amount, del');
              if ($finalPrice.length > 0) {
                const finalPriceText = $finalPrice.text().trim();
                currentPrice = this.parsePrice(finalPriceText);
              }
              
              // Method 4: Parse HTML to find multiple prices
              const priceHtml = $priceBox.html() || '';
              
              // Look for regular price in <del> tag
              if (!regularPrice) {
                const delMatch = priceHtml.match(/<del[^>]*>([\s\S]*?)<\/del>/i);
                if (delMatch && delMatch[1]) {
                  const delPriceMatch = delMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
                  if (delPriceMatch && delPriceMatch[1]) {
                    regularPrice = this.parsePrice(delPriceMatch[1] + ' €');
                  }
                }
              }
              
              // Look for discounted price in <ins> or special-price
              if (!discountedPrice) {
                const insMatch = priceHtml.match(/<ins[^>]*>([\s\S]*?)<\/ins>/i);
                if (insMatch && insMatch[1]) {
                  const insPriceMatch = insMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
                  if (insPriceMatch && insPriceMatch[1]) {
                    discountedPrice = this.parsePrice(insPriceMatch[1] + ' €');
                  }
                }
              }
              
              // Method 5: Find all prices in the container and identify by position
              if (!regularPrice || !discountedPrice) {
                const allPrices = Array.from(priceHtml.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/g));
                if (allPrices.length > 1) {
                  const parsedPrices = allPrices
                    .map(m => this.parsePrice(m[1] + ' €'))
                    .filter(p => p !== null && p > 0) as number[];
                  
                  if (parsedPrices.length >= 2) {
                    // Usually: first/higher price is regular, second/lower is discounted
                    const sortedPrices = [...parsedPrices].sort((a, b) => b - a);
                    if (!regularPrice) regularPrice = sortedPrices[0];
                    if (!discountedPrice && sortedPrices[sortedPrices.length - 1] < sortedPrices[0]) {
                      discountedPrice = sortedPrices[sortedPrices.length - 1];
                    }
                  }
                }
              }
            }
            
            // Use mainPrice as fallback for currentPrice
            if (!currentPrice) {
              currentPrice = mainPrice;
            }
            
            // Logic: if regular > current and no discounted, current IS discounted
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
            
            // Determine final main price: discounted || current || regular
            const finalMainPrice = discountedPrice || currentPrice || regularPrice || mainPrice;
            
            let unit = 'gram';
            let weight: number | null = null;
            
            // Patterns to match weights like "1g", "100g", "1kg", "1 unca", etc.
            const weightPatterns = [
              /(\d+(?:[.,]\d+)?)\s*(g|gram|gr)\b/i,
              /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo)\b/i,
              /(\d+(?:[.,]\d+)?)\s*(oz|ounce|unca|unca troy)\b/i,
              /^(\d+(?:[.,]\d+)?)\s*(g|kg|oz)\b/i, // At start of title like "1g zlatna poluga"
            ];
            
            for (const pattern of weightPatterns) {
              const match = productText.match(pattern);
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

            // If still no weight found, try looking for links or filters with weight info
            if (!weight) {
              $product.find('a[href*="unze_gewicht"], a[href*="gewicht"]').each((_, link) => {
                const href = $(link).attr('href') || '';
                const weightMatch = href.match(/unze_gewicht=(\d+)|gewicht=(\d+)/);
                if (weightMatch) {
                  const w = parseInt(weightMatch[1] || weightMatch[2], 10);
                  if (w < 100) {
                    unit = 'gram';
                    weight = w;
                  } else {
                    unit = 'gram';
                    weight = w;
                    if (w >= 1000) {
                      weight = w / 1000;
                      unit = 'kg';
                    }
                  }
                }
              });
            }

            // GVS Croatia - check if there are separate buy/sell prices
            let buyPrice: number | null = null;
            let sellPrice: number | null = null;
            const productTextForPrice = $product.text();
            
            // Look for buy/sell price labels - use precise European format patterns
            const buyEuropeanMatch = productTextForPrice.match(/kupnja[:\s]+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
            const buyAmericanMatch = productTextForPrice.match(/kupnja[:\s]+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
            const sellEuropeanMatch = productTextForPrice.match(/(?:prodaja|prodajna)[:\s]+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
            const sellAmericanMatch = productTextForPrice.match(/(?:prodaja|prodajna)[:\s]+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
            
            const buyMatch = buyEuropeanMatch || buyAmericanMatch;
            const sellMatch = sellEuropeanMatch || sellAmericanMatch;
            
            if (buyMatch) {
              buyPrice = this.parsePrice(buyMatch[1]);
            }
            if (sellMatch) {
              sellPrice = this.parsePrice(sellMatch[1]);
            }
            
            // Use sell price if found, otherwise use main price
            const finalPrice = sellPrice || finalMainPrice;
            
            // Validate price makes sense - for gold bars, prices should be reasonable
            // 1g should be roughly 100-200 EUR, larger bars proportionally more
            if (finalPrice !== null && weight) {
              const pricePerGram = finalPrice / weight;
              // If price per gram is way too high (>500) or too low (<50), might be wrong
              if (pricePerGram > 500 || pricePerGram < 50) {
                // Skip this price - likely extraction error
                return;
              }
            }
            
            // GVS Croatia typically shows sell prices (buying from them)
            prices.push({
              unit,
              price: finalPrice || undefined,
              regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
              discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
              buyPrice: buyPrice ? buyPrice : undefined,
              sellPrice: finalPrice || undefined,
              productTitle: productTitle || undefined,
              productLink: fullProductLink,
            });
          }
        }
      });

      // Alternative: Look for any product list items or grid items with enhanced price extraction
      if (prices.length === 0) {
        $('li.item, .product-list-item, .category-products .item, .product-item').each((_, element) => {
          const $item = $(element);
          
          // Try multiple price extraction methods
          let priceText: string | null = null;
          const priceSelectors = [
            '.price',
            '.price-box .price',
            '[class*="price"]',
            '[data-price-amount]',
            '.product-price',
          ];
          
          for (const selector of priceSelectors) {
            const $price = $item.find(selector).first();
            if ($price.length > 0) {
              priceText = $price.text().trim();
              
              // Try data attributes if text is empty
              if (!priceText || priceText.length < 3) {
                const dataPrice = $price.attr('data-price-amount') || 
                                 $price.attr('data-price');
                if (dataPrice) {
                  priceText = `${dataPrice} €`;
                }
              }
              
              // Try HTML content
              if (!priceText || priceText.length < 3) {
                const priceHtml = $price.html() || '';
                // European format: dots for thousands, comma for decimal
                const htmlEuropeanMatch = priceHtml.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/);
                // American format: commas for thousands, dot for decimal
                const htmlAmericanMatch = priceHtml.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:€|EUR|eur)/);
                if (htmlEuropeanMatch) {
                  priceText = htmlEuropeanMatch[0];
                } else if (htmlAmericanMatch) {
                  priceText = htmlAmericanMatch[0];
                }
              }
              
              if (priceText && priceText.length >= 3) {
                break;
              }
            }
          }
          
          // Fallback: search in item text
          if (!priceText || priceText.length < 3) {
            const itemText = $item.text();
            // European format: dots for thousands, comma for decimal
            const europeanMatch = itemText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/i);
            // American format: commas for thousands, dot for decimal
            const americanMatch = itemText.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:€|EUR|eur)/i);
            if (europeanMatch) {
              priceText = europeanMatch[0];
            } else if (americanMatch) {
              priceText = americanMatch[0];
            }
          }
          
          if (priceText) {
            const price = this.parsePrice(priceText);
            const itemText = $item.text().toLowerCase();
            
            if (price !== null && price > 0) {
              let unit = 'gram';
              
              // Extract unit from item text
              const weightPatterns = [
                /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo)\b/i,
                /(\d+(?:[.,]\d+)?)\s*(oz|ounce|unca)\b/i,
                /(\d+(?:[.,]\d+)?)\s*(g|gram|gr)\b/i,
              ];
              
              for (const pattern of weightPatterns) {
                const match = itemText.match(pattern);
                if (match) {
                  unit = this.normalizeUnit(match[2]);
                  break;
                }
              }
              
              // Extract product title and link
              const $titleLink = $item.find('a.product-item-link, .product-name a, h2 a, h3 a, a').first();
              const productTitle = $titleLink.text().trim() || $item.find('h2, h3, .product-name').text().trim();
              const productLink = $titleLink.attr('href');
              const fullProductLink = productLink 
                ? (productLink.startsWith('http') ? productLink : new URL(productLink, this.vendorUrl).toString())
                : undefined;
              
              prices.push({
                unit,
                price,
                sellPrice: price,
                productTitle: productTitle || undefined,
                productLink: fullProductLink,
              });
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error parsing GVS Croatia HTML:`, error);
    }

    // Remove duplicates
    const uniquePrices: PriceEntry[] = [];
    const seen = new Set<string>();
    prices.forEach((p) => {
      const key = `${p.unit}-${Math.round((p.price || p.sellPrice || 0) * 100) / 100}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePrices.push(p);
      }
    });

    return uniquePrices;
  }
}
