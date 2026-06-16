import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCalendarDay,
  faChartLine,
  faCoins,
  faCreditCard,
  faEraser,
  faFloppyDisk,
  faRotateLeft,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type SortColumn } from 'react-data-grid';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { GridEditorNavigationProvider, moveToNextEditableGridCell } from '../features/shared/gridNavigation';
import { computeCreditCardPeriods, type CreditCardExpense, type CreditCardPayment, type CreditCardStatementReconciliation } from '../features/credit-cards/statementMath';
import { getTodayIsoDate, isIsoDateString } from '../features/shared/isoDate';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type PaymentInstrument = {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
};

type CreditCardDbRow = {
  id: string;
  payment_instrument_id: string;
  statement_day: number;
  grace_days: number;
  pre_cutoff_spend_target_mxn: number;
  is_active: boolean;
  notes: string | null;
};

type CreditCardPaymentDbRow = {
  id: string;
  payment_date: string;
  amount_mxn: number;
  bonus_statement_credit_mxn: number;
  bonus_reward_points: number;
  notes: string | null;
};

type CreditCardReconciliationDbRow = {
  id: string;
  statement_date: string;
  adjusted_closing_balance_mxn: number;
  adjustment_note: string | null;
};

type CreditCardConfigGridRow = {
  id: string;
  persistedId: string | null;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  paymentInstrumentId: string;
  instrumentName: string;
  statementDay: string;
  graceDays: string;
  spendTargetMxn: string;
  isActive: string;
  notes: string;
};

type CreditCardPaymentGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  paymentDate: string;
  amountMxn: string;
  bonusStatementCreditMxn: string;
  bonusRewardPoints: string;
  notes: string;
};

type CreditCardReconciliationGridRow = {
  id: string;
  persistedId: string | null;
  status: 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  statementDate: string;
  dueDate: string;
  calculatedClosingBalanceMxn: string;
  effectiveClosingBalanceMxn: string;
  adjustedClosingBalanceMxn: string;
  adjustmentNote: string;
};

const BOOLEAN_OPTIONS: readonly SelectOption[] = [
  { value: 'true', label: 'Sí' },
  { value: 'false', label: 'No' },
];

const CONFIG_ACTION_COLUMN_WIDTH = 78;
const PAYMENT_ACTION_COLUMN_WIDTH = 78;
const RECON_ACTION_COLUMN_WIDTH = 78;
const GRID_ROW_HEIGHT = 30;
const CONFIG_SORTABLE_COLUMN_KEYS = new Set<string>(['instrumentName', 'statementDay', 'spendTargetMxn']);

function compareNullableNumberString(left: string, right: string) {
  const leftValue = Number(left || '0');
  const rightValue = Number(right || '0');

  const normalizedLeftValue = Number.isFinite(leftValue) ? leftValue : 0;
  const normalizedRightValue = Number.isFinite(rightValue) ? rightValue : 0;

  return normalizedLeftValue - normalizedRightValue;
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatEditableNumber(value: number | null | undefined) {
  if (value == null) {
    return '';
  }

  return String(Number(value));
}

function formatCurrencyValue(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPointsValue(value: number) {
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 2,
  }).format(value);
}

function buildConfigRow(instrument: PaymentInstrument, creditCard?: CreditCardDbRow): CreditCardConfigGridRow {
  if (!creditCard) {
    return {
      id: instrument.id,
      persistedId: null,
      status: 'new',
      errorMessage: null,
      paymentInstrumentId: instrument.id,
      instrumentName: instrument.name,
      statementDay: '20',
      graceDays: '20',
      spendTargetMxn: '0',
      isActive: instrument.is_active ? 'true' : 'false',
      notes: '',
    };
  }

  return {
    id: instrument.id,
    persistedId: creditCard.id,
    status: 'saved',
    errorMessage: null,
    paymentInstrumentId: instrument.id,
    instrumentName: instrument.name,
    statementDay: String(creditCard.statement_day),
    graceDays: String(creditCard.grace_days),
    spendTargetMxn: formatEditableNumber(creditCard.pre_cutoff_spend_target_mxn),
    isActive: creditCard.is_active ? 'true' : 'false',
    notes: creditCard.notes ?? '',
  };
}

function normalizeConfigRow(row: CreditCardConfigGridRow): CreditCardConfigGridRow {
  return {
    ...row,
    statementDay: row.statementDay.trim(),
    graceDays: row.graceDays.trim(),
    spendTargetMxn: row.spendTargetMxn.trim(),
    notes: row.notes,
  };
}

function validateConfigRow(row: CreditCardConfigGridRow) {
  const statementDay = Number(row.statementDay);
  if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31) {
    return 'Usa un corte de 1 a 31.';
  }

  const graceDays = Number(row.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 60) {
    return 'Usa una gracia de 1 a 60.';
  }

  const spendTarget = Number(row.spendTargetMxn || '0');
  if (!Number.isFinite(spendTarget) || spendTarget < 0) {
    return 'La meta debe ser mayor o igual a cero.';
  }

  if (row.isActive !== 'true' && row.isActive !== 'false') {
    return 'El estado activo no es valido.';
  }

  return null;
}

function createDraftPaymentRow(): CreditCardPaymentGridRow {
  return {
    id: createLocalId('credit-payment-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    paymentDate: getTodayIsoDate(),
    amountMxn: '0',
    bonusStatementCreditMxn: '0',
    bonusRewardPoints: '0',
    notes: '',
  };
}

function withDraftPaymentRow(rows: CreditCardPaymentGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftPaymentRow();
  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function toPaymentGridRow(row: CreditCardPaymentDbRow): CreditCardPaymentGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    paymentDate: row.payment_date,
    amountMxn: formatEditableNumber(row.amount_mxn),
    bonusStatementCreditMxn: formatEditableNumber(row.bonus_statement_credit_mxn),
    bonusRewardPoints: formatEditableNumber(row.bonus_reward_points),
    notes: row.notes ?? '',
  };
}

