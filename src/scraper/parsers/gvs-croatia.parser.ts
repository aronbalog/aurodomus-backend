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
        
        // Helper function to extract price with multiple methods
        const extractPrice = (): string | null => {
          // Method 1: Try standard price selectors
          const priceSelectors = [
            '.price',
            '.price-box .price',
            '.price-box .price-final',
            '.regular-price',
            '.special-price',
            '[class*="price"]',
            '[id*="product-price"]',
            '[data-price-amount]',
            '.product-price',
            '.price-wrapper',
          ];
          
          for (const selector of priceSelectors) {
            const $priceEl = $product.find(selector).first();
            if ($priceEl.length > 0) {
              // Try text content
              let priceText = $priceEl.text().trim();
              if (priceText && priceText.length >= 3 && /\d/.test(priceText)) {
                return priceText;
              }
              
              // Try data attributes
              const dataPrice = $priceEl.attr('data-price-amount') || 
                               $priceEl.attr('data-price') ||
                               $priceEl.attr('data-price-final');
              if (dataPrice) {
                return `${dataPrice} €`;
              }
              
              // Try inner HTML for formatted prices
              const priceHtml = $priceEl.html() || '';
              const htmlMatch = priceHtml.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/);
              if (htmlMatch) {
                return htmlMatch[0];
              }
            }
          }
          
          // Method 2: Search in product text
          const productText = $product.text();
          const pricePatterns = [
            /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/,  // With € symbol
            /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*EUR/i,  // With EUR
            /€\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/,  // € before number
            /cijena[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,  // "cijena: 1234,56"
          ];
          
          for (const pattern of pricePatterns) {
            const match = productText.match(pattern);
            if (match && match[0]) {
              return match[0];
            }
          }
          
          // Method 3: Check product HTML for hidden prices
          const productHtml = $product.html() || '';
          const htmlPriceMatch = productHtml.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/);
          if (htmlPriceMatch) {
            return htmlPriceMatch[0];
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
            
            // Look for buy/sell price labels
            const buyMatch = productTextForPrice.match(/kupnja[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i);
            const sellMatch = productTextForPrice.match(/(?:prodaja|prodajna)[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i);
            
            if (buyMatch) {
              buyPrice = this.parsePrice(buyMatch[1]);
            }
            if (sellMatch) {
              sellPrice = this.parsePrice(sellMatch[1]);
            }
            
            // Use sell price if found, otherwise use main price
            const finalPrice = sellPrice || mainPrice;
            
            // GVS Croatia typically shows sell prices (buying from them)
            prices.push({
              unit,
              price: finalPrice || undefined,
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
                const htmlMatch = priceHtml.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/);
                if (htmlMatch) {
                  priceText = htmlMatch[0];
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
            const priceMatch = itemText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/i);
            if (priceMatch) {
              priceText = priceMatch[0];
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
