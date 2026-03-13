import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle } from 'react-data-grid';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type InstrumentType = 'cash' | 'debit_card' | 'credit_card';

type CatalogConfig = {
  key: string;
  label: string;
  description: string;
  requiresInstrumentType?: boolean;
};

type CatalogDbRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  notes: string | null;
  instrument_type?: InstrumentType;
  created_at: string;
};

type CatalogGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  name: string;
  description: string;
  instrumentType: string;
  isActive: string;
};

const instrumentTypeOptions: readonly SelectOption[] = [
  { value: 'cash', label: 'cash' },
  { value: 'debit_card', label: 'debit_card' },
  { value: 'credit_card', label: 'credit_card' },
];

const activeOptions: readonly SelectOption[] = [
  { value: 'true', label: 'Si' },
  { value: 'false', label: 'No' },
];

const catalogConfigs: CatalogConfig[] = [
  {
    key: 'expense_categories',
    label: 'Categorias de gasto',
    description: 'Clasifica egresos recurrentes y operativos.',
  },
  {
    key: 'income_sources',
    label: 'Fuentes de ingreso',
    description: 'Define de donde proviene cada ingreso capturado.',
  },
  {
    key: 'payment_instruments',
    label: 'Instrumentos de pago',
    description: 'Administra efectivo, debito y credito para egresos.',
    requiresInstrumentType: true,
  },
  {
    key: 'stores',
    label: 'Tiendas',
    description: 'Catalogo de comercios asociados a consumos y compras.',
  },
  {
    key: 'unit_of_measures',
    label: 'Unidades de medida',
    description: 'Define unidades reutilizables para capturar egresos sin texto libre.',
  },
  {
    key: 'brokers',
    label: 'Brokers',
    description: 'Intermediarios para operaciones de inversion.',
  },
  {
    key: 'investment_entities',
    label: 'Entidades de inversion',
    description: 'Empresas, fibras o vehiculos de inversion relacionados.',
  },
];

const defaultCatalog = catalogConfigs[0];
const DEFAULT_COLUMN_WIDTH = 120;
const LONG_DESCRIPTION_COLUMN_WIDTH = 240;

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftCatalogRow(requiresInstrumentType: boolean): CatalogGridRow {
  return {
    id: createLocalId('catalog-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    name: '',
    description: '',
    instrumentType: requiresInstrumentType ? 'cash' : '',
    isActive: 'true',
  };
}

function toCatalogGridRow(row: CatalogDbRow, requiresInstrumentType: boolean): CatalogGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    name: row.name,
    description: row.description ?? '',
    instrumentType: requiresInstrumentType ? row.instrument_type ?? 'cash' : '',
    isActive: row.is_active ? 'true' : 'false',
  };
}

function canSaveDraftCatalogRow(row: CatalogGridRow, requiresInstrumentType: boolean) {
  return Boolean(row.name.trim() && (!requiresInstrumentType || row.instrumentType));
}

function validateCatalogRow(row: CatalogGridRow, requiresInstrumentType: boolean) {
  if (!row.name.trim()) {
    return 'El nombre es obligatorio.';
  }

  if (requiresInstrumentType && !row.instrumentType) {
    return 'Selecciona el tipo de instrumento.';
  }

  if (row.isActive !== 'true' && row.isActive !== 'false') {
    return 'El estado activo no es valido.';
  }

  return null;
}

function formatCatalogIssuesMessage(row: CatalogGridRow, requiresInstrumentType: boolean) {
  const issues: string[] = [];

  if (!row.name.trim()) {
    issues.push('captura el nombre');
  }

  if (requiresInstrumentType && !row.instrumentType) {
    issues.push('selecciona el tipo de instrumento');
  }

  if (issues.length === 0) {
    return 'Revisa los valores de la fila antes de guardar.';
  }

  return `No se puede guardar el registro: ${issues.join(', ')}.`;
}

