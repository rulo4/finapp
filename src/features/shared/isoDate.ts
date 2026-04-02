export const ISO_DATE_PLACEHOLDER = 'YYYY-MM-DD';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function formatLocalDateAsIsoString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function normalizeIsoDateInput(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 8);

  if (!digits) {
    return '';
  }

  if (digits.length <= 4) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function getTodayIsoDate() {
  return formatLocalDateAsIsoString(new Date());
}

export function getStartOfCurrentMonthIsoDate() {
  const today = new Date();

  return formatLocalDateAsIsoString(new Date(today.getFullYear(), today.getMonth(), 1));
}

export function getStartOfCurrentYearIsoDate() {
  const today = new Date();

  return formatLocalDateAsIsoString(new Date(today.getFullYear(), 0, 1));
}

export function getEndOfCurrentMonthIsoDate() {
  const today = new Date();

  return formatLocalDateAsIsoString(new Date(today.getFullYear(), today.getMonth() + 1, 0));
}

export function getEndOfCurrentYearIsoDate() {
  const today = new Date();

  return formatLocalDateAsIsoString(new Date(today.getFullYear(), 11, 31));
}

export function isIsoDateString(value: string) {
  if (!ISO_DATE_REGEX.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseIsoDateString(value: string) {
  if (!isIsoDateString(value)) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split('-');
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}