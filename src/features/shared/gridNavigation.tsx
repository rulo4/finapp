import { createContext, useContext, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { type Column, type DataGridHandle } from 'react-data-grid';

export type GridEditorNavigationRequest = {
  rowIdx: number;
  columnIdx: number;
  columnKey: string;
};

type GridEditorNavigationHandler = (request: GridEditorNavigationRequest) => void;

const GridEditorNavigationContext = createContext<GridEditorNavigationHandler | null>(null);

type GridEditorNavigationProviderProps = {
  children: ReactNode;
  onNavigateToNextCell?: GridEditorNavigationHandler;
};

type GridCellEditabilityArgs<TRow> = {
  row: TRow;
  column: Column<TRow>;
  rowIdx: number;
};

export type GridCellEditability<TRow> = (args: GridCellEditabilityArgs<TRow>) => boolean;

export function GridEditorNavigationProvider({ children, onNavigateToNextCell }: GridEditorNavigationProviderProps) {
  return <GridEditorNavigationContext.Provider value={onNavigateToNextCell ?? null}>{children}</GridEditorNavigationContext.Provider>;
}

export function useGridEditorNavigation() {
  return useContext(GridEditorNavigationContext);
}

export function focusGridCellEditor(
  gridRef: RefObject<DataGridHandle | null>,
  autoEditCellRef: MutableRefObject<string | null>,
  rowIdx: number,
  columnIdx: number,
  columnKey: string,
) {
  const cellId = `${rowIdx}:${columnKey}`;

  if (autoEditCellRef.current === cellId) {
    return;
  }

  autoEditCellRef.current = cellId;

  window.setTimeout(() => {
    gridRef.current?.selectCell({ rowIdx, idx: columnIdx }, { enableEditor: true, shouldFocusCell: true });

    window.setTimeout(() => {
      if (autoEditCellRef.current === cellId) {
        autoEditCellRef.current = null;
      }
    }, 0);
  }, 0);
}

export function moveToNextEditableGridCell<TRow>({
  gridRef,
  columns,
  rows,
  rowIdx,
  columnIdx,
  isCellEditable,
}: {
  gridRef: RefObject<DataGridHandle | null>;
  columns: readonly Column<TRow>[];
  rows: readonly TRow[];
  rowIdx: number;
  columnIdx: number;
  isCellEditable?: GridCellEditability<TRow>;
}) {
  for (let nextRowIdx = rowIdx; nextRowIdx < rows.length; nextRowIdx += 1) {
    const startColumnIdx = nextRowIdx === rowIdx ? columnIdx + 1 : 0;

    for (let nextColumnIdx = startColumnIdx; nextColumnIdx < columns.length; nextColumnIdx += 1) {
      const row = rows[nextRowIdx];
      const column = columns[nextColumnIdx];
      const editable = isCellEditable
        ? isCellEditable({ row, column, rowIdx: nextRowIdx })
        : Boolean(column.renderEditCell) && column.editable !== false;

      if (!editable) {
        continue;
      }

      gridRef.current?.selectCell({ rowIdx: nextRowIdx, idx: nextColumnIdx }, { enableEditor: true, shouldFocusCell: true });
      return true;
    }
  }

  return false;
}