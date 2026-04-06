import { forwardRef, type InputHTMLAttributes, useMemo } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import DatePicker, { type ReactDatePickerCustomHeaderProps } from 'react-datepicker';
import { ISO_DATE_PLACEHOLDER, isIsoDateString, normalizeIsoDateInput } from './isoDate';

type AppDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onCalendarClose?: () => void;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
};

function toDate(value: string) {
  if (!isIsoDateString(value)) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  return new Date(year, month - 1, day);
}

const monthLabelFormatter = new Intl.DateTimeFormat('es-MX', { month: 'long' });

function buildMonthLabels() {
  return Array.from({ length: 12 }, (_, monthIndex) => monthLabelFormatter.format(new Date(2024, monthIndex, 1)));
}

function buildYearOptions(minDate: Date | null, maxDate: Date | null, selectedDate: Date | null) {
  const currentYear = new Date().getFullYear();
  const selectedYear = selectedDate?.getFullYear() ?? currentYear;
  const startYear = minDate?.getFullYear() ?? Math.min(1990, selectedYear - 15);
  const endYear = maxDate?.getFullYear() ?? Math.max(currentYear + 5, selectedYear + 5);

  return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
}

const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function DateInput(props, ref) {
  const { className, ...rest } = props;

  return <input ref={ref} className={className ? `${className} app-date-picker__input` : 'app-date-picker__input'} {...rest} />;
});

export function AppDatePicker({
  value,
  onChange,
  onBlur,
  onKeyDown,
  onCalendarClose,
  ariaLabel,
  className,
  placeholder,
  autoFocus = false,
  min,
  max,
  disabled = false,
}: AppDatePickerProps) {
  const selectedDate = useMemo(() => toDate(value), [value]);
  const minDate = useMemo(() => toDate(min ?? ''), [min]);
  const maxDate = useMemo(() => toDate(max ?? ''), [max]);
  const monthLabels = useMemo(() => buildMonthLabels(), []);
  const yearOptions = useMemo(() => buildYearOptions(minDate, maxDate, selectedDate), [maxDate, minDate, selectedDate]);

  function renderHeader({
    date,
    changeMonth,
    changeYear,
    decreaseMonth,
    increaseMonth,
    prevMonthButtonDisabled,
    nextMonthButtonDisabled,
  }: ReactDatePickerCustomHeaderProps) {
    return (
      <div className="app-date-picker__header">
        <button
          type="button"
          className="app-date-picker__nav"
          onClick={decreaseMonth}
          disabled={prevMonthButtonDisabled}
          aria-label="Mes anterior"
        >
          &lt;
        </button>
        <select
          className="app-date-picker__select app-date-picker__select--month"
          value={date.getMonth()}
          onChange={(event) => changeMonth(Number(event.target.value))}
          aria-label="Mes"
        >
          {monthLabels.map((monthLabel, monthIndex) => (
            <option key={monthLabel} value={monthIndex}>
              {monthLabel}
            </option>
          ))}
        </select>
        <select
          className="app-date-picker__select app-date-picker__select--year"
          value={date.getFullYear()}
          onChange={(event) => changeYear(Number(event.target.value))}
          aria-label="Año"
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="app-date-picker__nav"
          onClick={increaseMonth}
          disabled={nextMonthButtonDisabled}
          aria-label="Mes siguiente"
        >
          &gt;
        </button>
      </div>
    );
  }

  return (
    <DatePicker
      selected={selectedDate}
      onChange={(date: Date | null) => {
        onChange(date instanceof Date && !Number.isNaN(date.getTime()) ? format(date, 'yyyy-MM-dd') : '');
      }}
      onChangeRaw={(event) => {
        if (!event) {
          return;
        }

        const input = event.target instanceof HTMLInputElement ? event.target : null;

        if (!input) {
          return;
        }

        const normalizedValue = normalizeIsoDateInput(input.value);

        if (input.value !== normalizedValue) {
          input.value = normalizedValue;
        }

        onChange(normalizedValue);
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onCalendarClose={onCalendarClose}
      dateFormat="yyyy-MM-dd"
      placeholderText={placeholder ?? ISO_DATE_PLACEHOLDER}
      autoFocus={autoFocus}
      minDate={minDate ?? undefined}
      maxDate={maxDate ?? undefined}
      disabled={disabled}
      locale={es}
      renderCustomHeader={renderHeader}
      portalId="root"
      popperPlacement="bottom-start"
      showPopperArrow={false}
      customInput={<DateInput className={className} aria-label={ariaLabel} disabled={disabled} />}
      calendarClassName="app-date-picker__calendar"
      calendarStartDay={1}
    />
  );
}