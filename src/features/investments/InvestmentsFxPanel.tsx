import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { faArrowRightArrowLeft, faDollarSign } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type FxApiResponse = {
  base: string;
  target: string;
  rate: number;
  timestamp: string;
};

type EditedCurrency = 'USD' | 'MXN';

const FX_API_URL = 'https://fxapi.app/api/usd/mxn.json';
const FX_REFRESH_INTERVAL_MS = 5 * 60 * 1000 + 1000;
const FX_RETRY_INTERVAL_MS = 60 * 1000;

const rateFormatter = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
});

function parseAmount(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number(trimmedValue.replace(/,/g, '.'));
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatAmount(value: number) {
  return value.toFixed(2);
}

export function InvestmentsFxPanel() {
  const [rate, setRate] = useState<number | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [usdValue, setUsdValue] = useState('');
  const [mxnValue, setMxnValue] = useState('');
  const [lastEdited, setLastEdited] = useState<EditedCurrency>('USD');
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const valuesRef = useRef({ usdValue: '', mxnValue: '', lastEdited: 'USD' as EditedCurrency });

  const syncValuesFromSource = useCallback((source: EditedCurrency, sourceValue: string, nextRate: number | null) => {
    const parsedValue = parseAmount(sourceValue);

    if (source === 'USD') {
      setUsdValue(sourceValue);

      if (parsedValue == null || nextRate == null) {
        setMxnValue('');
        return;
      }

      setMxnValue(formatAmount(parsedValue * nextRate));
      return;
    }

    setMxnValue(sourceValue);

    if (parsedValue == null || nextRate == null || nextRate <= 0) {
      setUsdValue('');
      return;
    }

    setUsdValue(formatAmount(parsedValue / nextRate));
  }, []);

  const scheduleNextRefresh = useCallback((nextTimestamp: string) => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
    }

    const nextRefreshAt = Date.parse(nextTimestamp) + FX_REFRESH_INTERVAL_MS;
    const delay = Number.isFinite(nextRefreshAt) ? Math.max(0, nextRefreshAt - Date.now()) : FX_REFRESH_INTERVAL_MS;

    timeoutRef.current = window.setTimeout(() => {
      void loadRate();
    }, delay);
  }, []);

  const loadRate = useCallback(async () => {
    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(FX_API_URL, {
        cache: 'no-store',
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`FX API ${response.status}`);
      }

      const payload = (await response.json()) as FxApiResponse;

      if (!Number.isFinite(payload.rate) || Number.isNaN(Date.parse(payload.timestamp))) {
        throw new Error('FX API invalid payload');
      }

      setRate(payload.rate);
      setTimestamp(payload.timestamp);
      setError(null);

      const currentValues = valuesRef.current;
      const sourceValue = currentValues.lastEdited === 'USD' ? currentValues.usdValue : currentValues.mxnValue;

      if (sourceValue) {
        syncValuesFromSource(currentValues.lastEdited, sourceValue, payload.rate);
      }

      scheduleNextRefresh(payload.timestamp);
    } catch (loadError) {
      if (abortController.signal.aborted) {
        return;
      }

      console.error(loadError);
      setError('Sin señal');

      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        void loadRate();
      }, FX_RETRY_INTERVAL_MS);
    }
  }, [scheduleNextRefresh, syncValuesFromSource]);

  useEffect(() => {
    valuesRef.current = { usdValue, mxnValue, lastEdited };
  }, [usdValue, mxnValue, lastEdited]);

  useEffect(() => {
    void loadRate();

    return () => {
      abortControllerRef.current?.abort();

      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [loadRate]);

  const handleUsdChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setLastEdited('USD');
      syncValuesFromSource('USD', nextValue, rate);
    },
    [rate, syncValuesFromSource],
  );

  const handleMxnChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setLastEdited('MXN');
      syncValuesFromSource('MXN', nextValue, rate);
    },
    [rate, syncValuesFromSource],
  );

  const rateLabel = rate == null ? '—' : rateFormatter.format(rate);
  const statusLabel = useMemo(() => {
    if (error) {
      return error;
    }

    if (!timestamp) {
      return 'Cargando';
    }

    return timeFormatter.format(new Date(timestamp));
  }, [error, timestamp]);

  const panelTitle = timestamp ? `Actualizado ${new Date(timestamp).toLocaleString('es-MX')}` : 'Tipo de cambio USD a MXN';

  return (
    <section className={`investments-fx-panel${error ? ' investments-fx-panel--error' : ''}`} title={panelTitle} aria-label="Tipo de cambio y conversor USD a MXN">
      <div className="investments-fx-panel__quote" aria-live="polite">
        <span className="investments-fx-panel__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faDollarSign} />
        </span>
        <strong className="investments-fx-panel__rate">USD/MXN {rateLabel}</strong>
        <span className="investments-fx-panel__status">{statusLabel}</span>
      </div>

      <label className="investments-fx-panel__field investments-fx-panel__field--inline">
        <span className="investments-fx-panel__currency">USD</span>
        <input
          className="investments-fx-panel__input"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={usdValue}
          onChange={handleUsdChange}
          aria-label="Monto en USD"
          autoComplete="off"
        />
      </label>

      <span className="investments-fx-panel__swap" aria-hidden="true">
        <FontAwesomeIcon icon={faArrowRightArrowLeft} />
      </span>

      <label className="investments-fx-panel__field investments-fx-panel__field--inline">
        <span className="investments-fx-panel__currency">MXN</span>
        <input
          className="investments-fx-panel__input"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={mxnValue}
          onChange={handleMxnChange}
          aria-label="Monto en MXN"
          autoComplete="off"
        />
      </label>
    </section>
  );
}
