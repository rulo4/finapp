export type UsdMxnRateCacheEntry = {
  base: 'USD';
  target: 'MXN';
  rate: number;
  timestamp: string;
  fetchedAt: string;
};

type FxApiResponse = {
  base?: string;
  target?: string;
  rate?: number;
  timestamp?: string;
};

const USD_MXN_STORAGE_KEY = 'auna.fx.usd-mxn';
const FX_API_URL = 'https://fxapi.app/api/usd/mxn.json';
export const USD_MXN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const USD_MXN_RETRY_INTERVAL_MS = 60 * 1000;

let inFlightUsdMxnRequest: Promise<UsdMxnRateCacheEntry> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isValidTimestamp(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function normalizeUsdMxnRateEntry(value: unknown): UsdMxnRateCacheEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.base !== 'USD' || value.target !== 'MXN' || !Number.isFinite(value.rate) || typeof value.timestamp !== 'string' || typeof value.fetchedAt !== 'string') {
    return null;
  }

  if (!isValidTimestamp(value.timestamp) || !isValidTimestamp(value.fetchedAt)) {
    return null;
  }

  return {
    base: 'USD',
    target: 'MXN',
    rate: Number(value.rate),
    timestamp: value.timestamp,
    fetchedAt: value.fetchedAt,
  };
}

export function readUsdMxnRateCache() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(USD_MXN_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return normalizeUsdMxnRateEntry(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function writeUsdMxnRateCache(entry: UsdMxnRateCacheEntry) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(USD_MXN_STORAGE_KEY, JSON.stringify(entry));
}

function getNextRefreshReferenceMs(entry: UsdMxnRateCacheEntry) {
  const timestampMs = Date.parse(entry.timestamp);
  const fetchedAtMs = Date.parse(entry.fetchedAt);
  const candidates = [timestampMs, fetchedAtMs].filter((value) => Number.isFinite(value));

  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
}

export function getUsdMxnRateRefreshDelay(entry: UsdMxnRateCacheEntry, now = Date.now()) {
  const referenceMs = getNextRefreshReferenceMs(entry);
  if (referenceMs == null) {
    return USD_MXN_REFRESH_INTERVAL_MS;
  }

  return Math.max(0, referenceMs + USD_MXN_REFRESH_INTERVAL_MS - now);
}

export function isUsdMxnRateRefreshDue(entry: UsdMxnRateCacheEntry, now = Date.now()) {
  return getUsdMxnRateRefreshDelay(entry, now) <= 0;
}

async function fetchUsdMxnRate(signal?: AbortSignal) {
  const response = await fetch(FX_API_URL, {
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`FX API ${response.status}`);
  }

  const payload = (await response.json()) as FxApiResponse;

  if (payload.base !== 'USD' || payload.target !== 'MXN' || !Number.isFinite(payload.rate) || !isValidTimestamp(payload.timestamp)) {
    throw new Error('FX API invalid payload');
  }

  const entry: UsdMxnRateCacheEntry = {
    base: 'USD',
    target: 'MXN',
    rate: Number((payload.rate as number).toFixed(6)),
    timestamp: payload.timestamp!,
    fetchedAt: new Date().toISOString(),
  };

  writeUsdMxnRateCache(entry);
  return entry;
}

export async function loadUsdMxnRate(options?: { force?: boolean; signal?: AbortSignal }) {
  const cachedEntry = readUsdMxnRateCache();
  if (!options?.force && cachedEntry && !isUsdMxnRateRefreshDue(cachedEntry)) {
    return cachedEntry;
  }

  if (inFlightUsdMxnRequest) {
    return inFlightUsdMxnRequest;
  }

  inFlightUsdMxnRequest = fetchUsdMxnRate(options?.signal).finally(() => {
    inFlightUsdMxnRequest = null;
  });

  return inFlightUsdMxnRequest;
}
