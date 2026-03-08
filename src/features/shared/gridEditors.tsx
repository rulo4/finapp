import { useEffect, useRef } from 'react';
import { type RenderEditCellProps } from 'react-data-grid';

type EditorRow = Record<string, unknown>;

export type SelectOption = {
  value: string;
  label: string;
};

type InputCellEditorProps<TRow extends EditorRow> = RenderEditCellProps<TRow> & {
  inputType?: 'text' | 'number' | 'date';
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

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
  const selectRef = useRef<HTMLSelectElement>(null);
  const key = column.key as keyof TRow;

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  return (
    <select
      ref={selectRef}
      className="grid-cell-editor"
      value={String(row[key] ?? '')}
      onChange={(event) => {
        onRowChange({ ...row, [key]: event.target.value } as TRow, true);
      }}
      onBlur={() => onClose(true, true)}
    >
      {options.map((option) => (
        <option key={option.value || '__empty'} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}