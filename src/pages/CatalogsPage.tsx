import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faEraser,
  faFloppyDisk,
  faRotateLeft,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle } from 'react-data-grid';
import { useNavigate, useParams } from 'react-router-dom';
import { catalogConfigs, defaultCatalog, getCatalogConfig, getCatalogPath, type CatalogConfig, type CatalogKind } from '../config/catalogs';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { GridEditorNavigationProvider, moveToNextEditableGridCell } from '../features/shared/gridNavigation';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type PaymentInstrumentType = 'cash' | 'debit_card' | 'credit_card';
type SecurityInstrumentType = 'stock' | 'etf' | 'fibra' | 'reit' | 'adr' | 'fund' | 'other';

type CatalogDbRow = {
  id: string;
  name?: string | null;
  description?: string | null;
  is_active: boolean;
  is_closed?: boolean | null;
  notes?: string | null;
  instrument_type?: PaymentInstrumentType | SecurityInstrumentType | null;
  ticker?: string | null;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  exchange_code?: string | null;
  country_code?: string | null;
  currency_code?: 'MXN' | 'USD' | null;
  website_url?: string | null;
  default_fee_factor?: number | null;
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
  isClosed: string;
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  exchangeCode: string;
  countryCode: string;
  currencyCode: string;
  websiteUrl: string;
  defaultFeeFactor: string;
  notes: string;
};

const paymentInstrumentTypeOptions: readonly SelectOption[] = [
  { value: 'cash', label: 'cash' },
  { value: 'debit_card', label: 'debit_card' },
  { value: 'credit_card', label: 'credit_card' },
];

const securityInstrumentTypeOptions: readonly SelectOption[] = [
  { value: 'stock', label: 'stock' },
  { value: 'etf', label: 'etf' },
  { value: 'fibra', label: 'fibra' },
  { value: 'reit', label: 'reit' },
  { value: 'adr', label: 'adr' },
  { value: 'fund', label: 'fund' },
  { value: 'other', label: 'other' },
];

const currencyOptions: readonly SelectOption[] = [
  { value: 'MXN', label: 'MXN' },
  { value: 'USD', label: 'USD' },
];

const activeOptions: readonly SelectOption[] = [
  { value: 'true', label: 'Sí' },
  { value: 'false', label: 'No' },
];

const DEFAULT_COLUMN_WIDTH = 108;
const LONG_DESCRIPTION_COLUMN_WIDTH = 220;
const GRID_ROW_HEIGHT = 32;

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCatalogGridRow(row: CatalogGridRow, kind: CatalogKind): CatalogGridRow {
  if (kind !== 'securities') {
    return row;
  }

  return {
    ...row,
    ticker: row.ticker.trim().toUpperCase(),
    exchangeCode: row.exchangeCode.trim().toUpperCase(),
    countryCode: row.countryCode.trim().toUpperCase(),
  };
}

function createDraftCatalogRow(config: CatalogConfig): CatalogGridRow {
  return {
    id: createLocalId('catalog-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    name: '',
    description: '',
    instrumentType: config.kind === 'payment_instruments' ? 'cash' : config.kind === 'securities' ? 'stock' : '',
    isActive: 'true',
    isClosed: 'false',
    ticker: '',
    companyName: '',
    sector: '',
    industry: '',
    exchangeCode: '',
    countryCode: '',
    currencyCode: config.kind === 'securities' ? 'USD' : '',
    websiteUrl: '',
    defaultFeeFactor: config.kind === 'brokers' ? '0' : '',
    notes: '',
  };
}

function toCatalogGridRow(row: CatalogDbRow, config: CatalogConfig): CatalogGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    name: row.name ?? '',
    description: row.description ?? '',
    instrumentType: row.instrument_type ?? (config.kind === 'payment_instruments' ? 'cash' : config.kind === 'securities' ? 'stock' : ''),
    isActive: row.is_active ? 'true' : 'false',
    isClosed: row.is_closed ? 'true' : 'false',
    ticker: row.ticker ?? '',
    companyName: row.company_name ?? '',
    sector: row.sector ?? '',
    industry: row.industry ?? '',
    exchangeCode: row.exchange_code ?? '',
    countryCode: row.country_code ?? '',
    currencyCode: row.currency_code ?? (config.kind === 'securities' ? 'USD' : ''),
    websiteUrl: row.website_url ?? '',
    defaultFeeFactor: row.default_fee_factor == null ? (config.kind === 'brokers' ? '0' : '') : String(Number(row.default_fee_factor)),
    notes: row.notes ?? '',
  };
}

function canSaveDraftCatalogRow(row: CatalogGridRow, config: CatalogConfig) {
  if (config.kind === 'securities') {
    return Boolean(row.ticker.trim() && row.companyName.trim() && row.instrumentType && row.currencyCode);
  }

  if (config.kind === 'payment_instruments') {
    return Boolean(row.name.trim() && row.instrumentType);
  }

  return Boolean(row.name.trim());
}

