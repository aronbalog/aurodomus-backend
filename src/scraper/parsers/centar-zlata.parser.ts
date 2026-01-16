import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class CentarZlataParser extends BaseParser {
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

        // Look for price - WooCommerce typically uses .price or .woocommerce-Price-amount
        const $priceEl = $product.find('.price, .woocommerce-Price-amount, .amount, [class*="price"], .fusion-price-rating .price').first();
        let priceText = $priceEl.text().trim();
        
        // If price element doesn't contain price, look in the whole product
        if (!priceText || priceText.length < 3) {
          // Try to find EUR price in the text
          const eurPriceMatch = productText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/);
          if (eurPriceMatch) {
            priceText = eurPriceMatch[0];
          } else {
            // Try without € symbol
            const priceMatch = productText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|eur|kn|hrk)/i);
            if (priceMatch) {
              priceText = priceMatch[0];
            }
          }
        }

        if (priceText) {
          // Parse the price
          let price = this.parsePrice(priceText);
          
          if (price !== null) {
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
            if (price <= 0 || price > 1000000) {
              return; // Skip invalid prices
            }

            // Centar Zlata typically shows sell prices - use actual scraped price
            prices.push({
              unit,
              price, // Actual product price (not normalized per unit)
              sellPrice: price,
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
}
