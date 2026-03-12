import { useMemo, useState } from 'react';
import { DataGrid, type Column, renderTextEditor } from 'react-data-grid';

export type SampleRow = {
  id: number;
  status: 'new' | 'saved' | 'error';
  date: string;
  primary: string;
  secondary: string;
  amount: number;
};

const initialRows: SampleRow[] = [
  { id: 1, status: 'new', date: '', primary: '', secondary: '', amount: 0 },
  { id: 2, status: 'saved', date: '2026-03-05', primary: 'Registro reciente', secondary: 'MXN', amount: 1200 },
  { id: 3, status: 'error', date: '2026-03-03', primary: 'Pendiente validar', secondary: 'USD', amount: 0 },
];

export function SampleGrid({ primaryLabel }: { primaryLabel: string }) {
  const [rows, setRows] = useState(initialRows);
  const defaultColumnWidth = 120;

  const columns = useMemo<readonly Column<SampleRow>[]>(
    () => [
      { key: 'date', name: 'Fecha', frozen: true, width: defaultColumnWidth, renderEditCell: renderTextEditor },
      { key: 'primary', name: primaryLabel, frozen: true, width: defaultColumnWidth, renderEditCell: renderTextEditor },
      { key: 'secondary', name: 'Secundario', width: defaultColumnWidth, renderEditCell: renderTextEditor },
      { key: 'amount', name: 'Monto', width: defaultColumnWidth, renderEditCell: renderTextEditor }
    ],
    [defaultColumnWidth, primaryLabel],
  );

  return (
    <div className="grid-wrapper">
      <DataGrid
        columns={columns}
        rows={rows}
        onRowsChange={setRows}
        rowKeyGetter={(row) => row.id}
        rowClass={(row) => {
          if (row.status === 'new') return 'row-new';
          if (row.status === 'error') return 'row-error';
          return 'row-saved';
        }}
        style={{ blockSize: 320 }}
      />
    </div>
  );
}
