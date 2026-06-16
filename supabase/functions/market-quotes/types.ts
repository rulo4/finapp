export type QuoteRequestItem = {
  securityId: string;
  ticker: string;
  exchangeCode: string | null;
};

export type MarketQuotesRequest = {
  items?: QuoteRequestItem[];
};

export type NormalizedProviderQuote = {
  ticker: string;
  exchangeCode: string | null;
  providerId: 'finnhub' | 'databursatil';
  sourceCurrencyCode: 'USD' | 'MXN';
  currentPrice: number;
  changeAmount: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  priceTimestamp: string | null;
};

export type ProviderResult =
  | {
      ok: true;
      quote: NormalizedProviderQuote;
    }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_payload' | 'unauthorized' | 'unsupported_exchange' | 'network_error';
      message: string;
    };

export type HoldingQuote = {
  securityId: string;
  ticker: string;
  exchangeCode: string | null;
  providerId: 'finnhub' | 'databursatil';
  sourceCurrencyCode: 'USD' | 'MXN';
  fxRateToMxnUsed: number;
  currentPrice: number;
  currentPriceMxn: number;
  changeAmount: number | null;
  changeAmountMxn: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayHighMxn: number | null;
  dayLow: number | null;
  dayLowMxn: number | null;
  priceTimestamp: string | null;
  fetchedAt: string;
};

export type MarketQuotesError = {
  securityId: string;
  ticker: string;
  message: string;
};

export type MarketQuotesResponse = {
  quotes: HoldingQuote[];
  errors: MarketQuotesError[];
};
