import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class PlemenitParser extends BaseParser {
  parse(html: string): PriceEntry[] {
    const $ = cheerio.load(html);
    const prices: PriceEntry[] = [];

    try {
      // Plemenit comparison page has a specific table structure:
      // - td.prvakolona = product name (contains weight like "1 gram")
      // - td.drugakolona = FIZIKA price (€)
      // - td.trecakolona = GEOGRAFIJA price (€)
      // - td.cetvrtakolona = MATEMATIKA price (€)
      
      // Find all table rows (skip the header row) - try multiple table selectors
      $('table tr, .wp-block-table tr, table.wp-block-table tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        // Skip header rows
        if ($row.find('th').length > 0 || cells.length < 2) {
          return;
        }

        // Get product name from first column
        const $productCell = cells.filter('.prvakolona').first();
        const $productLink = $productCell.find('a').first();
        const productText = $productCell.text();
        const productLinkText = $productLink.text() || productText;
        const combinedText = (productLinkText + ' ' + productText).toLowerCase();
        
        // Extract product title and link
        const productTitle = productLinkText.trim() || productText.trim();
        const productLinkHref = $productLink.attr('href');
        const fullProductLink = productLinkHref 
          ? (productLinkHref.startsWith('http') ? productLinkHref : new URL(productLinkHref, this.vendorUrl).toString())
          : undefined;

        // Extract weight/unit from product name
        let unit = 'gram';
        let weight: number | null = null;
        
        const weightPatterns = [
          /(\d+(?:[.,]\d+)?)\s*(g|gram|gr)\b/i,
          /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo)\b/i,
          /(\d+(?:[.,]\d+)?)\s*(oz|ounce|unca)\b/i,
        ];

        for (const pattern of weightPatterns) {
          const match = combinedText.match(pattern);
          if (match) {
            weight = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
            unit = this.normalizeUnit(match[2]);
            break;
          }
        }

        // Extract prices from other columns - try multiple methods
        const $fizikaCell = cells.filter('.drugakolona');
        const $geografijaCell = cells.filter('.trecakolona');
        const $matematikaCell = cells.filter('.cetvrtakolona');

        // Helper function to extract price from cell with multiple methods
        const extractPriceFromCell = ($cell: cheerio.Cheerio): number | null => {
          if ($cell.length === 0) return null;
          
          // Try direct text extraction
          let priceText = $cell.text().trim();
          
          // If cell contains multiple elements, try finding price in nested elements
          if (!priceText || priceText.length < 3) {
            const $priceEl = $cell.find('.price, .amount, [class*="price"], .woocommerce-Price-amount').first();
            if ($priceEl.length > 0) {
              priceText = $priceEl.text().trim();
            }
          }
          
          // If still no price, try regex matching on the full cell HTML
          if (!priceText || priceText.length < 3) {
            const cellHtml = $cell.html() || '';
            const priceMatch = cellHtml.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/);
            if (priceMatch) {
              priceText = priceMatch[0];
            }
          }
          
          // Try broader regex if still no match
          if (!priceText || priceText.length < 3) {
            const cellText = $cell.text();
            const priceMatch = cellText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
            if (priceMatch) {
              priceText = priceMatch[1];
            }
          }
          
          return priceText ? this.parsePrice(priceText) : null;
        };

        // Get FIZIKA price (most common, use this as main price)
        const fizikaPrice = extractPriceFromCell($fizikaCell);

        // Get GEOGRAFIJA price
        const geografijaPrice = extractPriceFromCell($geografijaCell);

        // Get MATEMATIKA price
        const matematikaPrice = extractPriceFromCell($matematikaCell);

        // Also check all cells for any price if specific columns didn't yield results
        let sellPrice = fizikaPrice || geografijaPrice || matematikaPrice;
        
        if (!sellPrice) {
          // Try to find any price in any cell
          cells.each((_, cell) => {
            const $cell = $(cell);
            const price = extractPriceFromCell($cell);
            if (price && !sellPrice) {
              sellPrice = price;
            }
          });
        }

        if (sellPrice !== null && sellPrice > 0 && (weight || combinedText.match(/\d+\s*(g|gram|kg|oz|ounce)/i))) {
          prices.push({
            unit,
            price: sellPrice,
            sellPrice: sellPrice,
            productTitle: productTitle || undefined,
            productLink: fullProductLink,
          });
        }
      });

      // Fallback: Look for general table structures if the specific structure wasn't found
      if (prices.length === 0) {
        $('table, .wp-block-table, table.wp-block-table').each((_, table) => {
          const $table = $(table);
        const rows = $table.find('tr, tbody tr').toArray();

        rows.forEach((row) => {
          const $row = $(row);
          const cells = $row.find('td, th').toArray();
          const rowText = $row.text().toLowerCase();

          // Skip header rows
          if ($row.find('th').length > 0 && cells.length < 3) {
            return;
          }

          let weight: number | null = null;
          let unit = 'gram';
          let sellPrice: number | null = null;
          let buyPrice: number | null = null;

          // Extract weight and unit from row
          const weightPatterns = [
            /(\d+(?:[.,]\d+)?)\s*(g|gram|gr)\b/i,
            /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilo)\b/i,
            /(\d+(?:[.,]\d+)?)\s*(oz|ounce|unca)\b/i,
          ];

          for (const pattern of weightPatterns) {
            const match = rowText.match(pattern);
            if (match) {
              weight = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
              unit = this.normalizeUnit(match[2]);
              break;
            }
          }

          // Extract prices from cells - look for EUR prices with multiple methods
          cells.forEach((cell) => {
            const $cell = $(cell);
            const cellText = $cell.text();
            const cellHtml = $cell.html() || '';
            
            // Try multiple price extraction methods
            let priceValue: number | null = null;
            
            // Method 1: Direct text parsing
            priceValue = this.parsePrice(cellText);
            
            // Method 2: Look for price in nested elements
            if (!priceValue) {
              const $priceEl = $cell.find('.price, .amount, [class*="price"], .woocommerce-Price-amount').first();
              if ($priceEl.length > 0) {
                priceValue = this.parsePrice($priceEl.text());
              }
            }
            
            // Method 3: Regex match in HTML
            if (!priceValue) {
              const priceMatch = cellHtml.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|EUR|eur)/);
              if (priceMatch) {
                priceValue = this.parsePrice(priceMatch[0]);
              }
            }
            
            // Method 4: Look for any number pattern
            if (!priceValue) {
              const priceMatch = cellText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
              if (priceMatch) {
                priceValue = this.parsePrice(priceMatch[1]);
              }
            }
            
            if (priceValue !== null && priceValue > 0) {
              // Determine if it's buy or sell price based on context
              const cellTextLower = cellText.toLowerCase();
              if (cellTextLower.includes('prodaja') || cellTextLower.includes('sell') || cellTextLower.includes('cijena')) {
                sellPrice = priceValue;
              } else if (cellTextLower.includes('otkup') || cellTextLower.includes('buy') || cellTextLower.includes('kupnja')) {
                buyPrice = priceValue;
              } else {
                // If no label, assume it's a sell price (typical for Plemenit)
                if (!sellPrice) {
                  sellPrice = priceValue;
                }
              }
            }
          });

          // If we found weight or unit info, add the price entry
          if (weight || rowText.match(/\d+\s*(g|gram|kg|oz|ounce)/i)) {
            if (sellPrice || buyPrice) {
              prices.push({
                unit,
                sellPrice: sellPrice || undefined,
                buyPrice: buyPrice || undefined,
                price: sellPrice || buyPrice || undefined,
              });
            }
          }
        });
        });
      }

      // Alternative: Look for product listings or price blocks
      if (prices.length === 0) {
        $('.product, .wp-block-columns, .wp-block-group, article').each((_, element) => {
          const $el = $(element);
          const text = $el.text();

          // Look for EUR prices - use more flexible patterns
          const pricePatterns = [
            /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/gi,  // With € symbol
            /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*EUR/gi,  // With EUR
            /€\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/gi,  // € before number
            /cijena[:\s]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/gi,  // "cijena: 1234,56"
          ];
          
          let priceMatches: RegExpMatchArray[] = [];
          for (const pattern of pricePatterns) {
            const matches = Array.from(text.matchAll(pattern));
            if (matches.length > 0) {
              priceMatches = matches;
              break;
            }
          }

          if (priceMatches.length > 0) {
            const textLower = text.toLowerCase();
            
            // Extract weight/unit
            let unit = 'gram';
            const weightMatch = textLower.match(/(\d+(?:[.,]\d+)?)\s*(g|gram|gr|kg|kilogram|oz|ounce|unca)/i);
            if (weightMatch) {
              unit = this.normalizeUnit(weightMatch[2]);
            }

            // Try to parse the first price found
            for (const match of priceMatches) {
              const priceText = match[0] || match[1] || '';
              const price = this.parsePrice(priceText);
              
              if (price !== null && price > 0) {
                prices.push({
                  unit,
                  price,
                  sellPrice: price,
                });
                break; // Only add first valid price per element
              }
            }
          }
        });
      }

      // Last resort: Search entire document for price patterns
      if (prices.length === 0) {
        const bodyText = $('body').text();
        const priceMatches = bodyText.matchAll(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/g);
        
        const seenPrices = new Set<number>();
        for (const match of Array.from(priceMatches)) {
          const price = this.parsePrice(match[0]);
          
          // Filter reasonable prices (too small or too large are probably not gold prices)
          if (price !== null && price > 10 && price < 100000 && !seenPrices.has(price)) {
            seenPrices.add(price);
            prices.push({
              unit: 'gram',
              price,
              sellPrice: price,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing Plemenit HTML:`, error);
    }

    // Remove duplicates
    const uniquePrices: PriceEntry[] = [];
    const seen = new Set<string>();
    prices.forEach((p) => {
      const key = `${p.unit}-${Math.round((p.sellPrice || p.price || 0) * 100) / 100}-${Math.round((p.buyPrice || 0) * 100) / 100}`;
      if (!seen.has(key) && (p.price || p.sellPrice || p.buyPrice)) {
        seen.add(key);
        uniquePrices.push(p);
      }
    });

    return uniquePrices;
  }
}
