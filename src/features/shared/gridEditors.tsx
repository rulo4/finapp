import { useEffect, useId, useMemo, useRef, type Ref } from 'react';
import { type RenderEditCellProps } from 'react-data-grid';
import Select, { type SelectInstance, type StylesConfig } from 'react-select';
import { AppDatePicker } from './AppDatePicker';
import { ISO_DATE_PLACEHOLDER } from './isoDate';

type EditorRow = Record<string, unknown>;

export type SelectOption = {
  value: string;
  label: string;
};

const selectStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 10,
    borderColor: state.isFocused ? '#93c5fd' : '#cbd5e1',
    boxShadow: state.isFocused ? '0 0 0 1px #93c5fd' : 'none',
    backgroundColor: '#fff',
    cursor: 'pointer',
    '&:hover': {
      borderColor: state.isFocused ? '#93c5fd' : '#94a3b8',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '2px 10px',
  }),
  input: (base) => ({
    ...base,
    margin: 0,
    padding: 0,
    color: '#0f172a',
  }),
  singleValue: (base) => ({
    ...base,
    color: '#0f172a',
  }),
  placeholder: (base) => ({
    ...base,
    color: '#64748b',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: '#64748b',
    padding: 6,
  }),
  menu: (base) => ({
    ...base,
    zIndex: 30,
    borderRadius: 10,
    overflow: 'hidden',
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? '#dbeafe' : state.isFocused ? '#eff6ff' : '#fff',
    color: '#0f172a',
    cursor: 'pointer',
  }),
};

type AppSelectProps = {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  isSearchable?: boolean;
  onBlur?: () => void;
  autoFocus?: boolean;
  instanceRef?: Ref<SelectInstance<SelectOption, false>>;
};

export function AppSelect({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder,
  isSearchable = true,
  onBlur,
  autoFocus = false,
  instanceRef,
}: AppSelectProps) {
  const inputId = useId();
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  return (
    <Select<SelectOption, false>
      ref={instanceRef}
      inputId={inputId}
      aria-label={ariaLabel}
      classNamePrefix="app-select"
      options={[...options]}
      value={selectedOption}
      onChange={(option) => onChange(option?.value ?? '')}
      onBlur={onBlur}
      placeholder={placeholder}
      isSearchable={isSearchable}
      autoFocus={autoFocus}
      menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
      styles={selectStyles}
      noOptionsMessage={() => 'Sin opciones'}
    />
  );
}

type InputCellEditorProps<TRow extends EditorRow> = RenderEditCellProps<TRow> & {
  inputType?: 'text' | 'number' | 'date' | 'iso-date';
  min?: string;
  step?: string;
  placeholder?: string;
};

export function InputCellEditor<TRow extends EditorRow>({
  column,
  row,
  onRowChange,
  onClose,
  inputType = 'text',
  min,
  step,
  placeholder,
}: InputCellEditorProps<TRow>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const key = column.key as keyof TRow;
  const isIsoDateInput = inputType === 'iso-date';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (isIsoDateInput) {
    return (
      <AppDatePicker
        className="grid-cell-editor"
        ariaLabel={column.name ? String(column.name) : 'Fecha'}
        value={String(row[key] ?? '')}
        autoFocus
        onChange={(nextValue) => {
          onRowChange({ ...row, [key]: nextValue } as TRow);
        }}
        onCalendarClose={() => onClose(true, true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onClose(true, true);
          }

          if (event.key === 'Escape') {
            onClose(false, true);
          }
        }}
        placeholder={placeholder ?? ISO_DATE_PLACEHOLDER}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      className="grid-cell-editor"
      type={inputType}
      min={min}
      step={step}
      placeholder={placeholder}
      value={String(row[key] ?? '')}
      onChange={(event) => {
        onRowChange({ ...row, [key]: event.target.value } as TRow);
      }}
      onBlur={() => onClose(true, true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onClose(true, true);
        }

        if (event.key === 'Escape') {
          onClose(false, true);
        }
      }}
    />
  );
}

type SelectCellEditorProps<TRow extends EditorRow> = RenderEditCellProps<TRow> & {
  options: readonly SelectOption[];
};

export function SelectCellEditor<TRow extends EditorRow>({
  column,
  row,
  onRowChange,
  onClose,
  options,
}: SelectCellEditorProps<TRow>) {
  const selectRef = useRef<SelectInstance<SelectOption, false>>(null);
  const key = column.key as keyof TRow;

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  return (
    <AppSelect
      instanceRef={selectRef}
      ariaLabel={column.name ? String(column.name) : 'Seleccionar opcion'}
      options={options}
      value={String(row[key] ?? '')}
      autoFocus
      onChange={(nextValue) => {
        onRowChange({ ...row, [key]: nextValue } as TRow, true);
        onClose(true, true);
      }}
      onBlur={() => onClose(true, true)}
    />
  );
}