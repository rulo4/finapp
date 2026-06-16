import type { ProviderResult, QuoteRequestItem } from '../types.ts';

type DataBursatilTickerPayload = Record<
  string,
  {
    u?: number;
    c?: number;
    m?: number;
    x?: number;
    n?: number;
    f?: string;
  }
>;

type DataBursatilResponse = Record<string, DataBursatilTickerPayload>;

function parseDataBursatilTimestamp(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(' ', 'T');
  const parsed = Date.parse(normalized);

  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export async function getDataBursatilQuote(item: QuoteRequestItem, token: string): Promise<ProviderResult> {
  const ticker = item.ticker.trim().toUpperCase();
  const exchangeCode = item.exchangeCode?.trim().toUpperCase() ?? null;

  if (!ticker) {
    return {
      ok: false,
      reason: 'invalid_payload',
      message: 'Ticker vacío.',
    };
  }

  if (!exchangeCode) {
    return {
      ok: false,
      reason: 'unsupported_exchange',
      message: 'La bolsa es obligatoria para consultar DataBursatil.',
    };
  }

  try {
    const response = await fetch(
      `https://api.databursatil.com/v2/cotizaciones?token=${encodeURIComponent(token)}&emisora_serie=${encodeURIComponent(ticker)}&bolsa=${encodeURIComponent(exchangeCode)}&concepto=U,P,A,X,N,C,M,V,O,I,F`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'network_error',
        message: `DataBursatil ${response.status}`,
      };
    }

    const payload = (await response.json()) as DataBursatilResponse;
    const tickerPayload = payload[ticker];
    const marketPayload = tickerPayload?.[exchangeCode.toLowerCase()];

    if (!marketPayload || !Number.isFinite(marketPayload.u) || marketPayload.u == null || marketPayload.u <= 0) {
      return {
        ok: false,
        reason: 'invalid_payload',
        message: 'DataBursatil devolvió un precio inválido para el ticker.',
      };
    }

    return {
      ok: true,
      quote: {
        ticker,
        exchangeCode,
        providerId: 'databursatil',
        sourceCurrencyCode: 'MXN',
        currentPrice: Number(marketPayload.u.toFixed(6)),
        changeAmount: Number.isFinite(marketPayload.m) ? Number(marketPayload.m!.toFixed(6)) : null,
        changePercent: Number.isFinite(marketPayload.c) ? Number((marketPayload.c! / 100).toFixed(6)) : null,
        dayHigh: Number.isFinite(marketPayload.x) && marketPayload.x! > 0 ? Number(marketPayload.x!.toFixed(6)) : null,
        dayLow: Number.isFinite(marketPayload.n) && marketPayload.n! > 0 ? Number(marketPayload.n!.toFixed(6)) : null,
        priceTimestamp: parseDataBursatilTimestamp(marketPayload.f),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'network_error',
      message: error instanceof Error ? error.message : 'Error de red con DataBursatil.',
    };
  }
}
