import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type Column, type RenderHeaderCellProps } from 'react-data-grid';
import { useMediaQuery } from '../shared/useMediaQuery';
import { AppSelect, SelectCellEditor, type SelectOption } from '../shared/gridEditors';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import {
  canSelectDividendImportRow,
  getDividendImportStatusLabel,
  markDividendImportDuplicates,
  normalizeDividendImportPreviewRow,
  parseDividendImportFile,
  type DividendImportCurrencyCode,
  type DividendImportPreviewIssue,
  type DividendImportPreviewRow,
} from './dividendImport';
import {
  formatSecurityLabel,
  formatSecurityOptionLabel,
  investmentCurrencyOptions,
  isErrorFeedback,
  type Broker,
  type Security,
} from './shared';

type DividendImportPanelProps = {
  brokers: Broker[];
  securities: Security[];
  onImported: () => Promise<void> | void;
};

type DuplicateDividendSourceRow = {
  source_dividend_transaction_id: string | null;
};

type DuplicateTaxSourceRow = {
  source_tax_transaction_id: string | null;
};

const PREVIEW_ROW_HEIGHT = 30;
const PREVIEW_DATE_COLUMN_WIDTH = 96;
const PREVIEW_TICKER_COLUMN_WIDTH = 96;
const PREVIEW_BROKER_COLUMN_WIDTH = 76;
const PREVIEW_FX_COLUMN_WIDTH = 72;

function getImportStatusTone(status: DividendImportPreviewRow['status']) {
  if (status === 'ready' || status === 'saved') return 'ok';
  if (status === 'saving') return 'checking';
  if (status === 'duplicate') return 'idle';
  return 'error';
}

function formatIssuesLabel(issues: DividendImportPreviewIssue[]) {
  if (issues.length === 0) {
    return 'Sin incidencias.';
  }

  return issues.map((issue) => issue.message).join(' ');
}

function buildImportSummary(rows: DividendImportPreviewRow[], ignoredCount: number) {
  const validCount = rows.filter((row) => canSelectDividendImportRow(row)).length;
  const duplicateCount = rows.filter((row) => row.status === 'duplicate').length;
  const blockedCount = rows.filter((row) => ['ticker-unresolved', 'ambiguous-group', 'invalid'].includes(row.status)).length;

  return `Preview generada: ${validCount} válidos, ${duplicateCount} duplicados, ${blockedCount} bloqueados, ${ignoredCount} ignorados.`;
}

