import { formatEditableNumber, type Security } from './shared';

type DividendImportJsonItem = {
  contract_id?: unknown;
  legacy_contract_id?: unknown;
  security_id?: unknown;
  process_date?: unknown;
  settlement_date?: unknown;
  transaction_amount?: unknown;
  transaction_description?: unknown;
  transaction_id?: unknown;
  sub_transaction_type?: unknown;
};

type DividendImportJsonPayload = {
  items?: unknown;
};

export type DividendImportCurrencyCode = 'MXN' | 'USD';

export type DividendImportRawItem = {
  sourceTransactionId: string;
  contractKey: string;
  rawTicker: string;
  normalizedTicker: string;
  entryDate: string;
  settlementDate: string;
  amount: number;
  description: string;
  subTransactionType: number | null;
  kind: 'dividend' | 'tax' | 'ignored';
};

export type DividendImportPreviewStatus =
  | 'ready'
  | 'duplicate'
  | 'ticker-unresolved'
  | 'ambiguous-group'
  | 'invalid'
  | 'saved'
  | 'saving'
  | 'save-error';

export type DividendImportPreviewIssueCode =
  | 'missing-dividend'
  | 'multiple-dividends'
  | 'multiple-taxes'
  | 'ticker-unresolved'
  | 'duplicate-source-id'
  | 'missing-broker'
  | 'invalid-fx'
  | 'invalid-net'
  | 'save-error';

export type DividendImportPreviewIssue = {
  code: DividendImportPreviewIssueCode;
  message: string;
};

export type DividendImportPreviewRow = {
  id: string;
  selected: boolean;
  status: DividendImportPreviewStatus;
  issues: DividendImportPreviewIssue[];
  entryDate: string;
  rawTicker: string;
  normalizedTicker: string;
  dividendDescription: string;
  matchedSecurityId: string;
  brokerId: string;
  currencyCode: DividendImportCurrencyCode;
  fxRateToMxn: string;
  grossAmountOriginal: string;
  taxWithheldOriginal: string;
  netAmountOriginal: string;
  netAmountMxn: string;
  sourceDividendTransactionId: string;
  sourceTaxTransactionId: string;
};

export type DividendImportParseResult = {
  previewRows: DividendImportPreviewRow[];
  ignoredCount: number;
};

type DividendImportGroup = {
  key: string;
  contractKey: string;
  rawTicker: string;
  normalizedTicker: string;
  entryDate: string;
  pairingDate: string;
  dividends: DividendImportRawItem[];
  taxes: DividendImportRawItem[];
};

const DIVIDEND_SUB_TRANSACTION_TYPES = new Set([1, 266, 974, 2394]);
const TAX_SUB_TRANSACTION_TYPES = new Set([3336, 3588, 3590]);
const CAPITAL_RETURN_SUB_TRANSACTION_TYPE = 266;

function createPreviewRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeImportedTicker(rawTicker: string) {
  return rawTicker.trim().toUpperCase().replace(/\*/g, '').replace(/\s+/g, '');
}

export function classifyDividendImportItem(description: string, subTransactionType: number | null) {
  if (subTransactionType != null && DIVIDEND_SUB_TRANSACTION_TYPES.has(subTransactionType)) {
    return 'dividend' as const;
  }

  if (subTransactionType != null && TAX_SUB_TRANSACTION_TYPES.has(subTransactionType)) {
    return 'tax' as const;
  }

  const normalizedDescription = description.trim().toUpperCase();

  if (normalizedDescription.includes('CANCELA')) {
    return 'ignored' as const;
  }

  if (
    normalizedDescription.includes('ISR') &&
    (
      normalizedDescription.includes('DIVIDEND') ||
      normalizedDescription.includes('RETENCION') ||
      normalizedDescription.includes('RESULTADO FISCAL')
    )
  ) {
    return 'tax' as const;
  }

  if (
    normalizedDescription.includes('ABONO') &&
    (
      normalizedDescription.includes('DIVIDEND') ||
      normalizedDescription.includes('REEMBOLSO DE CAPITAL') ||
      normalizedDescription.includes('RESULTADO FISCAL')
    )
  ) {
    return 'dividend' as const;
  }

  return 'ignored' as const;
}

