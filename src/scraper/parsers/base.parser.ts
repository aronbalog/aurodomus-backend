import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { scraperConfig } from '../config/scraper.config';
import { PriceEntry, VendorPriceData } from '../interfaces/price.interface';

export abstract class BaseParser {
  protected axiosInstance: AxiosInstance;
  protected vendorName: string;
  protected vendorUrl: string;

  constructor(vendorName: string, vendorUrl: string) {
    this.vendorName = vendorName;
    this.vendorUrl = vendorUrl;
    this.axiosInstance = axios.create({
      timeout: scraperConfig.scraping.requestTimeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
  }

  /**
   * Fetch HTML content from the vendor URL
   * @param progressCallback Optional callback to report progress during fetching
   */
  protected async fetchHtml(progressCallback?: (progress: number) => void): Promise<string> {
    let lastError: Error | null = null;
    const totalAttempts = scraperConfig.scraping.retryAttempts + 1;

    const reportFetchProgress = (progress: number) => {
      if (progressCallback) {
        progressCallback(progress);
        return this.delay(20);
      }
      return Promise.resolve();
    };

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        // Report progress at start of attempt - more granular
        await reportFetchProgress(0);
        await reportFetchProgress(5);
        await reportFetchProgress(10);
        await reportFetchProgress(15);
        
        // Preparing request
        await reportFetchProgress(20);
        await reportFetchProgress(25);
        
        // Make the actual request (this is async, so progress happens during wait)
        const response = await this.axiosInstance.get(this.vendorUrl);
        
        // Report progress during response processing
        await reportFetchProgress(60);
        await reportFetchProgress(65);
        await reportFetchProgress(70);
        await reportFetchProgress(75);
        await reportFetchProgress(80);
        
        // Processing response data
        await reportFetchProgress(85);
        await reportFetchProgress(90);
        await reportFetchProgress(95);
        await reportFetchProgress(100);
        
        return response.data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < scraperConfig.scraping.retryAttempts) {
          // Report retry progress with more steps
          await reportFetchProgress(40);
          await reportFetchProgress(45);
          await reportFetchProgress(50);
          await reportFetchProgress(55);
          await this.delay(scraperConfig.scraping.retryDelay);
        }
      }
    }

