import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { scraperConfig } from './config/scraper.config';
import { VendorPriceData, ScraperResult } from './interfaces/price.interface';
import { GvsCroatiaParser } from './parsers/gvs-croatia.parser';
import { PlemenitParser } from './parsers/plemenit.parser';
import { MoroParser } from './parsers/moro.parser';
import { CentarZlataParser } from './parsers/centar-zlata.parser';
import { BaseParser } from './parsers/base.parser';

export interface ScrapingProgress {
  vendor: string;
  status: 'pending' | 'scraping' | 'completed' | 'error';
  progress: number; // 0-100
  error?: string;
}

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private cachedPrices: Map<string, VendorPriceData> = new Map();
  private isScraping = false;
  private scrapingProgress: Map<string, ScrapingProgress> = new Map();

  private parsers: BaseParser[] = [
    new GvsCroatiaParser(
      scraperConfig.vendors.gvsCroatia.name,
      scraperConfig.vendors.gvsCroatia.url,
    ),
    new PlemenitParser(
      scraperConfig.vendors.plemenit.name,
      scraperConfig.vendors.plemenit.url,
    ),
    new MoroParser(scraperConfig.vendors.moro.name, scraperConfig.vendors.moro.url),
    new CentarZlataParser(
      scraperConfig.vendors.centarZlata.name,
      scraperConfig.vendors.centarZlata.url,
    ),
  ];

  /**
   * Scrape all vendors and cache results
   */
  async scrapeAll(): Promise<ScraperResult[]> {
    if (this.isScraping) {
      this.logger.warn('Scraping already in progress, skipping...');
      return this.getCurrentResults();
    }

    this.isScraping = true;
    this.logger.log('Starting scraping of all vendors...');

    // Initialize progress tracking
    this.scrapingProgress.clear();
    this.parsers.forEach((parser) => {
      this.scrapingProgress.set(parser.getVendorName(), {
        vendor: parser.getVendorName(),
        status: 'pending',
        progress: 0,
      });
    });

    try {
      // Scrape all vendors in parallel
      const results: ScraperResult[] = [];

      // Start all scrapers in parallel using Promise.allSettled
      // This ensures all vendors are scraped even if some fail
      const scrapingPromises = this.parsers.map(async (parser) => {
        const vendorName = parser.getVendorName();
        this.logger.log(`Starting scraping ${vendorName}...`);

        // Update progress to scraping (start at 0%)
        this.scrapingProgress.set(vendorName, {
          vendor: vendorName,
          status: 'scraping',
          progress: 0,
        });

        try {
          // Pass progress callback to track real-time progress
          const data = await parser.scrape((progress: number) => {
            this.scrapingProgress.set(vendorName, {
              vendor: vendorName,
              status: 'scraping',
              progress,
            });
          });

          if (data.error) {
            this.logger.error(`Error scraping ${data.vendor}: ${data.error}`);
            this.scrapingProgress.set(vendorName, {
              vendor: vendorName,
              status: 'error',
              progress: 100, // 100% because it's done (even if with error)
              error: data.error,
            });
            return {
              vendor: data.vendor,
              success: false,
              error: data.error,
            };
          } else {
            this.cachedPrices.set(data.vendor, data);
            this.scrapingProgress.set(vendorName, {
              vendor: vendorName,
              status: 'completed',
              progress: 100, // 100% because it's completed
            });
            this.logger.log(`Successfully scraped ${data.vendor}: ${data.prices.length} prices found`);
            return {
              vendor: data.vendor,
              success: true,
              data,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to scrape ${vendorName}: ${errorMessage}`);
          this.scrapingProgress.set(vendorName, {
            vendor: vendorName,
            status: 'error',
            progress: 100, // 100% because it's done (even if with error)
            error: errorMessage,
          });
          return {
            vendor: vendorName,
            success: false,
            error: errorMessage,
          };
        }
      });

      // Wait for all scrapers to complete (in parallel)
      const settledResults = await Promise.allSettled(scrapingPromises);
      
      // Process results from Promise.allSettled
      settledResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // This should rarely happen since we catch errors inside the promise,
          // but handle it just in case
          this.logger.error(`Unexpected error in scraper promise: ${result.reason}`);
          results.push({
            vendor: 'unknown',
            success: false,
            error: result.reason?.message || String(result.reason),
          });
        }
      });

      this.logger.log('Finished scraping all vendors (parallel execution)');
      return results;
    } finally {
      this.isScraping = false;
      // Clear progress after a delay to allow frontend to read final state
      setTimeout(() => {
        this.scrapingProgress.clear();
      }, 3000);
    }
  }

  /**
   * Get current cached prices
   */
  getCurrentPrices(): VendorPriceData[] {
    return Array.from(this.cachedPrices.values());
  }

  /**
   * Get current results in ScraperResult format
   */
  getCurrentResults(): ScraperResult[] {
    return Array.from(this.cachedPrices.values()).map((data) => ({
      vendor: data.vendor,
      success: !data.error,
      data: data.error ? undefined : data,
      error: data.error,
    }));
  }

  /**
   * Get current scraping progress
   */
  getScrapingProgress(): ScrapingProgress[] {
    return Array.from(this.scrapingProgress.values());
  }

  /**
   * Check if scraping is in progress
   */
  getIsScraping(): boolean {
    return this.isScraping;
  }

  /**
   * Scheduled task - scrape automatically every X minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledScraping() {
    this.logger.log('Running scheduled scraping...');
    await this.scrapeAll();
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Initialize scraping on service start
   * Non-blocking - server will start even if initial scrape fails
   */
  async onModuleInit() {
    this.logger.log('Initializing scraper service - performing initial scrape in background...');
    // Don't await - let server start immediately
    this.scrapeAll().catch((error) => {
      this.logger.error(`Initial scrape failed: ${error.message}`);
    });
  }
}
