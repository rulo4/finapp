import type { ProviderResult, QuoteRequestItem } from '../types.ts';

type FinnhubQuoteResponse = {
  c?: number;
  d?: number | null;
  dp?: number | null;
  h?: number;
  l?: number;
  t?: number;
  error?: string;
};

function epochSecondsToIso(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

export async function getFinnhubQuote(item: QuoteRequestItem, token: string): Promise<ProviderResult> {
  const ticker = item.ticker.trim().toUpperCase();

  if (!ticker) {
    return {
      ok: false,
      reason: 'invalid_payload',
      message: 'Ticker vacío.',
    };
  }

  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(token)}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'network_error',
        message: `Finnhub ${response.status}`,
      };
    }

    const payload = (await response.json()) as FinnhubQuoteResponse;

    if (payload.error) {
      return {
        ok: false,
        reason: /access/i.test(payload.error) ? 'unauthorized' : 'not_found',
        message: payload.error,
      };
    }

    if (!Number.isFinite(payload.c) || payload.c == null || payload.c <= 0 || !Number.isFinite(payload.t) || payload.t == null || payload.t <= 0) {
      return {
        ok: false,
        reason: 'invalid_payload',
        message: 'Finnhub devolvió un precio inválido para el ticker.',
      };
    }

    return {
      ok: true,
      quote: {
        ticker,
        exchangeCode: item.exchangeCode,
        providerId: 'finnhub',
        sourceCurrencyCode: 'USD',
        currentPrice: Number(payload.c.toFixed(6)),
        changeAmount: Number.isFinite(payload.d) ? Number(payload.d!.toFixed(6)) : null,
        changePercent: Number.isFinite(payload.dp) ? Number((payload.dp! / 100).toFixed(6)) : null,
        dayHigh: Number.isFinite(payload.h) && payload.h! > 0 ? Number(payload.h!.toFixed(6)) : null,
        dayLow: Number.isFinite(payload.l) && payload.l! > 0 ? Number(payload.l!.toFixed(6)) : null,
        priceTimestamp: epochSecondsToIso(payload.t),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'network_error',
      message: error instanceof Error ? error.message : 'Error de red con Finnhub.',
    };
  }
}
