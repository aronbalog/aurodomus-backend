import * as cheerio from 'cheerio';
import { BaseParser } from './base.parser';
import { PriceEntry } from '../interfaces/price.interface';

export class ElementumParser extends BaseParser {
  parse(html: string): PriceEntry[] {
    const $ = cheerio.load(html);
    const prices: PriceEntry[] = [];

    try {
      // Elementum might have graph data or structured price tables
      // First, try to find script tags with JSON data (common for charts)
      const scripts = $('script').toArray();
      let jsonData: any = null;

      for (const script of scripts) {
        const scriptContent = $(script).html() || '';
        // Look for JSON data that might contain prices
        const jsonMatches = scriptContent.match(/data\s*[:=]\s*(\{[\s\S]*?\})/);
        if (jsonMatches) {
          try {
            jsonData = JSON.parse(jsonMatches[1]);
            // If we find price data in JSON, extract it
            if (jsonData && (jsonData.prices || jsonData.data || jsonData.chart)) {
              // Extract from JSON structure (adjust based on actual format)
              if (Array.isArray(jsonData.prices)) {
                jsonData.prices.forEach((item: any) => {
                  if (item.price && item.unit) {
                    prices.push({
                      unit: this.normalizeUnit(item.unit),
                      price: typeof item.price === 'number' ? item.price : this.parsePrice(String(item.price)),
                      buyPrice: item.buyPrice ? (typeof item.buyPrice === 'number' ? item.buyPrice : this.parsePrice(String(item.buyPrice))) : undefined,
                      sellPrice: item.sellPrice ? (typeof item.sellPrice === 'number' ? item.sellPrice : this.parsePrice(String(item.sellPrice))) : undefined,
                    });
                  }
                });
              }
            }
          } catch (e) {
            // Not valid JSON, continue
          }
        }
      }

      // If no JSON data found or no prices extracted, parse HTML
      if (prices.length === 0) {
        // Look for price tables or price displays
        $('table, .price-table, .prices, [class*="price"]').each((_, element) => {
          const $container = $(element);
          const rows = $container.find('tr, .price-row, .item').toArray();

          rows.forEach((row) => {
            const $row = $(row);
            const text = $row.text();

            // Extract prices
            const priceMatches = text.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:kn|hrk|eur|€)/gi);

            if (priceMatches && priceMatches.length > 0) {
              let buyPrice: number | null = null;
              let sellPrice: number | null = null;
              let singlePrice: number | null = null;

              if (priceMatches.length >= 2) {
                buyPrice = this.parsePrice(priceMatches[0]);
                sellPrice = this.parsePrice(priceMatches[1]);
              } else {
                singlePrice = this.parsePrice(priceMatches[0]);
              }

              // Determine unit
              const textLower = text.toLowerCase();
              let unit = 'gram';

              const weightMatch = textLower.match(/(\d+(?:[.,]\d+)?)\s*(g|gram|gr|oz|ounce|kg|kilogram|kilo|unca)/);
              if (weightMatch) {
                unit = this.normalizeUnit(weightMatch[2]);
              } else {
                if (textLower.includes('gram') || textLower.includes('g ')) {
                  unit = 'gram';
                } else if (textLower.includes('unca') || textLower.includes('ounce')) {
                  unit = 'ounce';
                } else if (textLower.includes('kilogram') || textLower.includes('kg')) {
                  unit = 'kg';
                }
              }

              if (buyPrice !== null || sellPrice !== null || singlePrice !== null) {
                prices.push({
                  unit,
                  buyPrice: buyPrice || undefined,
                  sellPrice: sellPrice || undefined,
                  price: singlePrice || undefined,
                });
              }
            }
          });
        });
      }

      // Additional: Look for graph/chart container and try to extract data
      if (prices.length === 0) {
        $('[class*="chart"], [class*="graph"], [id*="chart"], [id*="graph"]').each((_, element) => {
          const $chart = $(element);
          // Try to find data attributes
          const dataAttr = $chart.attr('data-prices') || $chart.attr('data-chart');
          if (dataAttr) {
            try {
              const chartData = JSON.parse(dataAttr);
              // Process chart data (adjust based on actual format)
            } catch (e) {
              // Not valid JSON
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error parsing Elementum HTML:`, error);
    }

    // Remove duplicates
    const uniquePrices: PriceEntry[] = [];
    const seen = new Set<string>();
    prices.forEach((p) => {
      if (p.price === null && p.price === undefined && !p.buyPrice && !p.sellPrice) {
        return; // Skip invalid entries
      }
      const key = `${p.unit}-${p.buyPrice || p.price || ''}-${p.sellPrice || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePrices.push(p);
      }
    });

    return uniquePrices;
  }
}
