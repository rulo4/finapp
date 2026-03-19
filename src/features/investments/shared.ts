import type { SelectOption } from '../shared/gridEditors';

export type Broker = {
  id: string;
  name: string;
};

export type InvestmentEntity = {
  id: string;
  name: string;
};

export type InvestmentDateFilterMode = 'all' | 'month' | 'year';

export const investmentCurrencyOptions: readonly SelectOption[] = [
  { value: 'MXN', label: 'MXN' },
  { value: 'USD', label: 'USD' },
];

export function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getStartOfCurrentMonth() {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
}

export function getStartOfCurrentYear() {
  const today = new Date();

  return new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export function getDateRange(mode: InvestmentDateFilterMode) {
  if (mode === 'month') {
    return {
      start: getStartOfCurrentMonth(),
      end: getTodayDate(),
    };
  }

  if (mode === 'year') {
    return {
      start: getStartOfCurrentYear(),
      end: getTodayDate(),
    };
  }

  return {
    start: '',
    end: '',
  };
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
