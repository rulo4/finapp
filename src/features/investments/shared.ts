import type { SelectOption } from '../shared/gridEditors';
import { getTodayIsoDate } from '../shared/isoDate';
import { createCurrentPeriodSelection, getPeriodDateRange, type PeriodFilterSelection } from '../shared/PeriodFilter';

export type Broker = {
  id: string;
  name: string;
  default_fee_factor?: number | null;
};

export type Security = {
  id: string;
  ticker: string;
  company_name: string;
  sector?: string | null;
  industry?: string | null;
  exchange_code: string | null;
  instrument_type?: string | null;
  is_active: boolean;
};

export type InvestmentEntity = {
  id: string;
  name: string;
  is_closed: boolean;
};

export type InvestmentDateFilter = PeriodFilterSelection;

export const investmentCurrencyOptions: readonly SelectOption[] = [
  { value: 'MXN', label: 'MXN' },
  { value: 'USD', label: 'USD' },
];

export function getTodayDate() {
  return getTodayIsoDate();
}

export function createCurrentInvestmentDateFilter() {
  return createCurrentPeriodSelection();
}

export function getDateRange(filter: InvestmentDateFilter) {
  return getPeriodDateRange(filter, {
    clampCurrentMonthToToday: true,
    clampCurrentYearToToday: true,
  });
}

export function isDateWithinRange(date: string, range: { start: string; end: string }) {
  if (range.start && date < range.start) {
    return false;
  }

  if (range.end && date > range.end) {
    return false;
  }

  return true;
}

export function formatEditableNumber(value: number | null | undefined) {
  if (value == null) {
    return '';
  }

  return String(Number(value));
}

export function formatCurrencyTotal(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatQuantityTotal(value: number) {
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatPercentage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('es-MX', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatSecurityLabel(security: Security) {
  const exchangeSuffix = security.exchange_code?.trim() ? ` (${security.exchange_code.trim().toUpperCase()})` : '';

  return `${security.ticker}${exchangeSuffix}`;
}

export function formatSecurityOptionLabel(security: Security) {
  return `${formatSecurityLabel(security)} · ${security.company_name}`;
}

export function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function commitActiveEditorAndRun(action: () => void) {
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }

  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(action);
    });
  }, 0);
}

export function isErrorFeedback(message: string) {
  const normalizedMessage = message.trim();

  return (
    /^(no\b|supabase\b|necesitas\b|primero\b|la fecha\b|la fila\b|el\b|la\b|selecciona\b|captura\b|este\b)/i.test(
      normalizedMessage,
    ) || /no se pudo/i.test(normalizedMessage)
  );
}