function getDividendImportPairingBucket(item: Pick<DividendImportRawItem, 'kind' | 'subTransactionType'>) {
  if (item.kind === 'tax') {
    return 'taxed' as const;
  }

  if (item.subTransactionType === CAPITAL_RETURN_SUB_TRANSACTION_TYPE) {
    return 'no-tax' as const;
  }

  return 'taxed' as const;
}

function getDividendImportGroupKey(item: DividendImportRawItem) {
  const pairingDate = item.settlementDate || item.entryDate;
  const pairingBucket = getDividendImportPairingBucket(item);

  if (pairingBucket === 'no-tax') {
    return {
      pairingDate,
      key: `${item.contractKey}::${item.normalizedTicker}::${pairingDate}::${pairingBucket}::${item.sourceTransactionId}`,
    };
  }

  return {
    pairingDate,
    key: `${item.contractKey}::${item.normalizedTicker}::${pairingDate}::${pairingBucket}`,
  };
}

export function buildSecurityOptionLookup(securities: Security[]) {
  const normalizedTickerToSecurityIds = new Map<string, string[]>();

  for (const security of securities) {
    const normalizedTicker = normalizeImportedTicker(security.ticker);
    const existingIds = normalizedTickerToSecurityIds.get(normalizedTicker) ?? [];
    normalizedTickerToSecurityIds.set(normalizedTicker, [...existingIds, security.id]);
  }

  return normalizedTickerToSecurityIds;
}

