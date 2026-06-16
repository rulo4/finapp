import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getDataBursatilQuote } from './providers/databursatil.ts';
import { getFinnhubQuote } from './providers/finnhub.ts';
import type { HoldingQuote, MarketQuotesRequest, MarketQuotesResponse, NormalizedProviderQuote, ProviderResult, QuoteRequestItem } from './types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function round6(value: number | null) {
  return value == null ? null : Number(value.toFixed(6));
}

function normalizeRequestItems(items: QuoteRequestItem[] | undefined) {
  const deduped = new Map<string, QuoteRequestItem>();

  for (const item of items ?? []) {
    const securityId = item.securityId?.trim();
    const ticker = item.ticker?.trim().toUpperCase();
    const exchangeCode = item.exchangeCode?.trim().toUpperCase() ?? null;

    if (!securityId || !ticker) {
      continue;
    }

    deduped.set(securityId, {
      securityId,
      ticker,
      exchangeCode,
    });
  }

  return [...deduped.values()];
}

async function loadUsdMxnRate() {
  const response = await fetch('https://fxapi.app/api/usd/mxn.json', {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`FX API ${response.status}`);
  }

  const payload = (await response.json()) as { rate?: number };

  if (!Number.isFinite(payload.rate) || payload.rate == null || payload.rate <= 0) {
    throw new Error('FX API devolvió una tasa inválida.');
  }

  return Number(payload.rate.toFixed(6));
}

async function getQuoteWithFallback(item: QuoteRequestItem, finnhubToken: string, dataBursatilToken: string) {
  const attempts: ProviderResult[] = [];

  const finnhubResult = await getFinnhubQuote(item, finnhubToken);
  attempts.push(finnhubResult);
  if (finnhubResult.ok) {
    return finnhubResult.quote;
  }

  const dataBursatilResult = await getDataBursatilQuote(item, dataBursatilToken);
  attempts.push(dataBursatilResult);
  if (dataBursatilResult.ok) {
    return dataBursatilResult.quote;
  }

  const lastError = attempts[attempts.length - 1];
  throw new Error(lastError.ok ? 'No fue posible obtener el precio.' : lastError.message);
}

function buildHoldingQuote(item: QuoteRequestItem, quote: NormalizedProviderQuote, usdMxnRate: number, fetchedAt: string): HoldingQuote {
  const fxRateToMxnUsed = quote.sourceCurrencyCode === 'USD' ? usdMxnRate : 1;
  const toMxn = (value: number | null) => (value == null ? null : round6(value * fxRateToMxnUsed));

  return {
    securityId: item.securityId,
    ticker: item.ticker,
    exchangeCode: item.exchangeCode,
    providerId: quote.providerId,
    sourceCurrencyCode: quote.sourceCurrencyCode,
    fxRateToMxnUsed,
    currentPrice: quote.currentPrice,
    currentPriceMxn: Number((quote.currentPrice * fxRateToMxnUsed).toFixed(6)),
    changeAmount: quote.changeAmount,
    changeAmountMxn: toMxn(quote.changeAmount),
    changePercent: quote.changePercent,
    dayHigh: quote.dayHigh,
    dayHighMxn: toMxn(quote.dayHigh),
    dayLow: quote.dayLow,
    dayLowMxn: toMxn(quote.dayLow),
    priceTimestamp: quote.priceTimestamp,
    fetchedAt,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const authHeader = request.headers.get('Authorization');
    const finnhubToken = getRequiredEnv('FINNHUB_TOKEN');
    const dataBursatilToken = getRequiredEnv('DATABURSATIL_TOKEN');

    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization header' });
    }

    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: authData, error: authError } = await authedClient.auth.getUser();

    if (authError || !authData.user) {
      return jsonResponse(401, { error: 'Invalid user session' });
    }

    const body = (await request.json()) as MarketQuotesRequest;
    const items = normalizeRequestItems(body.items);

    if (items.length === 0) {
      return jsonResponse(400, { error: 'items must include at least one valid ticker' });
    }

    const providerQuotes = await Promise.all(
      items.map(async (item) => {
        try {
          const quote = await getQuoteWithFallback(item, finnhubToken, dataBursatilToken);
          return { item, quote, error: null as string | null };
        } catch (error) {
          return {
            item,
            quote: null,
            error: error instanceof Error ? error.message : 'No fue posible obtener el precio actual.',
          };
        }
      }),
    );

    const successfulQuotes = providerQuotes.filter((entry): entry is { item: QuoteRequestItem; quote: NormalizedProviderQuote; error: null } => entry.quote != null);
    const needsUsdRate = successfulQuotes.some((entry) => entry.quote.sourceCurrencyCode === 'USD');
    const usdMxnRate = needsUsdRate ? await loadUsdMxnRate() : 1;
    const fetchedAt = new Date().toISOString();

    const responseBody: MarketQuotesResponse = {
      quotes: successfulQuotes.map(({ item, quote }) => buildHoldingQuote(item, quote, usdMxnRate, fetchedAt)),
      errors: providerQuotes
        .filter((entry) => entry.quote == null)
        .map(({ item, error }) => ({
          securityId: item.securityId,
          ticker: item.ticker,
          message: error ?? 'No fue posible obtener el precio actual.',
        })),
    };

    return jsonResponse(200, responseBody);
  } catch (error) {
    console.error(error);
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Unexpected error' });
  }
});
