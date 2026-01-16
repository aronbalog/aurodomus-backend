import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class PlemenitParser extends BaseParser {
  /**
   * Helper function to extract ALL price types from cell (regular, discounted, current)
   */
  private extractPricesFromCell($: cheerio.Root, $cell: cheerio.Cheerio): { regularPrice: number | null; discountedPrice: number | null; currentPrice: number | null } {
    if ($cell.length === 0) return { regularPrice: null, discountedPrice: null, currentPrice: null };
    
    let regularPrice: number | null = null;
    let discountedPrice: number | null = null;
    let currentPrice: number | null = null;
    
    const cellHtml = $cell.html() || '';
    const cellText = $cell.text().trim();
    
    // Method 1: Extract regular price from <del> tag
    const $delPrice = $cell.find('del, .old-price, .regular-price, del .amount, del .price');
    if ($delPrice.length > 0) {
      regularPrice = this.parsePrice($delPrice.text().trim());
    }
    
    // Method 2: Extract discounted price from <ins> tag
    const $insPrice = $cell.find('ins, .sale-price, .special-price, ins .amount, ins .price');
    if ($insPrice.length > 0) {
      discountedPrice = this.parsePrice($insPrice.text().trim());
    }
    
    // Method 3: Parse HTML for <del> and <ins> tags
    if (!regularPrice) {
      const delMatch = cellHtml.match(/<del[^>]*>([\s\S]*?)<\/del>/i);
      if (delMatch && delMatch[1]) {
        const delPriceMatch = delMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
        if (delPriceMatch && delPriceMatch[1]) {
          regularPrice = this.parsePrice(delPriceMatch[1] + ' €');
        }
      }
    }
    
    if (!discountedPrice) {
      const insMatch = cellHtml.match(/<ins[^>]*>([\s\S]*?)<\/ins>/i);
      if (insMatch && insMatch[1]) {
        const insPriceMatch = insMatch[1].match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/);
        if (insPriceMatch && insPriceMatch[1]) {
          discountedPrice = this.parsePrice(insPriceMatch[1] + ' €');
        }
      }
    }
    
    // Method 4: Extract current price (not in <del>)
    const $currentPrice = $cell.find('.price, .amount, [class*="price"]').not('del .price, del .amount, del');
    if ($currentPrice.length > 0) {
      currentPrice = this.parsePrice($currentPrice.text().trim());
    }
    
    // Method 5: Find all prices in cell HTML
    if (!regularPrice || !discountedPrice || !currentPrice) {
      // Try base price pattern first
      const basePriceMatch = cellHtml.match(/(?:od\s+1\s+kom\.|jedinična\s+cijena)[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/i);
      if (basePriceMatch && basePriceMatch[1] && !currentPrice) {
        currentPrice = this.parsePrice(basePriceMatch[1] + ' €');
      }
      
      // Find all European prices
      const allMatches = Array.from(cellHtml.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:€|EUR|eur)/gi));
      if (allMatches.length > 1) {
        const prices = allMatches.map(m => this.parsePrice(m[1] + ' €')).filter(p => p !== null) as number[];
        if (prices.length >= 2) {
          const sorted = [...prices].sort((a, b) => b - a);
          // Higher price is likely regular, lower is likely discounted
          if (!regularPrice) regularPrice = sorted[0];
          if (!discountedPrice && sorted[sorted.length - 1] < sorted[0]) {
            discountedPrice = sorted[sorted.length - 1];
          }
        }
      } else if (allMatches.length === 1 && !currentPrice) {
        // Single price found
        currentPrice = this.parsePrice(allMatches[0][1] + ' €');
      }
      
      // Fallback to American format
      if (!currentPrice && allMatches.length === 0) {
        const priceMatch = cellHtml.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:€|EUR|eur)/);
        if (priceMatch) {
          currentPrice = this.parsePrice(priceMatch[0]);
        }
      }
    }
    
    // Method 6: Try broader regex on text if still no match - prioritize base price
    if (!currentPrice && !regularPrice && !discountedPrice) {
      const basePriceMatch = cellText.match(/(?:od\s+1\s+kom\.|jedinična\s+cijena)[:\s]*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
      if (basePriceMatch && basePriceMatch[1]) {
        currentPrice = this.parsePrice(basePriceMatch[1]);
      } else {
        const priceMatch = cellText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/);
        if (priceMatch) {
          currentPrice = this.parsePrice(priceMatch[1]);
        }
      }
    }
    
    return { regularPrice, discountedPrice, currentPrice };
  }

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

        // Get FIZIKA prices (most common, use this as main price source)
        const fizikaPrices = this.extractPricesFromCell($, $fizikaCell);

        // Get GEOGRAFIJA prices
        const geografijaPrices = this.extractPricesFromCell($, $geografijaCell);

        // Get MATEMATIKA prices
        const matematikaPrices = this.extractPricesFromCell($, $matematikaCell);

        // Combine price info from all columns, prioritizing FIZIKA
        let regularPrice = fizikaPrices.regularPrice || geografijaPrices.regularPrice || matematikaPrices.regularPrice;
        let discountedPrice = fizikaPrices.discountedPrice || geografijaPrices.discountedPrice || matematikaPrices.discountedPrice;
        let currentPrice = fizikaPrices.currentPrice || geografijaPrices.currentPrice || matematikaPrices.currentPrice;
        
        // Also check all cells for any price if specific columns didn't yield results
        if (!regularPrice && !discountedPrice && !currentPrice) {
          // Try to find any price in any cell
          cells.each((_, cell) => {
            const $cell = $(cell);
            const cellPrices = this.extractPricesFromCell($, $cell);
            if (!regularPrice && cellPrices.regularPrice) regularPrice = cellPrices.regularPrice;
            if (!discountedPrice && cellPrices.discountedPrice) discountedPrice = cellPrices.discountedPrice;
            if (!currentPrice && cellPrices.currentPrice) currentPrice = cellPrices.currentPrice;
          });
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
        
        // Determine main price: discounted || current || regular
        const sellPrice = discountedPrice || currentPrice || regularPrice;

        if (sellPrice !== null && sellPrice > 0 && (weight || combinedText.match(/\d+\s*(g|gram|kg|oz|ounce)/i))) {
          prices.push({
            unit,
            price: sellPrice,
            regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
            discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
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
          let regularPrice: number | null = null;
          let discountedPrice: number | null = null;
          let currentPrice: number | null = null;
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

          // Extract ALL price types from cells
          cells.forEach((cell) => {
            const $cell = $(cell);
            const cellText = $cell.text();
            const cellPrices = this.extractPricesFromCell($, $cell);
            
            // Collect all price types
            if (cellPrices.regularPrice && !regularPrice) {
              regularPrice = cellPrices.regularPrice;
            }
            if (cellPrices.discountedPrice && !discountedPrice) {
              discountedPrice = cellPrices.discountedPrice;
            }
            if (cellPrices.currentPrice && !currentPrice) {
              currentPrice = cellPrices.currentPrice;
            }
            
            // Check for buy/sell context
            const cellTextLower = cellText.toLowerCase();
            if (cellPrices.currentPrice || cellPrices.discountedPrice) {
              const priceValue = cellPrices.discountedPrice || cellPrices.currentPrice;
              if (cellTextLower.includes('prodaja') || cellTextLower.includes('sell') || cellTextLower.includes('cijena')) {
                if (!sellPrice) sellPrice = priceValue;
              } else if (cellTextLower.includes('otkup') || cellTextLower.includes('buy') || cellTextLower.includes('kupnja')) {
                if (!buyPrice) buyPrice = priceValue;
              } else {
                // If no label, assume it's a sell price (typical for Plemenit)
                if (!sellPrice) sellPrice = priceValue;
              }
            }
          });
          
          // Logic: if regular > current and no discounted, current IS discounted
          if (regularPrice && currentPrice && !discountedPrice && currentPrice < regularPrice) {
            discountedPrice = currentPrice;
          }
          
          // If we have regular but no current/discounted, use regular as current
          if (regularPrice && !currentPrice && !discountedPrice) {
            currentPrice = regularPrice;
          }
          
          // Determine main price: discounted || current || regular || sellPrice
          const mainPrice = discountedPrice || currentPrice || regularPrice || sellPrice || buyPrice;

          // If we found weight or unit info, add the price entry
          if (weight || rowText.match(/\d+\s*(g|gram|kg|oz|ounce)/i)) {
            if (mainPrice) {
              prices.push({
                unit,
                price: mainPrice,
                regularPrice: regularPrice !== null && regularPrice > 0 ? regularPrice : undefined,
                discountedPrice: discountedPrice !== null && discountedPrice > 0 ? discountedPrice : undefined,
                sellPrice: sellPrice || mainPrice || undefined,
                buyPrice: buyPrice || undefined,
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
        // Find all European format prices and take the highest (base price is usually highest)
        const allEuropeanMatches = Array.from(bodyText.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*€/gi));
        const europeanPrices: number[] = [];
        for (const match of allEuropeanMatches) {
          if (match[1]) {
            const parsed = this.parsePrice(match[1] + ' €');
            if (parsed !== null) europeanPrices.push(parsed);
          }
        }
        
        // Use the highest price (base price) if multiple found
        const seenPrices = new Set<number>();
        if (europeanPrices.length > 0) {
          // Use the highest price (base price)
          const maxPrice = Math.max(...europeanPrices);
          if (!seenPrices.has(maxPrice)) {
            seenPrices.add(maxPrice);
            prices.push({
              unit: 'gram',
              price: maxPrice,
              sellPrice: maxPrice,
            });
          }
        } else {
          // Fallback: use all matches
          for (const match of allEuropeanMatches) {
            const price = this.parsePrice(match[0] || match[1] + ' €');
          
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
