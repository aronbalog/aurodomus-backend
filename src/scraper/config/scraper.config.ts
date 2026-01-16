export const scraperConfig = {
  vendors: {
    gvsCroatia: {
      name: 'GVS Croatia',
      url: 'https://www.zlatosrebro.hr/kupnja/cijene-zlatnih-poluga.html',
    },
    plemenit: {
      name: 'Plemenit',
      url: 'https://plemenit.hr/cijene/cijena-zlatnih-poluga/cjenik-zlatnih-poluga-usporedba/',
    },
    moro: {
      name: 'Moro',
      url: 'https://www.moro.hr/kategorija-proizvoda/zlatne-poluge/',
    },
    centarZlata: {
      name: 'Centar Zlata',
      url: 'https://www.centarzlata.com/kategorija/investicijsko-zlato/zlatne-poluge/',
    },
  },
  scraping: {
    intervalMinutes: 5, // Automatic scraping every 5 minutes
    requestTimeout: 10000, // 10 seconds
    retryAttempts: 2,
    retryDelay: 1000, // 1 second
  },
};