function validateCatalogRow(row: CatalogGridRow, config: CatalogConfig) {
  if (config.kind === 'securities') {
    if (!row.ticker.trim()) {
      return 'El ticker es obligatorio.';
    }

    if (!row.companyName.trim()) {
      return 'El nombre de la empresa es obligatorio.';
    }

    if (!row.instrumentType) {
      return 'Selecciona el tipo de instrumento.';
    }

    if (row.currencyCode !== 'MXN' && row.currencyCode !== 'USD') {
      return 'Selecciona una moneda válida.';
    }

    if (row.websiteUrl.trim()) {
      try {
        const parsed = new URL(row.websiteUrl.trim());

        if (!/^https?:$/i.test(parsed.protocol)) {
          return 'La URL debe iniciar con http:// o https://.';
        }
      } catch {
        return 'La URL del sitio no es válida.';
      }
    }
  } else {
    if (!row.name.trim()) {
      return 'El nombre es obligatorio.';
    }

    if (config.kind === 'payment_instruments' && !row.instrumentType) {
      return 'Selecciona el tipo de instrumento.';
    }

    if (config.kind === 'brokers') {
      const defaultFeeFactor = Number(row.defaultFeeFactor || '0');
      if (!Number.isFinite(defaultFeeFactor) || defaultFeeFactor < 0) {
        return 'El factor de comisión debe ser un número mayor o igual a cero.';
      }
    }
  }

  if (row.isActive !== 'true' && row.isActive !== 'false') {
    return 'El estado activo no es válido.';
  }

  if (config.key === 'investment_entities' && row.isClosed !== 'true' && row.isClosed !== 'false') {
    return 'El estado de cierre no es válido.';
  }

  return null;
}

function formatCatalogIssuesMessage(row: CatalogGridRow, config: CatalogConfig) {
  const issues: string[] = [];

  if (config.kind === 'securities') {
    if (!row.ticker.trim()) issues.push('captura el ticker');
    if (!row.companyName.trim()) issues.push('captura la empresa');
    if (!row.instrumentType) issues.push('selecciona el tipo');
    if (!row.currencyCode) issues.push('selecciona la moneda');
  } else {
    if (!row.name.trim()) issues.push('captura el nombre');
    if (config.kind === 'payment_instruments' && !row.instrumentType) issues.push('selecciona el tipo de instrumento');
  }

  if (issues.length === 0) {
    return 'Revisa los valores de la fila antes de guardar.';
  }

  return `No se puede guardar el registro: ${issues.join(', ')}.`;
}

