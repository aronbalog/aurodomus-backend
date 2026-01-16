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

        // Look for price - Moro uses various price selectors
        let priceText = '';
        
        // Try multiple price element selectors (more comprehensive)
        const priceSelectors = [
          '.price .woocommerce-Price-amount',
          '.price del .woocommerce-Price-amount', // Regular price (might be crossed out)
          '.price ins .woocommerce-Price-amount', // Sale price
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
        
        // If price element doesn't contain price, look in the whole product text
        if (!priceText || priceText.length < 3) {
          // Try to find EUR price in the text - be more flexible with formats
          // Match patterns like: "128.104,70 €", "128,104.70 €", "128104.70", etc.
          const pricePatterns = [
            /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/,  // With € symbol
            /cijena[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i, // "cijena: 1234,56"
            /€\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/,  // € before number
            /(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|eur|EUR)/i,  // More flexible
          ];
          
          for (const pattern of pricePatterns) {
            const match = productText.match(pattern);
            if (match && match[1]) {
              priceText = match[0];
              break;
            }
          }
        }

        if (priceText) {
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
          mainPrice = this.parsePrice(priceText);
          
          // Use sell price if found, otherwise use main price
          const price = sellPrice || mainPrice || buyPrice;
          
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

            // MORO typically shows sell prices - use what we found
            prices.push({
              unit,
              price: sellPrice || mainPrice || undefined, // Prefer sell price
              buyPrice: buyPrice || undefined,
              sellPrice: sellPrice || mainPrice || undefined,
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
