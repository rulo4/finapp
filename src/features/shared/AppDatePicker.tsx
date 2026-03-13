import { forwardRef, type InputHTMLAttributes, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import { format } from 'date-fns';
import { ISO_DATE_PLACEHOLDER, isIsoDateString } from './isoDate';

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
}: AppDatePickerProps) {
  const selectedDate = useMemo(() => toDate(value), [value]);
  const minDate = useMemo(() => toDate(min ?? ''), [min]);
  const maxDate = useMemo(() => toDate(max ?? ''), [max]);

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

        onChange((event.target as HTMLInputElement).value);
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onCalendarClose={onCalendarClose}
      dateFormat="yyyy-MM-dd"
      placeholderText={placeholder ?? ISO_DATE_PLACEHOLDER}
      autoFocus={autoFocus}
      minDate={minDate ?? undefined}
      maxDate={maxDate ?? undefined}
      portalId="root"
      popperPlacement="bottom-start"
      showPopperArrow={false}
      customInput={<DateInput className={className} aria-label={ariaLabel} />}
      calendarStartDay={1}
    />
  );
}