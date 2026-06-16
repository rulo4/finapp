import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase/client';

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

export type HoldingQuoteError = {
  securityId: string;
  ticker: string;
  message: string;
};

export type QuoteRequestItem = {
  securityId: string;
  ticker: string;
  exchangeCode: string | null;
};

type MarketQuotesFunctionResponse = {
  quotes?: HoldingQuote[];
  errors?: HoldingQuoteError[];
};

const HOLDING_QUOTES_STORAGE_PREFIX = 'auna.holdings.quotes.';
const HOLDING_QUOTES_STALE_MS = 24 * 60 * 60 * 1000;

function getStorageKey(userId: string) {
  return `${HOLDING_QUOTES_STORAGE_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isHoldingQuote(value: unknown): value is HoldingQuote {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.securityId === 'string' && typeof value.ticker === 'string' && typeof value.providerId === 'string' && typeof value.fetchedAt === 'string';
}

export function readHoldingQuotesCache(userId: string) {
  if (typeof window === 'undefined') {
    return new Map<string, HoldingQuote>();
  }

  const rawValue = window.localStorage.getItem(getStorageKey(userId));
  if (!rawValue) {
    return new Map<string, HoldingQuote>();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return new Map<string, HoldingQuote>();
    }

    return new Map(parsed.filter(isHoldingQuote).map((quote) => [quote.securityId, quote]));
  } catch {
    return new Map<string, HoldingQuote>();
  }
}

export function writeHoldingQuotesCache(userId: string, quotesBySecurityId: Map<string, HoldingQuote>) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getStorageKey(userId), JSON.stringify([...quotesBySecurityId.values()]));
}

export function mergeHoldingQuotesCache(existing: Map<string, HoldingQuote>, quotes: HoldingQuote[]) {
  const next = new Map(existing);

  for (const quote of quotes) {
    next.set(quote.securityId, quote);
  }

  return next;
}

export function isHoldingQuoteStale(quote: HoldingQuote, now = Date.now()) {
  const fetchedAt = Date.parse(quote.fetchedAt);

  return Number.isNaN(fetchedAt) || now - fetchedAt > HOLDING_QUOTES_STALE_MS;
}

export async function requestHoldingQuotes(items: QuoteRequestItem[]) {
  if (!supabase) {
    throw new Error('Supabase no está disponible para consultar precios.');
  }

  const { data, error } = await supabase.functions.invoke('market-quotes', {
    body: {
      items,
    },
  });

  if (error) {
    throw error;
  }

  const payload = (data ?? {}) as MarketQuotesFunctionResponse;

  return {
    quotes: Array.isArray(payload.quotes) ? payload.quotes.filter(isHoldingQuote) : [],
    errors: Array.isArray(payload.errors)
      ? payload.errors.filter((entry): entry is HoldingQuoteError => isRecord(entry) && typeof entry.securityId === 'string' && typeof entry.ticker === 'string' && typeof entry.message === 'string')
      : [],
  };
}

export function getHoldingQuotesUserId(user: User | null) {
  return user?.id ?? null;
}
