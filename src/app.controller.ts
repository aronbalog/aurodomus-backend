import { Controller, Get, Post, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { ScraperService, ScrapingProgress } from './scraper/scraper.service';
import { VendorPriceData, ScraperResult } from './scraper/interfaces/price.interface';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly scraperService: ScraperService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/prices')
  async getPrices(): Promise<VendorPriceData[]> {
    const prices = this.scraperService.getCurrentPrices();
    // If no cached prices, return empty array instead of error
    return prices || [];
  }

  @Post('api/prices/refresh')
  async refreshPrices(): Promise<VendorPriceData[]> {
    // Start scraping in background (don't await)
    this.scraperService.scrapeAll().catch((error) => {
      console.error('Scraping error:', error);
    });
    return this.scraperService.getCurrentPrices();
  }

  @Post('api/prices/refresh/:vendor')
  async refreshSingleVendor(@Param('vendor') vendor: string): Promise<ScraperResult> {
    // Scrape single vendor (await to return result)
    const result = await this.scraperService.scrapeSingleVendor(vendor);
    return result;
  }

  @Get('api/prices/progress')
  getScrapingProgress(): { isScraping: boolean; progress: ScrapingProgress[] } {
    return {
      isScraping: this.scraperService.getIsScraping(),
      progress: this.scraperService.getScrapingProgress(),
    };
  }
}
