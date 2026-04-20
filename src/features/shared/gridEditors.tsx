import { useEffect, useId, useMemo, useRef, type Ref } from 'react';
import { type RenderEditCellProps } from 'react-data-grid';
import Select, { type SelectInstance, type StylesConfig } from 'react-select';
import { AppDatePicker } from './AppDatePicker';
import { useGridEditorNavigation } from './gridNavigation';
import { ISO_DATE_PLACEHOLDER } from './isoDate';

type EditorRow = Record<string, unknown>;

export type SupportedFxCurrencyCode = 'MXN' | 'USD';

export const FX_AUTO_SWITCH_FEEDBACK = 'Moneda actualizada a USD al capturar un FX distinto de 1.';

export function shouldAutoSwitchCurrencyFromFx(currencyCode: SupportedFxCurrencyCode, fxRateToMxn: string) {
  if (currencyCode !== 'MXN') {
    return false;
  }

  const normalizedFxRate = fxRateToMxn.trim();

  if (!normalizedFxRate) {
    return false;
  }

  const parsedFxRate = Number(normalizedFxRate);

  return Number.isFinite(parsedFxRate) && parsedFxRate > 0 && parsedFxRate !== 1;
}

export function autoSwitchCurrencyFromFx<TRow extends { currencyCode: SupportedFxCurrencyCode; fxRateToMxn: string }>(row: TRow): TRow {
  if (!shouldAutoSwitchCurrencyFromFx(row.currencyCode, row.fxRateToMxn)) {
    return row;
  }

  return {
    ...row,
    currencyCode: 'USD',
  };
}

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

const compactSelectStyles: StylesConfig<SelectOption, false> = {
  ...selectStyles,
  control: (base, state) => ({
    ...selectStyles.control?.(base, state),
    minHeight: 28,
    height: 28,
    borderRadius: 0,
    borderWidth: 0,
    boxShadow: 'none',
  }),
  valueContainer: (base, props) => ({
    ...selectStyles.valueContainer?.(base, props),
    height: 28,
    padding: '0 8px',
  }),
  input: (base, props) => ({
    ...selectStyles.input?.(base, props),
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base) => ({
    ...base,
    height: 28,
  }),
  dropdownIndicator: (base, state) => ({
    ...selectStyles.dropdownIndicator?.(base, state),
    padding: 4,
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: 4,
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
  onKeyDown?: React.KeyboardEventHandler;
  autoFocus?: boolean;
  instanceRef?: Ref<SelectInstance<SelectOption, false>>;
  compact?: boolean;
  isDisabled?: boolean;
};

export function AppSelect({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder,
  isSearchable = true,
  onBlur,
  onKeyDown,
  autoFocus = false,
  instanceRef,
  compact = false,
  isDisabled = false,
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
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      isSearchable={isSearchable}
      isDisabled={isDisabled}
      autoFocus={autoFocus}
      menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
      styles={compact ? compactSelectStyles : selectStyles}
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
  rowIdx,
  onRowChange,
  onClose,
  inputType = 'text',
  min,
  step,
  placeholder,
}: InputCellEditorProps<TRow>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCloseRef = useRef(false);
  const key = column.key as keyof TRow;
  const isIsoDateInput = inputType === 'iso-date';
  const navigateToNextCell = useGridEditorNavigation();

  function commitAndNavigateToNextCell() {
    skipBlurCloseRef.current = true;
    onClose(true, true);

    window.setTimeout(() => {
      navigateToNextCell?.({
        rowIdx,
        columnIdx: column.idx,
        columnKey: String(column.key),
      });
    }, 0);
  }

  function closeEditorDeferred(shouldCommit: boolean) {
    queueMicrotask(() => {
      onClose(shouldCommit, true);
    });
  }

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
        onCalendarClose={() => {
          if (skipBlurCloseRef.current) {
            return;
          }

          closeEditorDeferred(true);
        }}
        enterKeyHint={navigateToNextCell ? 'next' : 'done'}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitAndNavigateToNextCell();
          }

          if (event.key === 'Escape') {
            closeEditorDeferred(false);
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
      enterKeyHint={navigateToNextCell ? 'next' : 'done'}
      value={String(row[key] ?? '')}
      onChange={(event) => {
        onRowChange({ ...row, [key]: event.target.value } as TRow);
      }}
      onBlur={() => {
        if (skipBlurCloseRef.current) {
          return;
        }

        onClose(true, true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitAndNavigateToNextCell();
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
  rowIdx,
  onRowChange,
  onClose,
  options,
}: SelectCellEditorProps<TRow>) {
  const selectRef = useRef<SelectInstance<SelectOption, false>>(null);
  const skipBlurCloseRef = useRef(false);
  const pendingNavigateRef = useRef(false);
  const key = column.key as keyof TRow;
  const navigateToNextCell = useGridEditorNavigation();

  function commitAndNavigateToNextCell() {
    if (skipBlurCloseRef.current) {
      return;
    }

    skipBlurCloseRef.current = true;
    onClose(true, true);

    window.setTimeout(() => {
      navigateToNextCell?.({
        rowIdx,
        columnIdx: column.idx,
        columnKey: String(column.key),
      });
    }, 0);
  }

  useEffect(() => {
    window.setTimeout(() => {
      selectRef.current?.focus();
    }, 0);
  }, []);

  return (
    <AppSelect
      instanceRef={selectRef}
      ariaLabel={column.name ? String(column.name) : 'Seleccionar opcion'}
      options={options}
      value={String(row[key] ?? '')}
      compact
      autoFocus
      onChange={(nextValue) => {
        pendingNavigateRef.current = false;
        onRowChange({ ...row, [key]: nextValue } as TRow, true);
        commitAndNavigateToNextCell();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          pendingNavigateRef.current = true;
        }

        if (event.key === 'Escape') {
          skipBlurCloseRef.current = true;
          onClose(false, true);
        }
      }}
      onBlur={() => {
        if (skipBlurCloseRef.current) {
          return;
        }

        if (pendingNavigateRef.current) {
          pendingNavigateRef.current = false;
          commitAndNavigateToNextCell();
          return;
        }

        onClose(true, true);
      }}
    />
  );
}