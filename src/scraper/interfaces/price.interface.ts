export interface PriceEntry {
  unit: string; // 'gram', 'ounce', 'kg', etc.
  buyPrice?: number;
  sellPrice?: number;
  price?: number; // if single price (not buy/sell)
  productTitle?: string; // Product name/title
  productLink?: string; // Link to product page
}

export interface VendorPriceData {
  vendor: string;
  url: string;
  scrapedAt: Date;
  prices: PriceEntry[];
  error?: string; // Error message if scraping failed
}

export interface ScraperResult {
  vendor: string;
  success: boolean;
  data?: VendorPriceData;
  error?: string;
}