    throw new Error(
      `Failed to fetch ${this.vendorName} after ${scraperConfig.scraping.retryAttempts + 1} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Parse price string and extract number
   * Handles both formats:
   * - European: 128.104,70 € (dots = thousands, comma = decimal)
   * - American: 128,104.70 € (comma = thousands, dot is decimal)
   * - Simple: 146.50 € or 146,50 €
   */
  protected parsePrice(priceText: string): number | null {
    if (!priceText) return null;
    
    // Remove currency symbols and spaces
    let cleaned = priceText.replace(/[€$£¥\s]/gi, '').trim();
    
    // Remove any non-numeric characters except dots, commas, and minus
    cleaned = cleaned.replace(/[^\d.,-]/g, '');
    
    // Determine format by checking which separator appears last (that's the decimal)
    const lastDotIndex = cleaned.lastIndexOf('.');
    const lastCommaIndex = cleaned.lastIndexOf(',');
    
    // Count dots and commas to determine format
    const dotCount = (cleaned.match(/\./g) || []).length;
    const commaCount = (cleaned.match(/,/g) || []).length;
    
    if (lastDotIndex > lastCommaIndex) {
      // Dot appears after comma (or no comma)
      if (dotCount === 1 && commaCount === 0) {
        // Simple format like 146.50 - dot is decimal
        // Keep as is
      } else if (dotCount > 1 && commaCount === 0) {
        // Multiple dots like 128.104.70 - European thousands separator, last dot is decimal
        const parts = cleaned.split('.');
        cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
      } else {
        // American format: 128,104.70 - comma is thousands, dot is decimal
        cleaned = cleaned.replace(/,/g, ''); // Remove thousands separators
      }
    } else if (lastCommaIndex > lastDotIndex) {
      // Comma appears after dot (or no dot)
      if (commaCount === 1 && dotCount === 0) {
        // Simple format like 146,50 - comma is decimal (European)
        cleaned = cleaned.replace(',', '.');
      } else if (commaCount > 1 && dotCount === 0) {
        // Multiple commas like 128,104,70 - American thousands separator, last comma is decimal
        const parts = cleaned.split(',');
        cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
      } else {
        // European format: 128.104,70 - dots are thousands, comma is decimal
        cleaned = cleaned.replace(/\./g, ''); // Remove thousands separators (dots)
        cleaned = cleaned.replace(',', '.'); // Replace comma with dot for decimal
      }
    } else if (cleaned.includes(',')) {
      // Only comma, treat as decimal (European)
      cleaned = cleaned.replace(',', '.');
    } else if (cleaned.includes('.')) {
      // Only dot - could be decimal or thousands
      // If there's only one dot and 2 digits after it, treat as decimal
      // Otherwise, check position
      if (dotCount === 1) {
        const parts = cleaned.split('.');
        if (parts.length === 2 && parts[1].length <= 2) {
          // Looks like decimal (e.g., 146.50)
          // Keep as is
        } else if (parts[1].length === 3 && parts[0].length > 3) {
          // Looks like thousands (e.g., 1.000)
          cleaned = cleaned.replace('.', '');
        }
        // Otherwise keep as is (assume decimal)
      }
    }
    
    // Remove any remaining non-numeric characters except decimal point
    cleaned = cleaned.replace(/[^\d.]/g, '');
    
    // Ensure only one decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      // Multiple decimal points - keep only the last one as decimal
      cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    }
    
    const price = parseFloat(cleaned);
    return isNaN(price) || price <= 0 ? null : price;
  }

  /**
   * Normalize unit names to common format
   */
  protected normalizeUnit(unit: string): string {
    const normalized = unit.toLowerCase().trim();
    const unitMap: Record<string, string> = {
      'g': 'gram',
      'gram': 'gram',
      'grams': 'gram',
      'gr': 'gram',
      'oz': 'ounce',
      'ounce': 'ounce',
      'ounces': 'ounce',
      'kg': 'kg',
      'kilogram': 'kg',
      'kilograms': 'kg',
      'kilo': 'kg',
    };

    return unitMap[normalized] || normalized;
  }

  /**
   * Delay helper for retries and rate limiting
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get vendor name
   */
  getVendorName(): string {
    return this.vendorName;
  }

  /**
   * Abstract method that each parser must implement
   */
  abstract parse(html: string): PriceEntry[];

  /**
   * Main method to scrape and return vendor price data
   * @param progressCallback Optional callback to report progress (0-100)
   */
  async scrape(progressCallback?: (progress: number) => void): Promise<VendorPriceData> {
    const reportProgress = (progress: number) => {
      if (progressCallback) {
        progressCallback(Math.min(100, Math.max(0, progress)));
        // Add small delay to ensure UI updates are visible
        return this.delay(25);
      }
      return Promise.resolve();
    };

    try {
      // Step 1: Initialize (0-8%) - more granular
      await reportProgress(0);
      await reportProgress(1);
      await reportProgress(2);
      await reportProgress(3);
      await reportProgress(4);
      await reportProgress(5);
      await reportProgress(6);
      await reportProgress(7);
      await reportProgress(8);

      // Step 2: Prepare request (8-12%)
      await reportProgress(8);
      await reportProgress(9);
      await reportProgress(10);
      await reportProgress(11);
      await reportProgress(12);

      // Step 3: Fetch HTML (12-35%) - with very detailed progress
      const html = await this.fetchHtml((fetchProgress) => {
        // Map fetch progress (0-100) to our range (12-32%)
        const mappedProgress = 12 + (fetchProgress / 100) * 20;
        progressCallback?.(Math.min(100, Math.max(0, mappedProgress)));
      });
      
      // Post-fetch steps
      await reportProgress(32);
      await reportProgress(33);
      await reportProgress(34);
      await reportProgress(35);

      // Step 4: Load HTML into Cheerio (35-42%)
      await reportProgress(36);
      await reportProgress(37);
      await reportProgress(38);
      await reportProgress(39);
      const $ = cheerio.load(html);
      await reportProgress(40);
      await reportProgress(41);
      await reportProgress(42);

      // Step 5: Analyze HTML structure (42-48%)
      await reportProgress(43);
      await reportProgress(44);
      await reportProgress(45);
      await reportProgress(46);
      await reportProgress(47);
      await reportProgress(48);

      // Step 6: Parse HTML - initial phase (48-55%)
      await reportProgress(48);
      await reportProgress(49);
      await reportProgress(50);
      await reportProgress(51);
      await reportProgress(52);
      
      let prices: PriceEntry[] = [];
      try {
        await reportProgress(53);
        await reportProgress(54);
        
        // Start parsing
        await reportProgress(55);
        prices = this.parse(html);
        
        // Step 7: Processing parsed data (55-72%)
        await reportProgress(56);
        await reportProgress(57);
        await reportProgress(58);
        await reportProgress(59);
        await reportProgress(60);
        
        await reportProgress(61);
        await reportProgress(62);
        await reportProgress(63);
        await reportProgress(64);
        await reportProgress(65);
        
        await reportProgress(66);
        await reportProgress(67);
        await reportProgress(68);
        await reportProgress(69);
        await reportProgress(70);
        
        await reportProgress(71);
        await reportProgress(72);

        // Step 8: Validate and process results (72-85%)
        await reportProgress(73);
        await reportProgress(74);
        await reportProgress(75);
        await reportProgress(76);
        await reportProgress(77);
        await reportProgress(78);
        await reportProgress(79);
        await reportProgress(80);
        
        await reportProgress(81);
        await reportProgress(82);
        await reportProgress(83);
        await reportProgress(84);
        await reportProgress(85);
      } catch (parseError) {
        await reportProgress(85);
        throw parseError;
      }

      // Step 9: Format and structure data (85-93%)
      await reportProgress(86);
      await reportProgress(87);
      await reportProgress(88);
      await reportProgress(89);
      await reportProgress(90);
      await reportProgress(91);
      await reportProgress(92);
      await reportProgress(93);

      // Step 10: Finalize (93-100%)
      await reportProgress(94);
      await reportProgress(95);
      await reportProgress(96);
      await reportProgress(97);
      await reportProgress(98);
      await reportProgress(99);
      await reportProgress(100);

      return {
        vendor: this.vendorName,
        url: this.vendorUrl,
        scrapedAt: new Date(),
        prices,
      };
    } catch (error) {
      await reportProgress(100); // Mark as complete even on error
      return {
        vendor: this.vendorName,
        url: this.vendorUrl,
        scrapedAt: new Date(),
        prices: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