function validatePaymentRow(row: CreditCardPaymentGridRow) {
  if (!isIsoDateString(row.paymentDate)) {
    return 'Usa fecha AAAA-MM-DD.';
  }

  const amountMxn = Number(row.amountMxn || '0');
  const bonusStatementCreditMxn = Number(row.bonusStatementCreditMxn || '0');
  const bonusRewardPoints = Number(row.bonusRewardPoints || '0');

  if (!Number.isFinite(amountMxn) || amountMxn < 0) {
    return 'El abono debe ser mayor o igual a cero.';
  }

  if (!Number.isFinite(bonusStatementCreditMxn) || bonusStatementCreditMxn < 0) {
    return 'La bonificación en saldo debe ser mayor o igual a cero.';
  }

  if (!Number.isFinite(bonusRewardPoints) || bonusRewardPoints < 0) {
    return 'Los puntos deben ser mayores o iguales a cero.';
  }

  if (amountMxn === 0 && bonusStatementCreditMxn === 0 && bonusRewardPoints === 0) {
    return 'Captura abono, bonificación o puntos.';
  }

  return null;
}

function buildReconciliationRows(periods: ReturnType<typeof computeCreditCardPeriods>['recentClosedPeriods']): CreditCardReconciliationGridRow[] {
  return periods.map((period) => ({
    id: period.endDate,
    persistedId: period.reconciliationId,
    status: 'saved',
    errorMessage: null,
    statementDate: period.endDate,
    dueDate: period.dueDate,
    calculatedClosingBalanceMxn: formatEditableNumber(period.calculatedClosingBalanceMxn),
    effectiveClosingBalanceMxn: formatEditableNumber(period.closingBalanceMxn),
    adjustedClosingBalanceMxn: period.isReconciled ? formatEditableNumber(period.closingBalanceMxn) : '',
    adjustmentNote: period.adjustmentNote,
  }));
}

function validateReconciliationRow(row: CreditCardReconciliationGridRow) {
  if (!row.adjustedClosingBalanceMxn.trim()) {
    return 'Captura un saldo o elimina el ajuste.';
  }

  const adjustedClosingBalanceMxn = Number(row.adjustedClosingBalanceMxn);

  if (!Number.isFinite(adjustedClosingBalanceMxn)) {
    return 'Usa un saldo numerico valido.';
  }

  return null;
}

function getActivityTone(kind: ReturnType<typeof computeCreditCardPeriods>['currentActivity'][number]['kind']) {
  if (kind === 'expense') {
    return 'expense';
  }

  if (kind === 'payment' || kind === 'bonus') {
    return 'income';
  }

  return 'neutral';
}