export function DividendImportPanel({ brokers, securities, onImported }: DividendImportPanelProps) {
  const isNarrowViewport = useMediaQuery('(max-width: 720px)');
  const [brokerId, setBrokerId] = useState('');
  const [currencyCode, setCurrencyCode] = useState<DividendImportCurrencyCode>('MXN');
  const [fxRateToMxn, setFxRateToMxn] = useState('1');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<DividendImportPreviewRow[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mobilePrimaryPanel, setMobilePrimaryPanel] = useState<'capture' | 'preview'>('capture');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRowsRef = useRef<DividendImportPreviewRow[]>([]);

  useEffect(() => {
    previewRowsRef.current = previewRows;
  }, [previewRows]);

  useEffect(() => {
    if (!brokerId && brokers.length === 1) {
      setBrokerId(brokers[0].id);
    }
  }, [brokerId, brokers]);

  useEffect(() => {
    if (!isNarrowViewport) {
      setMobilePrimaryPanel('capture');
    }
  }, [isNarrowViewport]);

  const brokerOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Broker' }, ...brokers.map((broker) => ({ value: broker.id, label: broker.name }))],
    [brokers],
  );
  const brokerLabelById = useMemo(() => new Map(brokers.map((broker) => [broker.id, broker.name])), [brokers]);
  const securityOptions = useMemo<readonly SelectOption[]>(
    () => [
      { value: '', label: 'Ticker' },
      ...securities.map((security) => ({
        value: security.id,
        label: security.is_active ? formatSecurityOptionLabel(security) : `${formatSecurityOptionLabel(security)} [inactivo]`,
      })),
    ],
    [securities],
  );
  const securityLabelById = useMemo(
    () => new Map(securities.map((security) => [security.id, formatSecurityLabel(security)])),
    [securities],
  );

  const selectablePreviewRows = useMemo(
    () => previewRows.filter((row) => canSelectDividendImportRow(row)),
    [previewRows],
  );
  const selectedPreviewCount = useMemo(
    () => selectablePreviewRows.filter((row) => row.selected).length,
    [selectablePreviewRows],
  );
  const previewSummary = useMemo(
    () => ({
      validCount: selectablePreviewRows.length,
      duplicateCount: previewRows.filter((row) => row.status === 'duplicate').length,
      blockedCount: previewRows.filter((row) => ['ticker-unresolved', 'ambiguous-group', 'invalid'].includes(row.status)).length,
      savedCount: previewRows.filter((row) => row.status === 'saved').length,
      selectedCount: selectedPreviewCount,
    }),
    [previewRows, selectablePreviewRows.length, selectedPreviewCount],
  );
  const areAllSelectableRowsSelected = selectablePreviewRows.length > 0 && selectablePreviewRows.every((row) => row.selected);

  const applyPreviewRows = useCallback((nextRows: DividendImportPreviewRow[]) => {
    previewRowsRef.current = nextRows;
    setPreviewRows(nextRows);
  }, []);

  const updatePreviewRow = useCallback(
    (rowId: string, updater: (row: DividendImportPreviewRow) => DividendImportPreviewRow) => {
      const nextRows = previewRowsRef.current.map((row) => (row.id === rowId ? updater(row) : row));
      applyPreviewRows(nextRows);
    },
    [applyPreviewRows],
  );

  const clearPreview = useCallback(
    (clearFile = true) => {
      applyPreviewRows([]);
      setIgnoredCount(0);
      setFeedback(null);

      if (clearFile) {
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [applyPreviewRows],
  );

  const clearPreviewForReprocess = useCallback(() => {
    if (previewRowsRef.current.length === 0) {
      return;
    }

    applyPreviewRows([]);
    setIgnoredCount(0);
    setFeedback('La previsualización se limpió. Vuelve a procesar el archivo para aplicar los nuevos valores comunes.');
  }, [applyPreviewRows]);

  const loadDuplicateStatus = useCallback(async (rows: DividendImportPreviewRow[]) => {
    if (!supabase || !isSupabaseConfigured()) {
      throw new Error('Supabase no está disponible para validar duplicados de dividendos.');
    }

    const sourceDividendIds = [...new Set(rows.map((row) => row.sourceDividendTransactionId).filter(Boolean))];
    const sourceTaxIds = [...new Set(rows.map((row) => row.sourceTaxTransactionId).filter(Boolean))];

    const [dividendQueryResult, taxQueryResult] = await Promise.all([
      sourceDividendIds.length > 0
        ? supabase.from('dividend_entries').select('source_dividend_transaction_id').in('source_dividend_transaction_id', sourceDividendIds)
        : Promise.resolve({ data: [] as DuplicateDividendSourceRow[], error: null }),
      sourceTaxIds.length > 0
        ? supabase.from('dividend_entries').select('source_tax_transaction_id').in('source_tax_transaction_id', sourceTaxIds)
        : Promise.resolve({ data: [] as DuplicateTaxSourceRow[], error: null }),
    ]);

    if (dividendQueryResult.error) {
      throw new Error(`No fue posible validar IDs de dividendos importados: ${dividendQueryResult.error.message}`);
    }

    if (taxQueryResult.error) {
      throw new Error(`No fue posible validar IDs de retenciones importadas: ${taxQueryResult.error.message}`);
    }

    return markDividendImportDuplicates(
      rows,
      new Set((dividendQueryResult.data ?? []).map((row) => row.source_dividend_transaction_id).filter(Boolean) as string[]),
      new Set((taxQueryResult.data ?? []).map((row) => row.source_tax_transaction_id).filter(Boolean) as string[]),
    );
  }, []);

  const handleProcessFile = useCallback(async () => {
    if (!selectedFile) {
      setFeedback('Selecciona un archivo JSON para procesar.');
      return;
    }

    if (!brokerId) {
      setFeedback('Selecciona el broker común antes de procesar el archivo.');
      return;
    }

    if (currencyCode !== 'MXN' && (!fxRateToMxn.trim() || !Number.isFinite(Number(fxRateToMxn)) || Number(fxRateToMxn) <= 0)) {
      setFeedback('Captura un tipo de cambio mayor a cero para la importación.');
      return;
    }

    setIsProcessing(true);

    try {
      const fileText = await selectedFile.text();
      const parsedImport = parseDividendImportFile(fileText, {
        brokerId,
        currencyCode,
        fxRateToMxn,
        securities,
      });
      const rowsWithDuplicateStatus = await loadDuplicateStatus(parsedImport.previewRows);

      applyPreviewRows(rowsWithDuplicateStatus);
      setIgnoredCount(parsedImport.ignoredCount);
      if (isNarrowViewport && rowsWithDuplicateStatus.length > 0) {
        setMobilePrimaryPanel('preview');
      }
      setFeedback(
        rowsWithDuplicateStatus.length === 0
          ? `No se encontraron movimientos importables. ${parsedImport.ignoredCount} renglones fueron ignorados.`
          : buildImportSummary(rowsWithDuplicateStatus, parsedImport.ignoredCount),
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No fue posible procesar el archivo de dividendos.');
    } finally {
      setIsProcessing(false);
    }
  }, [applyPreviewRows, brokerId, currencyCode, fxRateToMxn, loadDuplicateStatus, securities, selectedFile]);

  const handleTogglePreviewRowSelection = useCallback(
    (rowId: string, nextSelected: boolean) => {
      updatePreviewRow(rowId, (row) => {
        if (!canSelectDividendImportRow(row) || row.status === 'saving') {
          return row;
        }

        return {
          ...row,
          selected: nextSelected,
        };
      });
    },
    [updatePreviewRow],
  );

  const handleToggleAllSelectableRows = useCallback(
    (nextSelected: boolean) => {
      applyPreviewRows(
        previewRowsRef.current.map((row) => {
          if (!canSelectDividendImportRow(row) || row.status === 'saving') {
            return row;
          }

          return {
            ...row,
            selected: nextSelected,
          };
        }),
      );
    },
    [applyPreviewRows],
  );

  const handlePreviewRowsChange = useCallback(
    (nextRows: DividendImportPreviewRow[], data: { indexes: number[] }) => {
      const rowIndex = data.indexes[0] ?? null;

      if (rowIndex == null) {
        applyPreviewRows(nextRows);
        return;
      }

      const normalizedRow = normalizeDividendImportPreviewRow(nextRows[rowIndex]);
      const updatedRows = nextRows.map((row, index) => (index === rowIndex ? normalizedRow : row));
      applyPreviewRows(updatedRows);
    },
    [applyPreviewRows],
  );

  const handleSaveSelectedRows = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no está disponible para guardar dividendos importados.');
      return;
    }

    if (previewRowsRef.current.length === 0) {
      setFeedback('Primero procesa un archivo para generar la previsualización.');
      return;
    }

    setIsSaving(true);

    try {
      const rowsWithDuplicateStatus = await loadDuplicateStatus(previewRowsRef.current);
      applyPreviewRows(rowsWithDuplicateStatus);

      const selectedRows = rowsWithDuplicateStatus.filter((row) => canSelectDividendImportRow(row) && row.selected);
      const omittedByUserCount = rowsWithDuplicateStatus.filter((row) => canSelectDividendImportRow(row) && !row.selected).length;

      if (selectedRows.length === 0) {
        setFeedback('Selecciona al menos una fila válida para guardar.');
        setIsSaving(false);
        return;
      }

      let savedCount = 0;
      let errorCount = 0;

      for (const row of selectedRows) {
        updatePreviewRow(row.id, (currentRow) => ({
          ...currentRow,
          status: 'saving',
          issues: currentRow.issues.filter((issue) => issue.code !== 'save-error'),
        }));

        const grossAmountOriginal = Number(row.grossAmountOriginal);
        const taxWithheldOriginal = Number(row.taxWithheldOriginal || '0');
        const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
        const netAmountMxn = Number(row.netAmountMxn);
        const payload = {
          entry_date: row.entryDate,
          broker_id: row.brokerId,
          security_id: row.matchedSecurityId,
          currency_code: row.currencyCode,
          gross_amount_original: Number(grossAmountOriginal.toFixed(6)),
          tax_withheld_original: Number(taxWithheldOriginal.toFixed(6)),
          fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : Number(fxRate.toFixed(6)),
          net_amount_mxn: Number(netAmountMxn.toFixed(6)),
          source_dividend_transaction_id: row.sourceDividendTransactionId || null,
          source_tax_transaction_id: row.sourceTaxTransactionId || null,
        };
        const result = await supabase.from('dividend_entries').insert(payload).select('id').single();

        if (result.error) {
          const errorCode = (result.error as { code?: string }).code ?? '';

          if (errorCode === '23505') {
            updatePreviewRow(row.id, (currentRow) => ({
              ...currentRow,
              selected: false,
              status: 'duplicate',
              issues: [
                ...currentRow.issues.filter((issue) => issue.code !== 'save-error' && issue.code !== 'duplicate-source-id'),
                { code: 'duplicate-source-id', message: 'El movimiento origen ya fue importado.' },
              ],
            }));
            continue;
          }

          errorCount += 1;
          updatePreviewRow(row.id, (currentRow) => ({
            ...currentRow,
            status: 'save-error',
            issues: [
              ...currentRow.issues.filter((issue) => issue.code !== 'save-error'),
              { code: 'save-error', message: result.error.message },
            ],
          }));
          continue;
        }

        savedCount += 1;
        updatePreviewRow(row.id, (currentRow) => ({
          ...currentRow,
          selected: false,
          status: 'saved',
          issues: currentRow.issues.filter((issue) => issue.code !== 'save-error'),
        }));
      }

      await Promise.resolve(onImported());
      const duplicateCount = previewRowsRef.current.filter((row) => row.status === 'duplicate').length;

      setFeedback(
        `Importación completada: ${savedCount} guardados, ${duplicateCount} duplicados, ${omittedByUserCount} omitidos por usuario${errorCount > 0 ? `, ${errorCount} con error` : ''}.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No fue posible guardar la importación de dividendos.');
    } finally {
      setIsSaving(false);
    }
  }, [applyPreviewRows, loadDuplicateStatus, onImported, updatePreviewRow]);

  function renderSelectHeaderCell(_props: RenderHeaderCellProps<DividendImportPreviewRow>) {
    return (
      <div className="dividend-import-checkbox">
        <input
          type="checkbox"
          aria-label="Seleccionar todas las filas válidas"
          checked={areAllSelectableRowsSelected}
          disabled={selectablePreviewRows.length === 0 || isSaving}
          onChange={(event) => {
            handleToggleAllSelectableRows(event.target.checked);
          }}
        />
      </div>
    );
  }

  const previewColumns = useMemo<readonly Column<DividendImportPreviewRow>[]>(
    () => [
      {
        key: 'selected',
        name: '',
        width: 44,
        frozen: true,
        editable: false,
        renderHeaderCell: renderSelectHeaderCell,
        renderCell: ({ row }) => (
          <div className="dividend-import-checkbox">
            <input
              type="checkbox"
              checked={row.selected}
              disabled={!canSelectDividendImportRow(row) || isSaving || row.status === 'saving'}
              aria-label={`Seleccionar fila ${row.normalizedTicker} ${row.entryDate}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                handleTogglePreviewRowSelection(row.id, event.target.checked);
              }}
            />
          </div>
        ),
      },
      {
        key: 'status',
        name: 'Estado',
        width: 108,
        renderCell: ({ row }) => {
          const issuesLabel = formatIssuesLabel(row.issues);
          const tone = getImportStatusTone(row.status);

          return (
            <span className={`status-pill status-pill--${tone}`} title={issuesLabel}>
              {getDividendImportStatusLabel(row.status)}
            </span>
          );
        },
      },
      {
        key: 'entryDate',
        name: 'Fecha',
        width: PREVIEW_DATE_COLUMN_WIDTH,
      },
      {
        key: 'rawTicker',
        name: 'Ticker origen',
        width: PREVIEW_TICKER_COLUMN_WIDTH,
      },
      {
        key: 'matchedSecurityId',
        name: 'Ticker resuelto',
        width: 188,
        renderCell: ({ row }) => securityLabelById.get(row.matchedSecurityId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={securityOptions} />,
      },
      {
        key: 'brokerId',
        name: 'Broker',
        width: PREVIEW_BROKER_COLUMN_WIDTH,
        renderCell: ({ row }) => brokerLabelById.get(row.brokerId) ?? '-',
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: 84,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX',
        width: PREVIEW_FX_COLUMN_WIDTH,
      },
      {
        key: 'grossAmountOriginal',
        name: 'Bruto',
        width: 96,
      },
      {
        key: 'taxWithheldOriginal',
        name: 'Ret.',
        width: 96,
      },
      {
        key: 'netAmountOriginal',
        name: 'Neto',
        width: 96,
      },
      {
        key: 'netAmountMxn',
        name: 'MXN neto',
        width: 108,
      },
      {
        key: 'sourceDividendTransactionId',
        name: 'Id dividendo',
        width: 116,
      },
      {
        key: 'sourceTaxTransactionId',
        name: 'Id ISR',
        width: 116,
        renderCell: ({ row }) => row.sourceTaxTransactionId || '-',
      },
      {
        key: 'dividendDescription',
        name: 'Descripcion abono',
        width: 280,
        renderCell: ({ row }) => row.dividendDescription || '-',
      },
      {
        key: 'issues',
        name: 'Observaciones',
        width: 280,
        renderCell: ({ row }) => formatIssuesLabel(row.issues),
      },
    ],
    [areAllSelectableRowsSelected, brokerLabelById, handleToggleAllSelectableRows, handleTogglePreviewRowSelection, isSaving, selectablePreviewRows.length, securityLabelById, securityOptions],
  );

  const showCapturePanel = !isNarrowViewport || mobilePrimaryPanel === 'capture';
  const showPreviewPanel = !isNarrowViewport || mobilePrimaryPanel === 'preview';

  return (
    <section className="card finance-panel dividend-import-panel">
      <div className="dividend-import-editor__header">
        <div className="dividend-import-editor__title">
          <strong>Importar pagos de dividendos</strong>
        </div>

        <div className="badge-row" aria-label="Resumen de la previsualización de importación">
          <span className="badge">{previewSummary.validCount} válidos</span>
          <span className="badge">{previewSummary.selectedCount} seleccionados</span>
          <span className="badge">{previewSummary.duplicateCount} duplicados</span>
          <span className="badge">{previewSummary.blockedCount} bloqueados</span>
          <span className="badge">{previewSummary.savedCount} guardados</span>
        </div>
      </div>

      {isNarrowViewport ? (
        <div className="expense-workspace-toggle" role="tablist" aria-label="Cambiar vista de importación de dividendos">
          <button
            type="button"
            role="tab"
            aria-selected={mobilePrimaryPanel === 'capture'}
            className={`expense-workspace-toggle__button${mobilePrimaryPanel === 'capture' ? ' expense-workspace-toggle__button--active' : ''}`}
            onClick={() => setMobilePrimaryPanel('capture')}
          >
            Captura
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePrimaryPanel === 'preview'}
            className={`expense-workspace-toggle__button${mobilePrimaryPanel === 'preview' ? ' expense-workspace-toggle__button--active' : ''}`}
            onClick={() => setMobilePrimaryPanel('preview')}
          >
            Preview
          </button>
        </div>
      ) : null}

      {showCapturePanel ? (
        <div className="dividend-import-editor" aria-label="Editor de importación de dividendos">
          <div className="finance-form dividend-import-editor__form">
            <label className="catalog-field dividend-import-editor__field dividend-import-editor__field--broker">
              <span>Broker</span>
              <AppSelect
                ariaLabel="Broker común para dividendos importados"
                options={brokerOptions}
                value={brokerId}
                onChange={(value) => {
                  setBrokerId(value);
                  clearPreviewForReprocess();
                }}
                placeholder="Broker"
                isDisabled={isProcessing || isSaving}
              />
            </label>

            <label className="catalog-field dividend-import-editor__field dividend-import-editor__field--currency">
              <span>Moneda</span>
              <AppSelect
                ariaLabel="Moneda común para dividendos importados"
                options={investmentCurrencyOptions}
                value={currencyCode}
                onChange={(value) => {
                  const nextCurrencyCode = value as DividendImportCurrencyCode;
                  setCurrencyCode(nextCurrencyCode);
                  if (nextCurrencyCode === 'MXN') {
                    setFxRateToMxn('1');
                  }
                  clearPreviewForReprocess();
                }}
                isDisabled={isProcessing || isSaving}
              />
            </label>

            <label className="catalog-field dividend-import-editor__field dividend-import-editor__field--fx">
              <span>FX a MXN</span>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={currencyCode === 'MXN' ? '1' : fxRateToMxn}
                disabled={currencyCode === 'MXN' || isProcessing || isSaving}
                onChange={(event) => {
                  setFxRateToMxn(event.target.value);
                  clearPreviewForReprocess();
                }}
              />
            </label>

            <label className="catalog-field dividend-import-editor__field dividend-import-editor__field--file">
              <span>Archivo JSON</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                disabled={isProcessing || isSaving}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setSelectedFile(nextFile);
                  applyPreviewRows([]);
                  setIgnoredCount(0);
                  setFeedback(null);
                }}
              />
            </label>

            <div className="dividend-import-editor__meta">
              {selectedFile ? <span className="badge" title={selectedFile.name}>{selectedFile.name}</span> : <span className="badge">Sin archivo</span>}
              <span className="badge">{ignoredCount} ignorados</span>
            </div>

            <div className="dividend-import-editor__footer">
              <div className="dividend-import-editor__actions">
                <button
                  type="button"
                  className="tickets-button tickets-button--primary"
                  onClick={() => void handleProcessFile()}
                  disabled={!selectedFile || isProcessing || isSaving}
                >
                  {isProcessing ? 'Procesando...' : 'Procesar'}
                </button>
                <button
                  type="button"
                  className="tickets-button"
                  onClick={() => clearPreview(true)}
                  disabled={isProcessing || isSaving || (!selectedFile && previewRows.length === 0)}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="tickets-button tickets-button--primary"
                  onClick={() => void handleSaveSelectedRows()}
                  disabled={isProcessing || isSaving || previewRows.length === 0 || selectedPreviewCount === 0}
                >
                  {isSaving ? 'Guardando...' : 'Guardar seleccionados'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}

      {showPreviewPanel && previewRows.length > 0 ? (
        <div className="grid-wrapper grid-wrapper--tall">
          <DataGrid
            columns={previewColumns}
            rows={previewRows}
            rowHeight={PREVIEW_ROW_HEIGHT}
            rowKeyGetter={(row) => row.id}
            onRowsChange={handlePreviewRowsChange}
            onCellClick={(args) => {
              if (args.column.renderEditCell && args.row.status !== 'saved' && args.row.status !== 'saving') {
                args.selectCell(true);
              }
            }}
            defaultColumnOptions={{ resizable: true }}
            rowClass={(row) => {
              if (row.status === 'saving') return 'row-saving';
              if (row.status === 'saved') return 'row-selected-soft';
              if (row.status === 'duplicate') return 'row-duplicate';
              if (['ticker-unresolved', 'ambiguous-group', 'invalid', 'save-error'].includes(row.status)) return 'row-error';
              if (row.selected) return 'row-selected-soft';
              return 'row-saved';
            }}
            style={{ blockSize: 380 }}
          />
        </div>
      ) : showPreviewPanel ? (
        <div className="dividend-import-panel__empty">Configura broker, moneda y archivo para generar la previsualización.</div>
      ) : null}
    </section>
  );
}