export function parseDividendImportFile(
  rawJson: string,
  config: {
    brokerId: string;
    currencyCode: DividendImportCurrencyCode;
    fxRateToMxn: string;
    securities: Security[];
  },
) {
  let parsedPayload: DividendImportJsonPayload;

  try {
    parsedPayload = JSON.parse(rawJson) as DividendImportJsonPayload;
  } catch {
    throw new Error('El archivo no contiene un JSON válido.');
  }

  if (!parsedPayload || !Array.isArray(parsedPayload.items)) {
    throw new Error('El JSON debe contener una propiedad items con un arreglo.');
  }

  const rawItems: DividendImportRawItem[] = [];
  let ignoredCount = 0;

  for (const item of parsedPayload.items as DividendImportJsonItem[]) {
    const contractId = typeof item.contract_id === 'string' ? item.contract_id : '';
    const legacyContractId = typeof item.legacy_contract_id === 'string' ? item.legacy_contract_id : '';
    const rawTicker = typeof item.security_id === 'string' ? item.security_id : '';
    const processDate = typeof item.process_date === 'string' ? item.process_date : '';
    const settlementDate = typeof item.settlement_date === 'string' ? item.settlement_date : '';
    const transactionDescription = typeof item.transaction_description === 'string' ? item.transaction_description : '';
    const transactionId = item.transaction_id == null ? '' : String(item.transaction_id);
    const amount = Number(item.transaction_amount);
    const subTransactionType = typeof item.sub_transaction_type === 'number' ? item.sub_transaction_type : Number.isFinite(Number(item.sub_transaction_type)) ? Number(item.sub_transaction_type) : null;
    const contractKey = contractId.trim() || legacyContractId.trim();

    if (!rawTicker.trim() || !processDate || !transactionId || !Number.isFinite(amount) || amount < 0) {
      ignoredCount += 1;
      continue;
    }

    const kind = classifyDividendImportItem(transactionDescription, subTransactionType);

    if (kind === 'ignored') {
      ignoredCount += 1;
      continue;
    }

    rawItems.push({
      sourceTransactionId: transactionId,
      contractKey,
      rawTicker,
      normalizedTicker: normalizeImportedTicker(rawTicker),
      entryDate: processDate.slice(0, 10),
      settlementDate: settlementDate.slice(0, 10),
      amount,
      description: transactionDescription,
      subTransactionType,
      kind,
    });
  }

  const securityLookup = buildSecurityOptionLookup(config.securities);
  const groupedItems = new Map<string, DividendImportGroup>();

  for (const item of rawItems) {
    // Taxes can post on a different process date than the dividend, but still share settlement.
    // Capital returns (266) stay separate because they do not carry ISR.
    const { pairingDate, key } = getDividendImportGroupKey(item);
    const existingGroup = groupedItems.get(key);

    if (existingGroup) {
      if (item.kind === 'dividend') {
        existingGroup.dividends.push(item);
      } else {
        existingGroup.taxes.push(item);
      }
      continue;
    }

    groupedItems.set(key, {
      key,
      contractKey: item.contractKey,
      rawTicker: item.rawTicker,
      normalizedTicker: item.normalizedTicker,
      entryDate: item.entryDate,
      pairingDate,
      dividends: item.kind === 'dividend' ? [item] : [],
      taxes: item.kind === 'tax' ? [item] : [],
    });
  }

  const parsedFxRate = Number(config.currencyCode === 'MXN' ? '1' : config.fxRateToMxn);
  const previewRows: DividendImportPreviewRow[] = [...groupedItems.values()]
    .map((group) => {
      const issues: DividendImportPreviewIssue[] = [];
      const matchedSecurityIds = securityLookup.get(group.normalizedTicker) ?? [];
      const dividendItem = group.dividends[0] ?? null;
      const taxItem = group.taxes[0] ?? null;
      const displayEntryDate = dividendItem?.entryDate ?? taxItem?.entryDate ?? group.entryDate;
      const displayRawTicker = dividendItem?.rawTicker ?? taxItem?.rawTicker ?? group.rawTicker;

      if (group.dividends.length === 0) {
        issues.push({ code: 'missing-dividend', message: 'Se encontró una retención sin dividendo.' });
      }

      if (group.dividends.length > 1) {
        issues.push({ code: 'multiple-dividends', message: 'Hay más de un dividendo para el mismo ticker y fecha.' });
      }

      if (group.taxes.length > 1) {
        issues.push({ code: 'multiple-taxes', message: 'Hay más de una retención para el mismo ticker y fecha.' });
      }

      if (matchedSecurityIds.length !== 1) {
        issues.push({ code: 'ticker-unresolved', message: 'El ticker no se pudo resolver de forma única.' });
      }

      const grossAmountOriginal = dividendItem ? dividendItem.amount : 0;
      const taxWithheldOriginal = taxItem ? taxItem.amount : 0;
      const netAmountOriginal = grossAmountOriginal - taxWithheldOriginal;

      if (!Number.isFinite(netAmountOriginal) || netAmountOriginal < 0) {
        issues.push({ code: 'invalid-net', message: 'El neto calculado no es válido.' });
      }

      const status: DividendImportPreviewStatus = issues.length > 0
        ? issues.some((issue) => ['missing-dividend', 'multiple-dividends', 'multiple-taxes'].includes(issue.code))
          ? 'ambiguous-group'
          : issues.some((issue) => issue.code === 'ticker-unresolved')
            ? 'ticker-unresolved'
            : 'invalid'
        : 'ready';

      return {
        id: createPreviewRowId('dividend-import'),
        selected: status === 'ready',
        status,
        issues,
        entryDate: displayEntryDate,
        rawTicker: displayRawTicker,
        normalizedTicker: group.normalizedTicker,
        dividendDescription: dividendItem?.description ?? '',
        matchedSecurityId: matchedSecurityIds[0] ?? '',
        brokerId: config.brokerId,
        currencyCode: config.currencyCode,
        fxRateToMxn: formatEditableNumber(config.currencyCode === 'MXN' ? 1 : parsedFxRate),
        grossAmountOriginal: formatEditableNumber(grossAmountOriginal),
        taxWithheldOriginal: formatEditableNumber(taxWithheldOriginal),
        netAmountOriginal: formatEditableNumber(netAmountOriginal),
        netAmountMxn: Number.isFinite(parsedFxRate) && parsedFxRate > 0 ? formatEditableNumber(Number((netAmountOriginal * parsedFxRate).toFixed(6))) : '',
        sourceDividendTransactionId: dividendItem?.sourceTransactionId ?? '',
        sourceTaxTransactionId: taxItem?.sourceTransactionId ?? '',
      };
    })
    .sort((left, right) => right.entryDate.localeCompare(left.entryDate) || left.normalizedTicker.localeCompare(right.normalizedTicker));

  return {
    previewRows,
    ignoredCount,
  } satisfies DividendImportParseResult;
}