export function CatalogsPage() {
  const navigate = useNavigate();
  const { catalogKey } = useParams<{ catalogKey?: string }>();
  const [rows, setRows] = useState<CatalogGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rowsRef = useRef<CatalogGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, CatalogGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);

  const selectedCatalog = useMemo(() => getCatalogConfig(catalogKey) ?? defaultCatalog, [catalogKey]);

  useEffect(() => {
    if (catalogKey && !getCatalogConfig(catalogKey)) {
      navigate('/catalogs', { replace: true });
    }
  }, [catalogKey, navigate]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const handleSelectCatalog = useCallback(
    (nextCatalogKey: string) => {
      void navigate(getCatalogPath(nextCatalogKey));
    },
    [navigate],
  );

  const loadRows = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setRows([]);
      persistedRowsRef.current = new Map();
      setErrorMessage('Supabase no está configurado en este entorno.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const orderColumn = selectedCatalog.kind === 'securities' ? 'ticker' : 'name';
    const { data, error } = await supabase.from(selectedCatalog.key).select('*').order(orderColumn, { ascending: true });

    if (error) {
      setRows([]);
      persistedRowsRef.current = new Map();
      setErrorMessage(`No fue posible cargar ${selectedCatalog.label.toLowerCase()}: ${error.message}`);
      setIsLoading(false);
      return;
    }

    const nextRows = ((data as CatalogDbRow[]) ?? []).map((row) => toCatalogGridRow(row, selectedCatalog));
    const loadedRows = [createDraftCatalogRow(selectedCatalog), ...nextRows];

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
        setErrorMessage('Supabase no está disponible para guardar datos.');
        return;
      }

      const row = rowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        setErrorMessage('No se encontró la fila que intentas guardar. Intenta de nuevo.');
        return;
      }

      if (row.isDraft && !canSaveDraftCatalogRow(row, selectedCatalog)) {
        const draftErrorMessage = formatCatalogIssuesMessage(row, selectedCatalog);

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

      const validationMessage = validateCatalogRow(row, selectedCatalog);

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

      const normalizedRow = normalizeCatalogGridRow(row, selectedCatalog.kind);
      let payload: Record<string, string | boolean | number | null>;

      if (selectedCatalog.kind === 'securities') {
        payload = {
          ticker: normalizedRow.ticker,
          company_name: normalizedRow.companyName.trim(),
          sector: normalizedRow.sector.trim() || null,
          industry: normalizedRow.industry.trim() || null,
          exchange_code: normalizedRow.exchangeCode || null,
          instrument_type: normalizedRow.instrumentType,
          country_code: normalizedRow.countryCode || null,
          currency_code: normalizedRow.currencyCode,
          website_url: normalizedRow.websiteUrl.trim() || null,
          is_active: normalizedRow.isActive === 'true',
          notes: normalizedRow.notes.trim() || null,
        };
      } else {
        payload = {
          name: normalizedRow.name.trim(),
          description: normalizedRow.description.trim() || null,
          is_active: normalizedRow.isActive === 'true',
          notes: normalizedRow.notes.trim() || null,
        };

        if (selectedCatalog.key === 'investment_entities') {
          payload.is_closed = normalizedRow.isClosed === 'true';
        }

        if (selectedCatalog.kind === 'payment_instruments') {
          payload.instrument_type = normalizedRow.instrumentType as PaymentInstrumentType;
        }

        if (selectedCatalog.kind === 'brokers') {
          payload.default_fee_factor = Number((Number(normalizedRow.defaultFeeFactor || '0')).toFixed(6));
        }
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
        const nextRows = [createDraftCatalogRow(selectedCatalog), ...rowsRef.current.filter((candidate) => !candidate.isDraft)];
        rowsRef.current = nextRows;
        setRows(nextRows);
        setErrorMessage(null);
        return;
      }

      if (!supabase) {
        setErrorMessage('Supabase no está disponible para eliminar datos.');
        return;
      }

      if (!window.confirm('¿Eliminar este registro?')) {
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
        const nextRows = [createDraftCatalogRow(selectedCatalog), ...rowsRef.current.filter((candidate) => !candidate.isDraft)];
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

    const editedRow = normalizeCatalogGridRow(nextRows[rowIndex], selectedCatalog.kind);
    const validationMessage = editedRow.isDraft ? null : validateCatalogRow(editedRow, selectedCatalog);
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
    const actionColumn: Column<CatalogGridRow> = {
      key: 'actions',
      name: '',
      width: 78,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
        const showPrimaryActions = row.isDraft || row.status === 'dirty' || row.status === 'error';
        const actionCount = showPrimaryActions ? 2 : 1;

        return (
          <div className={`grid-actions grid-actions--${actionCount}`}>
            {showPrimaryActions ? (
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
                <button
                  type="button"
                  className={`grid-action ${row.isDraft ? 'grid-action--clear' : 'grid-action--revert'}`}
                  title={row.isDraft ? 'Limpiar' : 'Deshacer'}
                  aria-label={row.isDraft ? 'Limpiar' : 'Deshacer'}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRevertRow(row);
                  }}
                >
                  <FontAwesomeIcon icon={row.isDraft ? faEraser : faRotateLeft} />
                </button>
              </>
            ) : null}
            {!showPrimaryActions ? (
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
            ) : null}
          </div>
        );
      },
    };

    if (selectedCatalog.kind === 'securities') {
      return [
        actionColumn,
        {
          key: 'ticker',
          name: 'Ticker',
          width: 96,
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="AAPL" />,
        },
        {
          key: 'companyName',
          name: 'Empresa',
          width: 180,
          renderCell: ({ row }) => row.companyName || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Apple Inc." />,
        },
        {
          key: 'instrumentType',
          name: 'Tipo',
          width: 96,
          renderCell: ({ row }) => row.instrumentType || '-',
          renderEditCell: (props) => <SelectCellEditor {...props} options={securityInstrumentTypeOptions} />,
        },
        {
          key: 'sector',
          name: 'Sector',
          width: 124,
          renderCell: ({ row }) => row.sector || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Tecnología" />,
        },
        {
          key: 'industry',
          name: 'Industria',
          width: 148,
          renderCell: ({ row }) => row.industry || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Software" />,
        },
        {
          key: 'exchangeCode',
          name: 'Bolsa',
          width: 92,
          renderCell: ({ row }) => row.exchangeCode || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="NASDAQ" />,
        },
        {
          key: 'countryCode',
          name: 'País',
          width: 82,
          renderCell: ({ row }) => row.countryCode || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="US" />,
        },
        {
          key: 'currencyCode',
          name: 'Moneda',
          width: 88,
          renderCell: ({ row }) => row.currencyCode || '-',
          renderEditCell: (props) => <SelectCellEditor {...props} options={currencyOptions} />,
        },
        {
          key: 'websiteUrl',
          name: 'Sitio',
          width: 180,
          renderCell: ({ row }) => row.websiteUrl || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="https://..." />,
        },
        {
          key: 'notes',
          name: 'Notas',
          width: 160,
          renderCell: ({ row }) => row.notes || '-',
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
        },
        {
          key: 'isActive',
          name: 'Act.',
          width: 76,
          renderCell: ({ row }) => (row.isActive === 'true' ? 'Sí' : 'No'),
          renderEditCell: (props) => <SelectCellEditor {...props} options={activeOptions} />,
        },
      ];
    }

    const baseColumns: Column<CatalogGridRow>[] = [
      actionColumn,
      {
        key: 'name',
        name: 'Nombre',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Nuevo registro" />,
      },
      {
        key: 'description',
        name: 'Descripción',
        width: selectedCatalog.key === 'expense_categories' ? LONG_DESCRIPTION_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH,
        renderCell: ({ row }) => row.description || '-',
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Contexto opcional" />,
      },
    ];

    if (selectedCatalog.kind === 'payment_instruments') {
      baseColumns.push({
        key: 'instrumentType',
        name: 'Tipo',
        width: DEFAULT_COLUMN_WIDTH,
        renderCell: ({ row }) => row.instrumentType || '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={paymentInstrumentTypeOptions} />,
      });
    }

    if (selectedCatalog.kind === 'brokers') {
      baseColumns.push({
        key: 'defaultFeeFactor',
        name: 'Factor comisión',
        width: 128,
        renderCell: ({ row }) => row.defaultFeeFactor || '0',
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0.0029" />,
      });
    }

    baseColumns.push({
      key: 'isActive',
      name: 'Act.',
      width: 76,
      renderCell: ({ row }) => (row.isActive === 'true' ? 'Sí' : 'No'),
      renderEditCell: (props) => <SelectCellEditor {...props} options={activeOptions} />,
    });

    if (selectedCatalog.key === 'investment_entities') {
      baseColumns.push({
        key: 'isClosed',
        name: 'Cer.',
        width: 76,
        renderCell: ({ row }) => (row.isClosed === 'true' ? 'Sí' : 'No'),
        renderEditCell: (props) => <SelectCellEditor {...props} options={activeOptions} />,
      });
    }

    return baseColumns;
  }, [handleDeleteRow, handleRevertRow, persistCatalogRow, selectedCatalog]);

  const currentRowError = rows.find((row) => row.status === 'error')?.errorMessage;
  const visibleErrorMessage = currentRowError ?? errorMessage;

  const handleNavigateToNextCell = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef,
        columns,
        rows,
        rowIdx,
        columnIdx,
      });
    },
    [columns, rows],
  );

  return (
    <div className="page">
      <section
        className="card catalog-layout"
        data-tour="catalogs-page"
        data-tour-catalog-key={selectedCatalog.key}
        data-tour-catalog-label={selectedCatalog.label}
        data-tour-catalog-description={selectedCatalog.description}
      >
        <section className="catalog-panel">
          <div className="catalog-panel__header catalog-panel__header--compact">
            <div className="catalog-selector" data-tour="catalogs-selector">
              <div className="catalog-tabs" role="tablist" aria-label="Catálogos">
                {catalogConfigs.map((catalog) => {
                  const isActive = catalog.key === selectedCatalog.key;

                  return (
                    <button
                      key={catalog.key}
                      type="button"
                      role="tab"
                      className={`catalog-tab${isActive ? ' catalog-tab--active' : ''}`}
                      data-tour={`catalog-tab-${catalog.key}`}
                      aria-selected={isActive}
                      aria-controls="catalogs-grid-panel"
                      aria-label={catalog.label}
                      title={catalog.label}
                      onClick={() => handleSelectCatalog(catalog.key)}
                    >
                      <FontAwesomeIcon icon={catalog.icon} />
                      {isActive ? <span className="catalog-tab__label">{catalog.label}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="catalog-panel__meta">
              <span className={`status-pill status-pill--${isLoading ? 'checking' : 'ok'}`} data-tour="catalogs-status">
                {isLoading ? 'Cargando' : `${rows.filter((row) => !row.isDraft).length} registros`}
              </span>
            </div>
          </div>

          {visibleErrorMessage ? <div className="feedback-banner feedback-banner--error">{visibleErrorMessage}</div> : null}

          <div id="catalogs-grid-panel" className="grid-wrapper grid-wrapper--tall" data-tour="catalogs-grid">
            <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateToNextCell}>
              <DataGrid
                ref={gridRef}
                columns={columns}
                rows={rows}
                rowHeight={GRID_ROW_HEIGHT}
                headerRowHeight={GRID_ROW_HEIGHT}
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
            </GridEditorNavigationProvider>
          </div>
        </section>
      </section>
    </div>
  );
}
