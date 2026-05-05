import { formatLocalDateAsIsoString, getTodayIsoDate } from './isoDate';

export type PeriodFilterSelection = {
  mode: 'all' | 'range';
  year: number;
  month: number | null;
};

type PeriodFilterProps = {
  ariaLabel: string;
  value: PeriodFilterSelection;
  onChange: (value: PeriodFilterSelection) => void;
  disabled?: boolean;
  minYear?: number;
};

const MONTH_ABBREVIATIONS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'] as const;

function getMonthStartIsoDate(year: number, month: number) {
  return formatLocalDateAsIsoString(new Date(year, month - 1, 1));
}

function getMonthEndIsoDate(year: number, month: number) {
  return formatLocalDateAsIsoString(new Date(year, month, 0));
}

function getYearStartIsoDate(year: number) {
  return formatLocalDateAsIsoString(new Date(year, 0, 1));
}

function getYearEndIsoDate(year: number) {
  return formatLocalDateAsIsoString(new Date(year, 11, 31));
}

function isCurrentPeriod(year: number, month: number) {
  const today = new Date();

  return today.getFullYear() === year && today.getMonth() + 1 === month;
}

function isCurrentYear(year: number) {
  return new Date().getFullYear() === year;
}

function getYearOptions(minYear: number, selectedYear: number) {
  const currentYear = new Date().getFullYear();
  const endYear = Math.max(currentYear, selectedYear);

  return Array.from({ length: endYear - minYear + 1 }, (_, index) => String(endYear - index));
}

function getMonthOptions() {
  return [
    { value: '', label: 'TODO' },
    ...Array.from({ length: 12 }, (_, monthIndex) => ({
      value: String(monthIndex + 1),
      label: MONTH_ABBREVIATIONS[monthIndex],
    })),
  ];
}

export function createCurrentPeriodSelection(): PeriodFilterSelection {
  const today = new Date();

  return {
    mode: 'range',
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  };
}

export function getPeriodDateRange(
  selection: PeriodFilterSelection,
  options?: { clampCurrentMonthToToday?: boolean; clampCurrentYearToToday?: boolean },
) {
  if (selection.mode === 'all') {
    return {
      start: '',
      end: '',
    };
  }

  if (selection.month == null) {
    return {
      start: getYearStartIsoDate(selection.year),
      end: options?.clampCurrentYearToToday && isCurrentYear(selection.year) ? getTodayIsoDate() : getYearEndIsoDate(selection.year),
    };
  }

  return {
    start: getMonthStartIsoDate(selection.year, selection.month),
    end: options?.clampCurrentMonthToToday && isCurrentPeriod(selection.year, selection.month)
      ? getTodayIsoDate()
      : getMonthEndIsoDate(selection.year, selection.month),
  };
}

export function PeriodFilter({ ariaLabel, value, onChange, disabled = false, minYear = 2020 }: PeriodFilterProps) {
  const monthOptions = getMonthOptions();
  const yearOptions = getYearOptions(minYear, value.year);
  const yearFieldClassName = [
    'income-period-filter__field',
    value.mode !== 'all' ? 'income-period-filter__field--active' : '',
    disabled ? 'income-period-filter__field--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const monthFieldClassName = [
    'income-period-filter__field',
    value.mode !== 'all' && value.month != null ? 'income-period-filter__field--active' : '',
    disabled ? 'income-period-filter__field--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const yearValue = value.mode === 'all' ? '' : String(value.year);
  const monthValue = value.mode === 'all' || value.month == null ? '' : String(value.month);

  return (
    <div className="income-period-filter" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`income-period-filter__button ${value.mode === 'all' ? 'income-period-filter__button--active' : ''}`}
        onClick={() => onChange({ ...value, mode: 'all' })}
        disabled={disabled}
      >
        Todo
      </button>

      <div className={yearFieldClassName}>
        <select
          className="income-period-filter__select"
          value={yearValue}
          aria-label="Seleccionar año"
          onChange={(event) => {
            if (!event.target.value) {
              return;
            }

            onChange({
              mode: 'range',
              year: Number(event.target.value),
              month: value.month,
            });
          }}
          disabled={disabled}
        >
          <option value=""> </option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <div className={monthFieldClassName}>
        <select
          className="income-period-filter__select"
          value={monthValue}
          aria-label="Seleccionar mes"
          onChange={(event) => {
            onChange({
              mode: 'range',
              year: value.year,
              month: event.target.value ? Number(event.target.value) : null,
            });
          }}
          disabled={disabled}
        >
          {monthOptions.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