export function getDividendImportStatusLabel(status: DividendImportPreviewStatus) {
  if (status === 'ready') return 'Listo';
  if (status === 'duplicate') return 'Duplicado';
  if (status === 'ticker-unresolved') return 'Ticker';
  if (status === 'ambiguous-group') return 'Ambiguo';
  if (status === 'invalid') return 'Inválido';
  if (status === 'saving') return 'Guardando';
  if (status === 'saved') return 'Guardado';
  if (status === 'save-error') return 'Error';
  return 'Revisar';
}

export function canSelectDividendImportRow(row: Pick<DividendImportPreviewRow, 'status' | 'matchedSecurityId'>) {
  return (row.status === 'ready' || row.status === 'save-error') && Boolean(row.matchedSecurityId);
}

export function normalizeDividendImportPreviewRow(row: DividendImportPreviewRow) {
  const grossAmountOriginal = Number(row.grossAmountOriginal);
  const taxWithheldOriginal = Number(row.taxWithheldOriginal || '0');
  const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  const netAmountOriginal = grossAmountOriginal - taxWithheldOriginal;
  const issues = row.issues.filter((issue) => !['invalid-net', 'ticker-unresolved', 'missing-broker', 'invalid-fx', 'save-error'].includes(issue.code));

  if (!row.brokerId) {
    issues.push({ code: 'missing-broker', message: 'Selecciona un broker para guardar.' });
  }

  if (!row.matchedSecurityId) {
    issues.push({ code: 'ticker-unresolved', message: 'Selecciona un ticker válido.' });
  }

  if (!Number.isFinite(fxRateToMxn) || fxRateToMxn <= 0) {
    issues.push({ code: 'invalid-fx', message: 'El tipo de cambio debe ser mayor a cero.' });
  }

  if (!Number.isFinite(netAmountOriginal) || netAmountOriginal < 0) {
    issues.push({ code: 'invalid-net', message: 'El neto debe ser mayor o igual a cero.' });
  }

  const nextStatus: DividendImportPreviewStatus = issues.length > 0
    ? issues.some((issue) => ['missing-dividend', 'multiple-dividends', 'multiple-taxes'].includes(issue.code))
      ? 'ambiguous-group'
      : issues.some((issue) => issue.code === 'ticker-unresolved')
        ? 'ticker-unresolved'
        : 'invalid'
    : row.status === 'duplicate' || row.status === 'saved' || row.status === 'saving' || row.status === 'save-error'
      ? row.status
      : 'ready';

  return {
    ...row,
    selected: canSelectDividendImportRow({ status: nextStatus, matchedSecurityId: row.matchedSecurityId }) ? row.selected : false,
    status: nextStatus,
    issues,
    taxWithheldOriginal: row.taxWithheldOriginal.trim() ? row.taxWithheldOriginal : '0',
    netAmountOriginal: Number.isFinite(netAmountOriginal) ? formatEditableNumber(Number(netAmountOriginal.toFixed(6))) : '',
    netAmountMxn: Number.isFinite(netAmountOriginal) && Number.isFinite(fxRateToMxn) && fxRateToMxn > 0
      ? formatEditableNumber(Number((netAmountOriginal * fxRateToMxn).toFixed(6)))
      : '',
  } satisfies DividendImportPreviewRow;
}

export function markDividendImportDuplicates(
  rows: DividendImportPreviewRow[],
  duplicateSourceDividendIds: Set<string>,
  duplicateSourceTaxIds: Set<string>,
) {
  return rows.map((row) => {
    if (row.status === 'saved') {
      return row;
    }

    const isDuplicate =
      (row.sourceDividendTransactionId && duplicateSourceDividendIds.has(row.sourceDividendTransactionId)) ||
      (row.sourceTaxTransactionId && duplicateSourceTaxIds.has(row.sourceTaxTransactionId));

    if (!isDuplicate) {
      return row;
    }

    const issues = [
      ...row.issues.filter((issue) => issue.code !== 'duplicate-source-id'),
      { code: 'duplicate-source-id' as const, message: 'El movimiento origen ya fue importado.' },
    ];

    return {
      ...row,
      selected: false,
      status: 'duplicate' as const,
      issues,
    };
  });
}