export function CatalogsPage() {
  const [selectedCatalogKey, setSelectedCatalogKey] = useState(defaultCatalog.key);
  const [rows, setRows] = useState<CatalogGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rowsRef = useRef<CatalogGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, CatalogGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);

  const selectedCatalog = useMemo(
    () => catalogConfigs.find((catalog) => catalog.key === selectedCatalogKey) ?? defaultCatalog,
    [selectedCatalogKey],
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const loadRows = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setRows([]);
      persistedRowsRef.current = new Map();
      setErrorMessage('Supabase no esta configurado en este entorno.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from(selectedCatalog.key)
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      setRows([]);
      persistedRowsRef.current = new Map();
      setErrorMessage(`No fue posible cargar ${selectedCatalog.label.toLowerCase()}: ${error.message}`);
      setIsLoading(false);
      return;
    }

    const nextRows = ((data as CatalogDbRow[]) ?? []).map((row) => toCatalogGridRow(row, Boolean(selectedCatalog.requiresInstrumentType)));
    const loadedRows = [createDraftCatalogRow(Boolean(selectedCatalog.requiresInstrumentType)), ...nextRows];

    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    rowsRef.current = loadedRows;
    setRows(loadedRows);
    setErrorMessage(null);
    setIsLoading(false);
  }, [selectedCatalog]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function commitActiveEditorAndRun(action: () => void) {
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

  const persistCatalogRow = useCallback(
    async (rowId: string) => {
      if (!supabase) {
        setErrorMessage('Supabase no esta disponible para guardar datos.');
        return;
      }

      const row = rowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        setErrorMessage('No se encontró la fila que intentas guardar. Intenta de nuevo.');
        return;
      }

      const requiresInstrumentType = Boolean(selectedCatalog.requiresInstrumentType);

      if (row.isDraft && !canSaveDraftCatalogRow(row, requiresInstrumentType)) {
        const draftErrorMessage = formatCatalogIssuesMessage(row, requiresInstrumentType);

        setRows((currentRows) => {
          const nextRows: CatalogGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setErrorMessage(draftErrorMessage);
        return;
      }

      const validationMessage = validateCatalogRow(row, requiresInstrumentType);

      if (validationMessage) {
        setRows((currentRows) => {
          const nextRows: CatalogGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setErrorMessage(validationMessage);
        return;
      }

      setRows((currentRows) => {
        const nextRows: CatalogGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setErrorMessage(null);

      const payload: Record<string, string | boolean | null> = {
        name: row.name.trim(),
        description: row.description.trim() || null,
        is_active: row.isActive === 'true',
      };

      if (requiresInstrumentType) {
        payload.instrument_type = row.instrumentType as InstrumentType;
      }

      const result = row.isDraft
        ? await supabase.from(selectedCatalog.key).insert(payload)
        : await supabase.from(selectedCatalog.key).update(payload).eq('id', row.persistedId);

      if (result.error) {
        setRows((currentRows) => {
          const nextRows: CatalogGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setErrorMessage(`No fue posible guardar el registro: ${result.error.message}`);
        return;
      }

      await loadRows();
    },
    [loadRows, selectedCatalog],
  );

  const handleDeleteRow = useCallback(
    async (row: CatalogGridRow) => {
      if (row.isDraft) {
        const nextRows = [createDraftCatalogRow(Boolean(selectedCatalog.requiresInstrumentType)), ...rowsRef.current.filter((candidate) => !candidate.isDraft)];
        rowsRef.current = nextRows;
        setRows(nextRows);
        setErrorMessage(null);
        return;
      }

      if (!supabase) {
        setErrorMessage('Supabase no esta disponible para eliminar datos.');
        return;
      }

      if (!window.confirm('Eliminar este registro?')) {
        return;
      }

      const { error } = await supabase.from(selectedCatalog.key).delete().eq('id', row.persistedId);

      if (error) {
        setErrorMessage(`No fue posible eliminar el registro: ${error.message}`);
        return;
      }

      await loadRows();
    },
    [loadRows, selectedCatalog],
  );

  const handleRevertRow = useCallback(
    (row: CatalogGridRow) => {
      if (row.isDraft) {
        const nextRows = [createDraftCatalogRow(Boolean(selectedCatalog.requiresInstrumentType)), ...rowsRef.current.filter((candidate) => !candidate.isDraft)];
        rowsRef.current = nextRows;
        setRows(nextRows);
        setErrorMessage(null);
        return;
      }

      const persistedRow = persistedRowsRef.current.get(row.id);

      if (!persistedRow) {
        return;
      }

      setRows((currentRows) => {
        const nextRows: CatalogGridRow[] = currentRows.map((candidate) => (candidate.id === row.id ? persistedRow : candidate));
        rowsRef.current = nextRows;
        return nextRows;
      });
      setErrorMessage(null);
    },
    [selectedCatalog],
  );

  function handleRowsChange(nextRows: CatalogGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0];

    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const editedRow = nextRows[rowIndex];
    const validationMessage = editedRow.isDraft ? null : validateCatalogRow(editedRow, Boolean(selectedCatalog.requiresInstrumentType));
    const updatedRows: CatalogGridRow[] = nextRows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...editedRow,
        status: validationMessage ? 'error' : editedRow.isDraft ? 'new' : 'dirty',
        errorMessage: validationMessage,
      };
    });

    rowsRef.current = updatedRows;
    setRows(updatedRows);
  }

  function focusCellEditor(rowIdx: number, columnIdx: number, columnKey: string) {
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

  const columns = useMemo<readonly Column<CatalogGridRow>[]>(() => {
    const baseColumns: Column<CatalogGridRow>[] = [
      {
        key: 'actions',
        name: '',
        width: 78,
        frozen: true,
        editable: false,
        renderCell: ({ row }) => (
          <div className="grid-actions">
            {row.isDraft || row.status === 'dirty' || row.status === 'error' ? (
              <>
                <button
                  type="button"
                  className="grid-action grid-action--save"
                  title="Guardar"
                  aria-label="Guardar"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    commitActiveEditorAndRun(() => {
                      void persistCatalogRow(row.id);
                    });
                  }}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                {!row.isDraft ? (
                  <button
                    type="button"
                    className="grid-action grid-action--revert"
                    title="Revertir"
                    aria-label="Revertir"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleRevertRow(row);
                    }}
                  >
                    <FontAwesomeIcon icon={faRotateLeft} />
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className={`grid-action ${row.isDraft ? 'grid-action--clear' : 'grid-action--delete'}`}
              title={row.isDraft ? 'Limpiar' : 'Eliminar'}
              aria-label={row.isDraft ? 'Limpiar' : 'Eliminar'}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleDeleteRow(row);
              }}
            >
              <FontAwesomeIcon icon={row.isDraft ? faEraser : faTrash} />
            </button>
          </div>
        ),
      },
      {
        key: 'name',
        name: 'Nombre',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Nuevo registro" />,
      },
      {
        key: 'description',
        name: 'Descripcion',
        width: selectedCatalog.key === 'expense_categories' ? LONG_DESCRIPTION_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH,
        renderCell: ({ row }) => row.description || '-',
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Contexto opcional" />,
      },
    ];

    if (selectedCatalog.requiresInstrumentType) {
      baseColumns.push({
        key: 'instrumentType',
        name: 'Tipo',
        width: DEFAULT_COLUMN_WIDTH,
        renderCell: ({ row }) => row.instrumentType || '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={instrumentTypeOptions} />,
      });
    }

    return baseColumns;
  }, [handleDeleteRow, handleRevertRow, persistCatalogRow, selectedCatalog]);

  const currentRowError = rows.find((row) => row.status === 'error')?.errorMessage;
  const visibleErrorMessage = currentRowError ?? errorMessage;

  return (
    <div className="page">
      <section className="card catalog-layout">
        <section className="catalog-panel">
          <div className="catalog-panel__header catalog-panel__header--compact">
            <div className="catalog-selector">
              <select value={selectedCatalogKey} onChange={(event) => setSelectedCatalogKey(event.target.value)} aria-label="Catalogo activo">
                {catalogConfigs.map((catalog) => (
                  <option key={catalog.key} value={catalog.key}>
                    {catalog.label}
                  </option>
                ))}
              </select>
            </div>
            <span className={`status-pill status-pill--${isLoading ? 'checking' : 'ok'}`}>
              {isLoading ? 'Cargando' : `${rows.filter((row) => !row.isDraft).length} registros`}
            </span>
          </div>

          {visibleErrorMessage ? <div className="feedback-banner feedback-banner--error">{visibleErrorMessage}</div> : null}

          <div className="grid-wrapper grid-wrapper--tall">
            <DataGrid
              ref={gridRef}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleRowsChange}
              onCellClick={(args) => {
                if (args.column.renderEditCell) {
                  args.selectCell(true);
                }
              }}
              onSelectedCellChange={(args) => {
                if (args.row && args.column.renderEditCell) {
                  focusCellEditor(args.rowIdx, args.column.idx, args.column.key);
                }
              }}
              defaultColumnOptions={{ resizable: true }}
              rowClass={(row) => {
                if (row.status === 'saving') return 'row-saving';
                if (row.status === 'error') return 'row-error';
                if (row.status === 'new') return 'row-new';
                if (row.status === 'dirty') return 'row-dirty';
                return 'row-saved';
              }}
              style={{ blockSize: 500 }}
            />
          </div>
        </section>
      </section>
    </div>
  );
}
