import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class MoroParser extends BaseParser {
  parse(html: string): PriceEntry[] {
    const $ = cheerio.load(html);
    const prices: PriceEntry[] = [];

    try {
      // MORO uses WooCommerce - look for product items
      $('li.product, .product.type-product, .wc-block-grid__product, article.product, ul.products li').each((_, element) => {
        const $product = $(element);
        
        // Get product title/text to extract weight
        const $titleLink = $product.find('h2 a, h3 a, .woocommerce-loop-product__title a, .wp-block-post-title a, a.woocommerce-LoopProduct-link').first();
        const productTitle = ($titleLink.text() || $product.find('h2, h3, .woocommerce-loop-product__title, .wp-block-post-title').text()).trim();
        const productLink = $titleLink.attr('href');
        const fullProductLink = productLink 
          ? (productLink.startsWith('http') ? productLink : new URL(productLink, this.vendorUrl).toString())
          : undefined;
        const productText = $product.text();

        // Extract ALL price types from WooCommerce structure: regular, discounted, current
        let regularPrice: number | null = null;
        let discountedPrice: number | null = null;
        let currentPrice: number | null = null;
        let priceText = '';
        
        // Find the main price container
        const $priceContainer = $product.find('.price').first();
        
        if ($priceContainer.length > 0) {
          // Method 1: Extract regular price from <del> tag (WooCommerce standard)
          const $regularPriceEl = $priceContainer.find('del .woocommerce-Price-amount, del bdi, del .amount, del').first();
          if ($regularPriceEl.length > 0) {
            const regularText = $regularPriceEl.text().trim();
            regularPrice = this.parsePrice(regularText);
          }
          
          // Method 2: Extract discounted/sale price from <ins> tag (WooCommerce standard)
          const $discountedPriceEl = $priceContainer.find('ins .woocommerce-Price-amount, ins bdi, ins .amount, ins').first();
          if ($discountedPriceEl.length > 0) {
            const discountedText = $discountedPriceEl.text().trim();
            discountedPrice = this.parsePrice(discountedText);
            currentPrice = discountedPrice; // Discounted is current
          }
          
          // Method 3: Extract current price (not in <del>)
          if (!currentPrice) {
            const $currentPriceEl = $priceContainer.find('.woocommerce-Price-amount, bdi, .amount').not('del .woocommerce-Price-amount, del bdi, del .amount').first();
            if ($currentPriceEl.length > 0) {
              const currentText = $currentPriceEl.text().trim();
              currentPrice = this.parsePrice(currentText);
            }
          }
          
          // Method 4: Parse HTML to find multiple prices
          const priceHtml = $priceContainer.html() || '';
          
          // Look for regular price in <del> tag from HTML
          if (!regularPrice) {
            const delMatch = priceHtml.match(/<del[^>]*>([\s\S]*?)<\/del>/i);
            if (delMatch && delMatch[1]) {
              const delPriceMatch = delMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
              if (delPriceMatch && delPriceMatch[1]) {
                regularPrice = this.parsePrice(delPriceMatch[1] + ' €');
              }
            }
          }
          
          // Look for discounted price in <ins> tag from HTML
          if (!discountedPrice) {
            const insMatch = priceHtml.match(/<ins[^>]*>([\s\S]*?)<\/ins>/i);
            if (insMatch && insMatch[1]) {
              const insPriceMatch = insMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
              if (insPriceMatch && insPriceMatch[1]) {
                discountedPrice = this.parsePrice(insPriceMatch[1] + ' €');
                if (!currentPrice) currentPrice = discountedPrice;
              }
            }
          }
          
          // Method 5: Get current price by excluding <del> content
          if (!currentPrice) {
            const cleanedHtml = priceHtml.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, '');
            const currentMatch = cleanedHtml.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
            if (currentMatch && currentMatch[1]) {
              currentPrice = this.parsePrice(currentMatch[1] + ' €');
            }
          }
          
          // Method 6: Find all prices and identify by value (higher = regular, lower = discounted)
          if (!regularPrice || !discountedPrice) {
            const allPrices = Array.from(priceHtml.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/g));
            if (allPrices.length > 1) {
              const parsedPrices = allPrices
                .map(m => this.parsePrice(m[1] + ' €'))
                .filter(p => p !== null && p > 0) as number[];
              
              if (parsedPrices.length >= 2) {
                const sorted = [...parsedPrices].sort((a, b) => b - a);
                if (!regularPrice) regularPrice = sorted[0];
                if (!discountedPrice && sorted[sorted.length - 1] < sorted[0]) {
                  discountedPrice = sorted[sorted.length - 1];
                  if (!currentPrice) currentPrice = discountedPrice;
                }
              }
            }
          }
          
          // Set priceText for backward compatibility with existing logic
          priceText = $priceContainer.text().trim();
        }
        
        // Fallback: Try multiple price element selectors if price container didn't work
        if (!priceText || (!regularPrice && !discountedPrice && !currentPrice)) {
          const priceSelectors = [
            '.price .woocommerce-Price-amount',
            '.price bdi',
            '.price',
            '.woocommerce-Price-amount',
            '.amount',
            '[class*="price"]',
            '.product-price',
            '.price-wrapper .price',
          ];
          
          for (const selector of priceSelectors) {
            const $priceEl = $product.find(selector).first();
            const candidate = $priceEl.text().trim();
            if (candidate && candidate.length >= 3 && /[\d.,€]/.test(candidate)) {
              priceText = candidate;
              break;
            }
          }
        }
        
        // If price element doesn't contain price, look in the whole product text
        if (!priceText || priceText.length < 3) {
          // Prioritize base price - look for patterns indicating single unit price
          const basePricePatterns = [
            /(?:od\s+1\s+kom\.|jedinična\s+cijena|cijena|price)[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/i,
          ];
          
          for (const pattern of basePricePatterns) {
            const match = productText.match(pattern);
            if (match && match[1]) {
              priceText = match[1] + ' €';
              break;
            }
          }
          
          // If no base price pattern, find all European prices and take the highest
          if (!priceText || priceText.length < 3) {
            const allEuropeanMatches = productText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/gi);
            const europeanPrices: string[] = [];
            for (const match of Array.from(allEuropeanMatches)) {
              if (match[1]) {
                europeanPrices.push(match[1] + ' €');
              }
            }
            
            if (europeanPrices.length > 0) {
              // Parse all prices and take the highest (base price is usually highest)
              const parsedPrices = europeanPrices.map(p => this.parsePrice(p)).filter(p => p !== null) as number[];
              if (parsedPrices.length > 0) {
                const maxPrice = Math.max(...parsedPrices);
                priceText = maxPrice.toFixed(2).replace('.', ',') + ' €';
              } else {
                priceText = europeanPrices[0];
              }
            } else {
              // Fallback to original patterns
              const pricePatterns = [
                /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/,  // European with €
                /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*€/,  // American with €
                /cijena[:\s]+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
                /€\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
              ];
              
              for (const pattern of pricePatterns) {
                const match = productText.match(pattern);
                if (match && (match[0] || match[1])) {
                  priceText = match[0] || match[1] + ' €';
                  break;
                }
              }
            }
          }
        }

        if (priceText || regularPrice || discountedPrice || currentPrice) {
          // Check if there are multiple prices (buy/sell or regular/sale)
          let buyPrice: number | null = null;
          let sellPrice: number | null = null;
          let mainPrice: number | null = null;
          
          // Try to find buy and sell prices separately
          const buyPriceMatch = productText.match(/kupnja[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i);
          const sellPriceMatch = productText.match(/(?:prodaja|prodajna)[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i);
          
          if (buyPriceMatch) {
            buyPrice = this.parsePrice(buyPriceMatch[1]);
          }
          if (sellPriceMatch) {
            sellPrice = this.parsePrice(sellPriceMatch[1]);
          }
          
          // Parse the main price - MORO uses EUR with format like 128.104,70 €
          if (priceText) {
            mainPrice = this.parsePrice(priceText);
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
          
          // Determine final main price: discounted || current || regular || mainPrice
          const finalMainPrice = discountedPrice || currentPrice || regularPrice || mainPrice;
          
          // Use sell price if found, otherwise use final main price
          const price = sellPrice || finalMainPrice || buyPrice;
          
          if (price !== null) {
            // Extract weight/unit from product title or text
            let unit = 'gram';
            let weight: number | null = null;
            
            // Try to extract weight from title/text
            const textLower = (productTitle + ' ' + productText).toLowerCase();
            
            // Match patterns like "1000 g", "1000g", "1 kg", "31,1035 g", "1 unca", etc.
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
              }
            }

            // MORO typically shows sell prices - use what we found with all price types
            prices.push({
              unit,
              price: price || undefined,
              regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
              discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
              buyPrice: buyPrice || undefined,
              sellPrice: sellPrice || price || undefined,
              productTitle: productTitle || undefined,
              productLink: fullProductLink,
            });
          }
        }
      });

      // If still no prices, try alternative parsing from tables or lists
      if (prices.length === 0) {
        // Look for any EUR prices in the document
        const bodyText = $('body').text();
        const eurPriceMatches = bodyText.matchAll(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/g);
        
        for (const match of Array.from(eurPriceMatches)) {
          const price = this.parsePrice(match[0]);
          if (price !== null && price > 100) { // Reasonable price range for gold
            prices.push({
              unit: 'gram',
              price,
              sellPrice: price,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing Moro HTML:`, error);
    }

    // Remove duplicates and sort
    const uniquePrices: PriceEntry[] = [];
    const seen = new Set<string>();
    prices.forEach((p) => {
      const key = `${p.unit}-${p.price || p.sellPrice || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePrices.push(p);
      }
    });

    return uniquePrices;
  }
}