export function CreditCardsPage() {
  const [configRows, setConfigRows] = useState<CreditCardConfigGridRow[]>([]);
  const [configSortColumns, setConfigSortColumns] = useState<readonly SortColumn[]>([
    { columnKey: 'statementDay', direction: 'ASC' },
  ]);
  const [paymentRows, setPaymentRows] = useState<CreditCardPaymentGridRow[]>([createDraftPaymentRow()]);
  const [reconciliationRows, setReconciliationRows] = useState<CreditCardReconciliationGridRow[]>([]);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState('');
  const [expenses, setExpenses] = useState<CreditCardExpense[]>([]);
  const [paymentEntries, setPaymentEntries] = useState<CreditCardPayment[]>([]);
  const [reconciliationEntries, setReconciliationEntries] = useState<CreditCardStatementReconciliation[]>([]);
  const [isSetupLoading, setIsSetupLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const configRowsRef = useRef<CreditCardConfigGridRow[]>([]);
  const paymentRowsRef = useRef<CreditCardPaymentGridRow[]>([]);
  const reconciliationRowsRef = useRef<CreditCardReconciliationGridRow[]>([]);
  const configGridRef = useRef<DataGridHandle>(null);
  const paymentGridRef = useRef<DataGridHandle>(null);
  const reconciliationGridRef = useRef<DataGridHandle>(null);
  const baselineConfigRowsRef = useRef<Map<string, CreditCardConfigGridRow>>(new Map());
  const baselinePaymentRowsRef = useRef<Map<string, CreditCardPaymentGridRow>>(new Map());
  const baselineReconciliationRowsRef = useRef<Map<string, CreditCardReconciliationGridRow>>(new Map());

  useEffect(() => {
    configRowsRef.current = configRows;
  }, [configRows]);

  useEffect(() => {
    paymentRowsRef.current = paymentRows;
  }, [paymentRows]);

  useEffect(() => {
    reconciliationRowsRef.current = reconciliationRows;
  }, [reconciliationRows]);

  const loadSetupData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setConfigRows([]);
      setSelectedInstrumentId('');
      setErrorMessage('Supabase no está configurado en este entorno.');
      return;
    }

    setIsSetupLoading(true);

    const [instrumentsResult, creditCardsResult] = await Promise.all([
      supabase.from('payment_instruments').select('id, name, is_active, notes').eq('instrument_type', 'credit_card').order('name', { ascending: true }),
      supabase.from('credit_cards').select('id, payment_instrument_id, statement_day, grace_days, pre_cutoff_spend_target_mxn, is_active, notes'),
    ]);

    const firstError = instrumentsResult.error || creditCardsResult.error;

    if (firstError) {
      setConfigRows([]);
      setSelectedInstrumentId('');
      setErrorMessage(`No fue posible cargar tarjetas: ${firstError.message}`);
      setIsSetupLoading(false);
      return;
    }

    const instruments = (instrumentsResult.data as PaymentInstrument[]) ?? [];
    const creditCards = (creditCardsResult.data as CreditCardDbRow[]) ?? [];
    const creditCardByInstrumentId = new Map(creditCards.map((card) => [card.payment_instrument_id, card]));
    const mergedRows = instruments.map((instrument) => buildConfigRow(instrument, creditCardByInstrumentId.get(instrument.id)));

    baselineConfigRowsRef.current = new Map(mergedRows.map((row) => [row.id, row]));
    configRowsRef.current = mergedRows;
    setConfigRows(mergedRows);
    setSelectedInstrumentId((currentValue) => {
      if (currentValue && mergedRows.some((row) => row.paymentInstrumentId === currentValue)) {
        return currentValue;
      }

      return mergedRows[0]?.paymentInstrumentId ?? '';
    });
    setErrorMessage(null);
    setIsSetupLoading(false);
  }, []);

  useEffect(() => {
    void loadSetupData();
  }, [loadSetupData]);

  const selectedCardRow = useMemo(
    () => configRows.find((row) => row.paymentInstrumentId === selectedInstrumentId) ?? null,
    [configRows, selectedInstrumentId],
  );

  const sortedConfigRows = useMemo(() => {
    if (configSortColumns.length === 0) {
      return configRows;
    }

    return [...configRows].sort((left, right) => {
      for (const sort of configSortColumns) {
        const direction = sort.direction === 'ASC' ? 1 : -1;

        if (sort.columnKey === 'instrumentName') {
          const result = left.instrumentName.localeCompare(right.instrumentName, 'es-MX');
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'statementDay') {
          const result = compareNullableNumberString(left.statementDay, right.statementDay);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'spendTargetMxn') {
          const result = compareNullableNumberString(left.spendTargetMxn, right.spendTargetMxn);
          if (result !== 0) {
            return result * direction;
          }
        }
      }

      return left.instrumentName.localeCompare(right.instrumentName, 'es-MX');
    });
  }, [configRows, configSortColumns]);

  const loadDetailData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setExpenses([]);
      setPaymentEntries([]);
      setReconciliationEntries([]);
      setPaymentRows([createDraftPaymentRow()]);
      setReconciliationRows([]);
      return;
    }

    if (!selectedInstrumentId) {
      setExpenses([]);
      setPaymentEntries([]);
      setReconciliationEntries([]);
      setPaymentRows([createDraftPaymentRow()]);
      setReconciliationRows([]);
      return;
    }

    setIsDetailLoading(true);

    const paymentsPromise = selectedCardRow?.persistedId
      ? supabase
          .from('credit_card_payments')
          .select('id, payment_date, amount_mxn, bonus_statement_credit_mxn, bonus_reward_points, notes')
          .eq('credit_card_id', selectedCardRow.persistedId)
          .order('payment_date', { ascending: false })
      : Promise.resolve({ data: [] as CreditCardPaymentDbRow[], error: null });

    const reconciliationsPromise = selectedCardRow?.persistedId
      ? supabase
          .from('credit_card_statement_reconciliations')
          .select('id, statement_date, adjusted_closing_balance_mxn, adjustment_note')
          .eq('credit_card_id', selectedCardRow.persistedId)
          .order('statement_date', { ascending: false })
      : Promise.resolve({ data: [] as CreditCardReconciliationDbRow[], error: null });

    const [expensesResult, paymentsResult, reconciliationsResult] = await Promise.all([
      supabase
        .from('expense_entries')
        .select('id, entry_date, concept, total_amount_mxn')
        .eq('payment_instrument_id', selectedInstrumentId)
        .order('entry_date', { ascending: false }),
      paymentsPromise,
      reconciliationsPromise,
    ]);

    const firstError = expensesResult.error || paymentsResult.error || reconciliationsResult.error;

    if (firstError) {
      setExpenses([]);
      setPaymentEntries([]);
      setReconciliationEntries([]);
      setPaymentRows([createDraftPaymentRow()]);
      setReconciliationRows([]);
      setErrorMessage(`No fue posible cargar movimientos: ${firstError.message}`);
      setIsDetailLoading(false);
      return;
    }

    const nextExpenses: CreditCardExpense[] = ((expensesResult.data as Array<{ id: string; entry_date: string; concept: string; total_amount_mxn: number }>) ?? []).map((row) => ({
      id: row.id,
      entryDate: row.entry_date,
      concept: row.concept,
      totalAmountMxn: Number(row.total_amount_mxn ?? 0),
    }));
    const nextPayments: CreditCardPayment[] = ((paymentsResult.data as CreditCardPaymentDbRow[]) ?? []).map((row) => ({
      id: row.id,
      paymentDate: row.payment_date,
      amountMxn: Number(row.amount_mxn ?? 0),
      bonusStatementCreditMxn: Number(row.bonus_statement_credit_mxn ?? 0),
      bonusRewardPoints: Number(row.bonus_reward_points ?? 0),
      notes: row.notes ?? '',
    }));
    const nextReconciliations: CreditCardStatementReconciliation[] = ((reconciliationsResult.data as CreditCardReconciliationDbRow[]) ?? []).map((row) => ({
      id: row.id,
      statementDate: row.statement_date,
      adjustedClosingBalanceMxn: Number(row.adjusted_closing_balance_mxn ?? 0),
      adjustmentNote: row.adjustment_note ?? '',
    }));
    const nextPaymentRows = withDraftPaymentRow(nextPayments.map((row) => toPaymentGridRow({
      id: row.id,
      payment_date: row.paymentDate,
      amount_mxn: row.amountMxn,
      bonus_statement_credit_mxn: row.bonusStatementCreditMxn,
      bonus_reward_points: row.bonusRewardPoints,
      notes: row.notes,
    })));

    setExpenses(nextExpenses);
    setPaymentEntries(nextPayments);
    setReconciliationEntries(nextReconciliations);
    baselinePaymentRowsRef.current = new Map(nextPaymentRows.filter((row) => !row.isDraft).map((row) => [row.id, row]));
    paymentRowsRef.current = nextPaymentRows;
    setPaymentRows(nextPaymentRows);
    setErrorMessage(null);
    setIsDetailLoading(false);
  }, [selectedCardRow?.persistedId, selectedInstrumentId]);

  useEffect(() => {
    void loadDetailData();
  }, [loadDetailData]);

  const computation = useMemo(() => {
    if (!selectedCardRow) {
      return null;
    }

    const statementDay = Number(selectedCardRow.statementDay || '0');
    const graceDays = Number(selectedCardRow.graceDays || '0');

    if (!Number.isInteger(statementDay) || statementDay < 1 || !Number.isInteger(graceDays) || graceDays < 1) {
      return null;
    }

    return computeCreditCardPeriods({
      statementDay,
      graceDays,
      expenses,
      payments: paymentEntries,
      reconciliations: reconciliationEntries,
    });
  }, [expenses, paymentEntries, reconciliationEntries, selectedCardRow]);

  useEffect(() => {
    const nextRows = buildReconciliationRows(computation?.recentClosedPeriods ?? []);
    baselineReconciliationRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    reconciliationRowsRef.current = nextRows;
    setReconciliationRows(nextRows);
  }, [computation]);

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

  const persistConfigRow = useCallback(
    async (rowId: string) => {
      if (!supabase) {
        setErrorMessage('Supabase no está disponible para guardar tarjetas.');
        return;
      }

      const row = configRowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        return;
      }

      const normalizedRow = normalizeConfigRow(row);
      const validationMessage = validateConfigRow(normalizedRow);

      if (validationMessage) {
        setConfigRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate
        )));
        setErrorMessage(validationMessage);
        return;
      }

      setConfigRows((currentRows) => currentRows.map((candidate) => (
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate
      )));

      const payload = {
        payment_instrument_id: normalizedRow.paymentInstrumentId,
        statement_day: Number(normalizedRow.statementDay),
        grace_days: Number(normalizedRow.graceDays),
        pre_cutoff_spend_target_mxn: Number((Number(normalizedRow.spendTargetMxn || '0')).toFixed(6)),
        is_active: normalizedRow.isActive === 'true',
        notes: normalizedRow.notes.trim() || null,
      };

      const result = row.persistedId
        ? await supabase.from('credit_cards').update(payload).eq('id', row.persistedId)
        : await supabase.from('credit_cards').insert(payload);

      if (result.error) {
        setConfigRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate
        )));
        setErrorMessage(`No fue posible guardar la tarjeta: ${result.error.message}`);
        return;
      }

      await loadSetupData();
    },
    [loadSetupData],
  );

  const deleteConfigRow = useCallback(
    async (row: CreditCardConfigGridRow) => {
      if (!row.persistedId) {
        const baselineRow = baselineConfigRowsRef.current.get(row.id);

        if (!baselineRow) {
          return;
        }

        setConfigRows((currentRows) => currentRows.map((candidate) => (candidate.id === row.id ? baselineRow : candidate)));
        return;
      }

      if (!supabase) {
        setErrorMessage('Supabase no está disponible para eliminar tarjetas.');
        return;
      }

      if (!window.confirm('Quitar configuración de esta tarjeta?')) {
        return;
      }

      const { error } = await supabase.from('credit_cards').delete().eq('id', row.persistedId);

      if (error) {
        setErrorMessage(`No fue posible quitar la configuración: ${error.message}`);
        return;
      }

      await loadSetupData();
    },
    [loadSetupData],
  );

  const persistPaymentRow = useCallback(
    async (rowId: string) => {
      if (!supabase || !selectedCardRow?.persistedId) {
        setErrorMessage('Primero guarda la configuración de la tarjeta.');
        return;
      }

      const row = paymentRowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        return;
      }

      const validationMessage = validatePaymentRow(row);

      if (validationMessage) {
        setPaymentRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate
        )));
        setErrorMessage(validationMessage);
        return;
      }

      setPaymentRows((currentRows) => currentRows.map((candidate) => (
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate
      )));

      const payload = {
        credit_card_id: selectedCardRow.persistedId,
        payment_date: row.paymentDate,
        amount_mxn: Number((Number(row.amountMxn || '0')).toFixed(6)),
        bonus_statement_credit_mxn: Number((Number(row.bonusStatementCreditMxn || '0')).toFixed(6)),
        bonus_reward_points: Number((Number(row.bonusRewardPoints || '0')).toFixed(6)),
        notes: row.notes.trim() || null,
      };

      const result = row.persistedId
        ? await supabase.from('credit_card_payments').update(payload).eq('id', row.persistedId)
        : await supabase.from('credit_card_payments').insert(payload);

      if (result.error) {
        setPaymentRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate
        )));
        setErrorMessage(`No fue posible guardar el movimiento: ${result.error.message}`);
        return;
      }

      await loadDetailData();
    },
    [loadDetailData, selectedCardRow?.persistedId],
  );

  const deletePaymentRow = useCallback(
    async (row: CreditCardPaymentGridRow) => {
      if (row.isDraft) {
        setPaymentRows(withDraftPaymentRow(paymentRowsRef.current.filter((candidate) => !candidate.isDraft)));
        return;
      }

      if (!supabase) {
        setErrorMessage('Supabase no está disponible para eliminar movimientos.');
        return;
      }

      if (!window.confirm('Eliminar este movimiento?')) {
        return;
      }

      const { error } = await supabase.from('credit_card_payments').delete().eq('id', row.persistedId);

      if (error) {
        setErrorMessage(`No fue posible eliminar el movimiento: ${error.message}`);
        return;
      }

      await loadDetailData();
    },
    [loadDetailData],
  );

  const persistReconciliationRow = useCallback(
    async (rowId: string) => {
      if (!supabase || !selectedCardRow?.persistedId) {
        setErrorMessage('Primero guarda la configuración de la tarjeta.');
        return;
      }

      const row = reconciliationRowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        return;
      }

      const validationMessage = validateReconciliationRow(row);

      if (validationMessage) {
        setReconciliationRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate
        )));
        setErrorMessage(validationMessage);
        return;
      }

      setReconciliationRows((currentRows) => currentRows.map((candidate) => (
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate
      )));

      const payload = {
        credit_card_id: selectedCardRow.persistedId,
        statement_date: row.statementDate,
        adjusted_closing_balance_mxn: Number((Number(row.adjustedClosingBalanceMxn)).toFixed(6)),
        adjustment_note: row.adjustmentNote.trim() || null,
      };

      const result = row.persistedId
        ? await supabase.from('credit_card_statement_reconciliations').update(payload).eq('id', row.persistedId)
        : await supabase.from('credit_card_statement_reconciliations').insert(payload);

      if (result.error) {
        setReconciliationRows((currentRows) => currentRows.map((candidate) => (
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate
        )));
        setErrorMessage(`No fue posible guardar el ajuste: ${result.error.message}`);
        return;
      }

      await loadDetailData();
    },
    [loadDetailData, selectedCardRow?.persistedId],
  );

  const deleteReconciliationRow = useCallback(
    async (row: CreditCardReconciliationGridRow) => {
      if (!row.persistedId || !supabase) {
        return;
      }

      if (!window.confirm('Eliminar ajuste manual?')) {
        return;
      }

      const { error } = await supabase.from('credit_card_statement_reconciliations').delete().eq('id', row.persistedId);

      if (error) {
        setErrorMessage(`No fue posible eliminar el ajuste: ${error.message}`);
        return;
      }

      await loadDetailData();
    },
    [loadDetailData],
  );

  function handleConfigRowsChange(nextRows: CreditCardConfigGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0];

    if (rowIndex == null) {
      setConfigRows(nextRows);
      return;
    }

    const editedRow = normalizeConfigRow(nextRows[rowIndex]);
    const validationMessage = validateConfigRow(editedRow);
    const updatedRows: CreditCardConfigGridRow[] = nextRows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...editedRow,
        status: validationMessage ? 'error' : editedRow.persistedId ? 'dirty' : 'new',
        errorMessage: validationMessage,
      };
    });

    setConfigRows(updatedRows);
  }

  function handlePaymentRowsChange(nextRows: CreditCardPaymentGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0];

    if (rowIndex == null) {
      setPaymentRows(nextRows);
      return;
    }

    const editedRow = nextRows[rowIndex];
    const validationMessage = editedRow.isDraft ? null : validatePaymentRow(editedRow);
    const updatedRows: CreditCardPaymentGridRow[] = nextRows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...editedRow,
        status: validationMessage ? 'error' : editedRow.isDraft ? 'new' : 'dirty',
        errorMessage: validationMessage,
      };
    });

    setPaymentRows(updatedRows);
  }

  function handleReconciliationRowsChange(nextRows: CreditCardReconciliationGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0];

    if (rowIndex == null) {
      setReconciliationRows(nextRows);
      return;
    }

    const editedRow = nextRows[rowIndex];
    const validationMessage = editedRow.adjustedClosingBalanceMxn.trim() ? validateReconciliationRow(editedRow) : null;
    const updatedRows: CreditCardReconciliationGridRow[] = nextRows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...editedRow,
        status: validationMessage ? 'error' : 'dirty',
        errorMessage: validationMessage,
      };
    });

    setReconciliationRows(updatedRows);
  }

  const summaryMetrics = useMemo(() => {
    if (!selectedCardRow || !computation) {
      return [] as Array<{ key: string; icon: typeof faCreditCard; label: string; value: string; tone?: 'ok' | 'warn' }>; 
    }

    const currentBalance = computation.currentPeriod?.closingBalanceMxn ?? computation.lastClosedPeriod?.closingBalanceMxn ?? 0;
    const currentSpend = computation.currentPeriod?.spendMxn ?? 0;
    const spendTarget = Number(selectedCardRow.spendTargetMxn || '0');
    const progressLabel = spendTarget > 0 ? `${Math.round((currentSpend / spendTarget) * 100)}%` : 'Off';
    const spendTone = currentSpend >= spendTarget ? 'ok' : 'warn';
    const lastStatementBalance = computation.currentPeriod?.openingBalanceMxn ?? computation.lastClosedPeriod?.closingBalanceMxn ?? 0;
    const lastStatementCredits = computation.currentPeriod?.paymentMxn ?? 0;
    const dueTone = computation.lastClosedPeriod
      ? lastStatementCredits >= lastStatementBalance ? 'ok' : 'warn'
      : undefined;

    return [
      { key: 'balance', icon: faCreditCard, label: 'Saldo', value: formatCurrencyValue(currentBalance), tone: currentBalance > 0 ? 'warn' : 'ok' },
      { key: 'last', icon: faCalendarDay, label: 'Últ. corte', value: computation.lastClosedPeriod?.endDate ?? '—' },
      { key: 'due-current', icon: faCalendarDay, label: 'Vence', value: computation.lastClosedPeriod?.dueDate ?? '—', tone: dueTone },
      { key: 'next', icon: faCalendarDay, label: 'Próx. corte', value: computation.nextStatementDate },
      { key: 'spend', icon: faChartLine, label: 'Periodo', value: formatCurrencyValue(currentSpend), tone: spendTone },
      { key: 'target', icon: faChartLine, label: 'Meta', value: spendTarget > 0 ? `${formatCurrencyValue(spendTarget)} · ${progressLabel}` : 'Sin meta' },
      { key: 'points', icon: faCoins, label: 'Pts.', value: formatPointsValue(computation.allTimeRewardPoints) },
    ];
  }, [computation, selectedCardRow]);

  const configColumns = useMemo<readonly Column<CreditCardConfigGridRow>[]>(() => [
    {
      key: 'actions',
      name: '',
      width: CONFIG_ACTION_COLUMN_WIDTH,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
        const showSaveActions = row.persistedId == null || row.status === 'dirty' || row.status === 'error';
        const showDelete = Boolean(row.persistedId) && !showSaveActions;

        return (
          <div className={`grid-actions ${showSaveActions ? 'grid-actions--2' : showDelete ? 'grid-actions--1' : 'grid-actions--1'}`}>
            {showSaveActions ? (
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
                      void persistConfigRow(row.id);
                    });
                  }}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                <button
                  type="button"
                  className="grid-action grid-action--revert"
                  title="Deshacer"
                  aria-label="Deshacer"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const baselineRow = baselineConfigRowsRef.current.get(row.id);

                    if (!baselineRow) {
                      return;
                    }

                    setConfigRows((currentRows) => currentRows.map((candidate) => (candidate.id === row.id ? baselineRow : candidate)));
                  }}
                >
                  <FontAwesomeIcon icon={faRotateLeft} />
                </button>
              </>
            ) : null}
            {showDelete ? (
              <button
                type="button"
                className="grid-action grid-action--delete"
                title="Quitar"
                aria-label="Quitar"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void deleteConfigRow(row);
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            ) : null}
            {!showSaveActions && !showDelete ? <span className="credit-cards-grid-empty-action" /> : null}
          </div>
        );
      },
    },
    {
      key: 'instrumentName',
      name: 'Tarjeta',
      width: 180,
      editable: false,
      sortable: true,
      renderCell: ({ row }) => row.instrumentName,
    },
    {
      key: 'statementDay',
      name: 'Corte',
      width: 84,
      sortable: true,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="1" step="1" placeholder="20" />,
    },
    {
      key: 'graceDays',
      name: 'Gr.',
      width: 72,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="1" step="1" placeholder="20" />,
    },
    {
      key: 'spendTargetMxn',
      name: 'Meta',
      width: 100,
      sortable: true,
      renderCell: ({ row }) => formatCurrencyValue(Number(row.spendTargetMxn || '0')),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0" />,
    },
    {
      key: 'isActive',
      name: 'Act.',
      width: 72,
      renderCell: ({ row }) => (row.isActive === 'true' ? 'Sí' : 'No'),
      renderEditCell: (props) => <SelectCellEditor {...props} options={BOOLEAN_OPTIONS} />,
    },
    {
      key: 'notes',
      name: 'Notas',
      width: 180,
      renderCell: ({ row }) => row.notes || '—',
      renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
    },
  ], [deleteConfigRow, persistConfigRow]);

  const paymentColumns = useMemo<readonly Column<CreditCardPaymentGridRow>[]>(() => [
    {
      key: 'actions',
      name: '',
      width: PAYMENT_ACTION_COLUMN_WIDTH,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
        const showPrimaryActions = row.isDraft || row.status === 'dirty' || row.status === 'error';

        return (
          <div className={`grid-actions grid-actions--${showPrimaryActions ? 2 : 1}`}>
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
                      void persistPaymentRow(row.id);
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
                    if (row.isDraft) {
                      setPaymentRows(withDraftPaymentRow(paymentRowsRef.current.filter((candidate) => !candidate.isDraft)));
                      return;
                    }

                    const baselineRow = baselinePaymentRowsRef.current.get(row.id);
                    if (!baselineRow) {
                      return;
                    }

                    setPaymentRows((currentRows) => currentRows.map((candidate) => (candidate.id === row.id ? baselineRow : candidate)));
                  }}
                >
                  <FontAwesomeIcon icon={row.isDraft ? faEraser : faRotateLeft} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="grid-action grid-action--delete"
                title="Eliminar"
                aria-label="Eliminar"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void deletePaymentRow(row);
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'paymentDate',
      name: 'F.',
      width: 94,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" placeholder="YYYY-MM-DD" />,
    },
    {
      key: 'amountMxn',
      name: 'Pago',
      width: 92,
      renderCell: ({ row }) => formatCurrencyValue(Number(row.amountMxn || '0')),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0" />,
    },
    {
      key: 'bonusStatementCreditMxn',
      name: 'Bonif.',
      width: 96,
      renderCell: ({ row }) => formatCurrencyValue(Number(row.bonusStatementCreditMxn || '0')),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0" />,
    },
    {
      key: 'bonusRewardPoints',
      name: 'Pts.',
      width: 84,
      renderCell: ({ row }) => formatPointsValue(Number(row.bonusRewardPoints || '0')),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0" />,
    },
    {
      key: 'notes',
      name: 'Notas',
      width: 180,
      renderCell: ({ row }) => row.notes || '—',
      renderEditCell: (props) => <InputCellEditor {...props} placeholder="Banco, promo, referencia" />,
    },
  ], [deletePaymentRow, persistPaymentRow]);

  const reconciliationColumns = useMemo<readonly Column<CreditCardReconciliationGridRow>[]>(() => [
    {
      key: 'actions',
      name: '',
      width: RECON_ACTION_COLUMN_WIDTH,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
        const showSaveActions = row.status === 'dirty' || row.status === 'error';

        return (
          <div className={`grid-actions grid-actions--${showSaveActions ? 2 : 1}`}>
            {showSaveActions ? (
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
                      void persistReconciliationRow(row.id);
                    });
                  }}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                <button
                  type="button"
                  className="grid-action grid-action--revert"
                  title="Deshacer"
                  aria-label="Deshacer"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const baselineRow = baselineReconciliationRowsRef.current.get(row.id);

                    if (!baselineRow) {
                      return;
                    }

                    setReconciliationRows((currentRows) => currentRows.map((candidate) => (candidate.id === row.id ? baselineRow : candidate)));
                  }}
                >
                  <FontAwesomeIcon icon={faRotateLeft} />
                </button>
              </>
            ) : row.persistedId ? (
              <button
                type="button"
                className="grid-action grid-action--delete"
                title="Eliminar"
                aria-label="Eliminar"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void deleteReconciliationRow(row);
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            ) : (
              <span className="credit-cards-grid-empty-action" />
            )}
          </div>
        );
      },
    },
    {
      key: 'statementDate',
      name: 'Corte',
      width: 94,
      editable: false,
    },
    {
      key: 'dueDate',
      name: 'Vence',
      width: 94,
      editable: false,
    },
    {
      key: 'calculatedClosingBalanceMxn',
      name: 'Calc.',
      width: 90,
      editable: false,
      renderCell: ({ row }) => formatCurrencyValue(Number(row.calculatedClosingBalanceMxn || '0')),
    },
    {
      key: 'adjustedClosingBalanceMxn',
      name: 'Ajuste',
      width: 90,
      renderCell: ({ row }) => (row.adjustedClosingBalanceMxn ? formatCurrencyValue(Number(row.adjustedClosingBalanceMxn)) : '—'),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" step="0.01" placeholder="0" />,
    },
    {
      key: 'effectiveClosingBalanceMxn',
      name: 'Efec.',
      width: 90,
      editable: false,
      renderCell: ({ row }) => formatCurrencyValue(Number(row.effectiveClosingBalanceMxn || '0')),
    },
    {
      key: 'adjustmentNote',
      name: 'Nota',
      width: 160,
      renderCell: ({ row }) => row.adjustmentNote || '—',
      renderEditCell: (props) => <InputCellEditor {...props} placeholder="Estado, ajuste, promo" />,
    },
  ], [deleteReconciliationRow, persistReconciliationRow]);

  const currentRowError = [
    ...configRows.filter((row) => row.status === 'error').map((row) => row.errorMessage),
    ...paymentRows.filter((row) => row.status === 'error').map((row) => row.errorMessage),
    ...reconciliationRows.filter((row) => row.status === 'error').map((row) => row.errorMessage),
  ].find(Boolean);
  const visibleErrorMessage = currentRowError ?? errorMessage;

  const handleNavigateConfigGrid = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef: configGridRef,
        columns: configColumns,
        rows: sortedConfigRows,
        rowIdx,
        columnIdx,
      });
    },
    [configColumns, sortedConfigRows],
  );

  const handleNavigatePaymentGrid = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef: paymentGridRef,
        columns: paymentColumns,
        rows: paymentRows,
        rowIdx,
        columnIdx,
      });
    },
    [paymentColumns, paymentRows],
  );

  const handleNavigateReconciliationGrid = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef: reconciliationGridRef,
        columns: reconciliationColumns,
        rows: reconciliationRows,
        rowIdx,
        columnIdx,
      });
    },
    [reconciliationColumns, reconciliationRows],
  );

  return (
    <div className="page credit-cards-page">
      <section className="card credit-cards-toolbar">
        <div className="credit-cards-toolbar__main">
          <span className={`status-pill status-pill--${isSetupLoading || isDetailLoading ? 'checking' : selectedCardRow?.persistedId ? 'ok' : 'idle'}`}>
            {isSetupLoading || isDetailLoading ? 'Sync' : selectedCardRow?.persistedId ? 'Lista' : 'Pend.'}
          </span>
          <span className="dashboard-stat">{configRows.length} tarjetas</span>
          {selectedCardRow ? <span className="dashboard-stat">{selectedCardRow.instrumentName}</span> : null}
          {selectedCardRow ? <span className="dashboard-stat">Corte {selectedCardRow.statementDay || '—'}</span> : null}
        </div>
      </section>

      {visibleErrorMessage ? <div className="feedback-banner feedback-banner--error">{visibleErrorMessage}</div> : null}

      <section className="card credit-cards-panel">
        <div className="credit-cards-panel__header">
          <div className="credit-cards-panel__heading">
            <FontAwesomeIcon icon={faCreditCard} />
            <strong>Tarjetas</strong>
          </div>
          <span className="dashboard-stat">Pend. {configRows.filter((row) => !row.persistedId).length}</span>
        </div>
        <div className="grid-wrapper grid-wrapper--tall">
          <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateConfigGrid}>
            <DataGrid
              ref={configGridRef}
              columns={configColumns}
              rows={sortedConfigRows}
              rowHeight={GRID_ROW_HEIGHT}
              headerRowHeight={GRID_ROW_HEIGHT}
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleConfigRowsChange}
              sortColumns={configSortColumns}
              onSortColumnsChange={(nextSortColumns) => {
                setConfigSortColumns(nextSortColumns.filter((sort) => CONFIG_SORTABLE_COLUMN_KEYS.has(sort.columnKey)));
              }}
              onCellClick={(args) => {
                setSelectedInstrumentId(args.row.paymentInstrumentId);
                if (args.column.renderEditCell) {
                  args.selectCell(true);
                }
              }}
              defaultColumnOptions={{ resizable: true }}
              rowClass={(row) => {
                const stateClass = row.status === 'saving'
                  ? 'row-saving'
                  : row.status === 'error'
                    ? 'row-error'
                    : row.status === 'dirty'
                      ? 'row-dirty'
                      : row.status === 'new'
                        ? 'row-new'
                        : 'row-saved';

                return `${stateClass}${row.paymentInstrumentId === selectedInstrumentId ? ' row-selected-soft' : ''}`;
              }}
              style={{ blockSize: 240 }}
            />
          </GridEditorNavigationProvider>
        </div>
      </section>

      <section className="credit-cards-metrics">
        {summaryMetrics.length > 0 ? summaryMetrics.map((metric) => (
          <article key={metric.key} className={`credit-cards-metric ${metric.tone ? `credit-cards-metric--${metric.tone}` : ''}`}>
            <span className="credit-cards-metric__icon" aria-hidden="true">
              <FontAwesomeIcon icon={metric.icon} />
            </span>
            <div className="credit-cards-metric__body">
              <span className="credit-cards-metric__label">{metric.label}</span>
              <strong className="credit-cards-metric__value">{metric.value}</strong>
            </div>
          </article>
        )) : (
          <article className="card credit-cards-empty-card">
            <div className="credit-cards-empty-card__icon" aria-hidden="true">
              <FontAwesomeIcon icon={faCreditCard} />
            </div>
            <p className="card__text">Crea o selecciona una tarjeta.</p>
          </article>
        )}
      </section>

      <section className="credit-cards-layout">
        <section className="card credit-cards-panel">
          <div className="credit-cards-panel__header">
            <div className="credit-cards-panel__heading">
              <FontAwesomeIcon icon={faCoins} />
              <strong>Abonos</strong>
            </div>
            <span className="dashboard-stat">{paymentRows.filter((row) => !row.isDraft).length}</span>
          </div>
          <div className="grid-wrapper grid-wrapper--tall">
            <GridEditorNavigationProvider onNavigateToNextCell={handleNavigatePaymentGrid}>
              <DataGrid
                ref={paymentGridRef}
                columns={paymentColumns}
                rows={paymentRows}
                rowHeight={GRID_ROW_HEIGHT}
                headerRowHeight={GRID_ROW_HEIGHT}
                rowKeyGetter={(row) => row.id}
                onRowsChange={handlePaymentRowsChange}
                onCellClick={(args) => {
                  if (args.column.renderEditCell) {
                    args.selectCell(true);
                  }
                }}
                defaultColumnOptions={{ resizable: true }}
                rowClass={(row) => (
                  row.status === 'saving'
                    ? 'row-saving'
                    : row.status === 'error'
                      ? 'row-error'
                      : row.status === 'dirty'
                        ? 'row-dirty'
                        : row.status === 'new'
                          ? 'row-new'
                          : 'row-saved'
                )}
                style={{ blockSize: 340 }}
              />
            </GridEditorNavigationProvider>
          </div>
        </section>

        <section className="card credit-cards-panel credit-cards-panel--side">
          <div className="credit-cards-panel__header">
            <div className="credit-cards-panel__heading">
              <FontAwesomeIcon icon={faCalendarDay} />
              <strong>Cierres</strong>
            </div>
            <span className="dashboard-stat">{reconciliationRows.length}</span>
          </div>

          <div className="grid-wrapper grid-wrapper--tall">
            <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateReconciliationGrid}>
              <DataGrid
                ref={reconciliationGridRef}
                columns={reconciliationColumns}
                rows={reconciliationRows}
                rowHeight={GRID_ROW_HEIGHT}
                headerRowHeight={GRID_ROW_HEIGHT}
                rowKeyGetter={(row) => row.id}
                onRowsChange={handleReconciliationRowsChange}
                onCellClick={(args) => {
                  if (args.column.renderEditCell) {
                    args.selectCell(true);
                  }
                }}
                defaultColumnOptions={{ resizable: true }}
                rowClass={(row) => (
                  row.status === 'saving'
                    ? 'row-saving'
                    : row.status === 'error'
                      ? 'row-error'
                      : row.status === 'dirty'
                        ? 'row-dirty'
                        : 'row-saved'
                )}
                style={{ blockSize: 250 }}
              />
            </GridEditorNavigationProvider>
          </div>

          <div className="credit-cards-activity">
            <div className="credit-cards-panel__heading">
              <FontAwesomeIcon icon={faChartLine} />
              <strong>Periodo</strong>
            </div>
            <div className="credit-cards-activity__list">
              {computation?.currentActivity.length ? computation.currentActivity.slice(0, 10).map((item) => (
                <article key={item.id} className="credit-cards-activity__row">
                  <div className="credit-cards-activity__meta">
                    <strong>{item.label}</strong>
                    <span>{item.date}</span>
                  </div>
                  <strong className={`credit-cards-activity__value credit-cards-activity__value--${getActivityTone(item.kind)}`}>
                    {item.kind === 'points' ? `${formatPointsValue(item.points)} pts` : formatCurrencyValue(item.amountMxn)}
                  </strong>
                </article>
              )) : (
                <div className="credit-cards-activity__empty">Sin movs.</div>
              )}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
