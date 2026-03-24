type BaseMovement = {
  id: string;
  securityId: string;
  tradeDate: string;
  quantity: number;
  totalAmountMxn: number;
  createdAt: string | null;
};

export type StockBuyMovement = BaseMovement & {
  unitPriceOriginal: number;
};

export type StockSellMovement = BaseMovement & {
  stockBuyId?: string | null;
  sellGroupId?: string | null;
};

export type FifoSellMatch = {
  stockBuyId: string;
  buyTradeDate: string;
  buyUnitPriceOriginal: number;
  quantityAvailableBeforeSell: number;
  quantityToSell: number;
  allocatedFeesOriginal: number;
  saleUnitPriceMxn: number;
  totalAmountMxn: number;
  fifoCostBasisMxn: number;
  fifoRealizedPnlMxn: number;
  fifoRealizedPnlPct: number | null;
};

export type FifoSellPreview = {
  availableQuantity: number;
  remainingFifoCostBasisMxn: number;
  fifoCostBasisMxn: number | null;
  fifoRealizedPnlMxn: number | null;
  fifoRealizedPnlPct: number | null;
  matches: FifoSellMatch[];
  errorMessage: string | null;
};

export type SecurityHoldingMetrics = {
  securityId: string;
  availableQuantity: number;
  remainingUnitCostMxn: number;
  remainingFifoCostBasisMxn: number;
};

type CandidateSell = {
  id: string;
  securityId: string;
  tradeDate: string;
  quantity: number | null;
  unitPriceOriginal: number | null;
  feesOriginal: number | null;
  fxRateToMxn: number | null;
  totalAmountMxn: number | null;
  createdAt: string | null;
};

type OrderedBuyMovement = StockBuyMovement & {
  kind: 'buy';
};

type OrderedSellMovement = StockSellMovement & {
  kind: 'sell';
};

type OrderedMovement = OrderedBuyMovement | OrderedSellMovement;

type FifoLot = {
  buyId: string;
  tradeDate: string;
  unitPriceOriginal: number;
  remainingQuantity: number;
  unitCostMxn: number;
};

type RawLotConsumption = {
  stockBuyId: string;
  buyTradeDate: string;
  buyUnitPriceOriginal: number;
  quantityAvailableBeforeSell: number;
  quantityToSell: number;
  fifoCostBasisMxn: number;
};

type ConsumptionResult = {
  lots: FifoLot[];
  remainingToConsume: number;
  fifoCostBasisMxn: number;
  matches: RawLotConsumption[];
  errorMessage: string | null;
};

type PositionSnapshot = {
  availableQuantity: number;
  remainingFifoCostBasisMxn: number;
  fifoLots: FifoLot[];
  errorMessage: string | null;
};

const EPSILON = 0.0000001;

function round6(value: number) {
  const normalized = Math.abs(value) < EPSILON ? 0 : value;

  return Number(normalized.toFixed(6));
}

function compareMovementOrder(left: OrderedMovement | CandidateSell, right: OrderedMovement | CandidateSell) {
  if (left.tradeDate !== right.tradeDate) {
    return left.tradeDate.localeCompare(right.tradeDate);
  }

  const leftCreatedAt = left.createdAt ?? '9999-12-31T23:59:59.999Z';
  const rightCreatedAt = right.createdAt ?? '9999-12-31T23:59:59.999Z';
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt.localeCompare(rightCreatedAt);
  }

  const leftKind = 'kind' in left ? left.kind : 'sell';
  const rightKind = 'kind' in right ? right.kind : 'sell';
  if (leftKind !== rightKind) {
    return leftKind === 'buy' ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

function cloneLots(lots: FifoLot[]) {
  return lots.map((lot) => ({ ...lot }));
}

function summarizeLots(lots: FifoLot[]) {
  return {
    availableQuantity: round6(lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0)),
    remainingFifoCostBasisMxn: round6(lots.reduce((sum, lot) => sum + lot.remainingQuantity * lot.unitCostMxn, 0)),
  };
}

function consumeSpecificLot(lots: FifoLot[], stockBuyId: string, quantityToConsume: number): ConsumptionResult {
  const nextLots = cloneLots(lots);
  const targetLot = nextLots.find((lot) => lot.buyId === stockBuyId);

  if (!targetLot) {
    return {
      lots,
      remainingToConsume: quantityToConsume,
      fifoCostBasisMxn: 0,
      matches: [],
      errorMessage: 'No fue posible localizar la compra origen de una venta registrada.',
    };
  }

  if (quantityToConsume > targetLot.remainingQuantity + EPSILON) {
    return {
      lots,
      remainingToConsume: quantityToConsume,
      fifoCostBasisMxn: 0,
      matches: [],
      errorMessage: 'El historial contiene una venta que excede los títulos disponibles en su compra origen.',
    };
  }

  const quantityBeforeSell = round6(targetLot.remainingQuantity);
  targetLot.remainingQuantity = round6(targetLot.remainingQuantity - quantityToConsume);
  const fifoCostBasisMxn = round6(quantityToConsume * targetLot.unitCostMxn);

  return {
    lots: nextLots.filter((lot) => lot.remainingQuantity > EPSILON),
    remainingToConsume: 0,
    fifoCostBasisMxn,
    matches: [
      {
        stockBuyId: targetLot.buyId,
        buyTradeDate: targetLot.tradeDate,
        buyUnitPriceOriginal: targetLot.unitPriceOriginal,
        quantityAvailableBeforeSell: quantityBeforeSell,
        quantityToSell: round6(quantityToConsume),
        fifoCostBasisMxn,
      },
    ],
    errorMessage: null,
  };
}

function consumeFifoLots(lots: FifoLot[], quantityToConsume: number): ConsumptionResult {
  const nextLots = cloneLots(lots);
  let remainingToConsume = quantityToConsume;
  let fifoCostBasisMxn = 0;
  const matches: RawLotConsumption[] = [];

  for (const lot of nextLots) {
    if (remainingToConsume <= EPSILON) {
      break;
    }

    const quantityFromLot = Math.min(lot.remainingQuantity, remainingToConsume);
    if (quantityFromLot <= EPSILON) {
      continue;
    }

    const quantityBeforeSell = round6(lot.remainingQuantity);
    const lotCostBasisMxn = round6(quantityFromLot * lot.unitCostMxn);
    fifoCostBasisMxn = round6(fifoCostBasisMxn + lotCostBasisMxn);
    lot.remainingQuantity = round6(lot.remainingQuantity - quantityFromLot);
    remainingToConsume = round6(remainingToConsume - quantityFromLot);

    matches.push({
      stockBuyId: lot.buyId,
      buyTradeDate: lot.tradeDate,
      buyUnitPriceOriginal: lot.unitPriceOriginal,
      quantityAvailableBeforeSell: quantityBeforeSell,
      quantityToSell: round6(quantityFromLot),
      fifoCostBasisMxn: lotCostBasisMxn,
    });
  }

  return {
    lots: nextLots.filter((lot) => lot.remainingQuantity > EPSILON),
    remainingToConsume,
    fifoCostBasisMxn,
    matches,
    errorMessage: remainingToConsume > EPSILON ? 'No fue posible consumir los lotes FIFO para la venta.' : null,
  };
}

function buildPositionSnapshot(
  buys: StockBuyMovement[],
  sells: StockSellMovement[],
  securityId: string,
  targetSell: CandidateSell,
) {
  const orderedMovements: OrderedMovement[] = [
    ...buys.filter((buy) => buy.securityId === securityId).map((buy) => ({ ...buy, kind: 'buy' as const })),
    ...sells
      .filter((sell) => sell.securityId === securityId && sell.id !== targetSell.id)
      .map((sell) => ({ ...sell, kind: 'sell' as const })),
  ].sort(compareMovementOrder);

  let fifoLots: FifoLot[] = [];

  for (const movement of orderedMovements) {
    if (compareMovementOrder(movement, targetSell) >= 0) {
      break;
    }

    if (movement.kind === 'buy') {
      const unitCostMxn = movement.quantity > EPSILON ? movement.totalAmountMxn / movement.quantity : 0;
      fifoLots = [
        ...fifoLots,
        {
          buyId: movement.id,
          tradeDate: movement.tradeDate,
          unitPriceOriginal: movement.unitPriceOriginal,
          remainingQuantity: round6(movement.quantity),
          unitCostMxn: round6(unitCostMxn),
        },
      ];
      continue;
    }

    const consumption = movement.stockBuyId
      ? consumeSpecificLot(fifoLots, movement.stockBuyId, movement.quantity)
      : consumeFifoLots(fifoLots, movement.quantity);

    if (consumption.errorMessage || consumption.remainingToConsume > EPSILON) {
      const summary = summarizeLots(fifoLots);
      return {
        availableQuantity: summary.availableQuantity,
        remainingFifoCostBasisMxn: summary.remainingFifoCostBasisMxn,
        fifoLots,
        errorMessage: consumption.errorMessage ?? 'El historial contiene una venta que excede la cantidad disponible para este valor.',
      } satisfies PositionSnapshot;
    }

    fifoLots = consumption.lots;
  }

  const summary = summarizeLots(fifoLots);
  return {
    availableQuantity: summary.availableQuantity,
    remainingFifoCostBasisMxn: summary.remainingFifoCostBasisMxn,
    fifoLots,
    errorMessage: null,
  } satisfies PositionSnapshot;
}

export function previewFifoSell(buys: StockBuyMovement[], sells: StockSellMovement[], candidateSell: CandidateSell): FifoSellPreview | null {
  if (!candidateSell.securityId || !candidateSell.tradeDate) {
    return null;
  }

  const snapshot = buildPositionSnapshot(buys, sells, candidateSell.securityId, candidateSell);
  if (snapshot.errorMessage) {
    return {
      availableQuantity: snapshot.availableQuantity,
      remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
      fifoCostBasisMxn: null,
      fifoRealizedPnlMxn: null,
      fifoRealizedPnlPct: null,
      matches: [],
      errorMessage: snapshot.errorMessage,
    };
  }

  if (
    candidateSell.quantity == null ||
    candidateSell.quantity <= EPSILON ||
    candidateSell.unitPriceOriginal == null ||
    candidateSell.feesOriginal == null ||
    candidateSell.fxRateToMxn == null ||
    candidateSell.totalAmountMxn == null
  ) {
    return {
      availableQuantity: snapshot.availableQuantity,
      remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
      fifoCostBasisMxn: null,
      fifoRealizedPnlMxn: null,
      fifoRealizedPnlPct: null,
      matches: [],
      errorMessage: null,
    };
  }

  if (candidateSell.quantity > snapshot.availableQuantity + EPSILON) {
    return {
      availableQuantity: snapshot.availableQuantity,
      remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
      fifoCostBasisMxn: null,
      fifoRealizedPnlMxn: null,
      fifoRealizedPnlPct: null,
      matches: [],
      errorMessage: 'La venta excede la cantidad disponible para este valor.',
    };
  }

  const consumption = consumeFifoLots(snapshot.fifoLots, candidateSell.quantity);
  if (consumption.errorMessage || consumption.remainingToConsume > EPSILON) {
    return {
      availableQuantity: snapshot.availableQuantity,
      remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
      fifoCostBasisMxn: null,
      fifoRealizedPnlMxn: null,
      fifoRealizedPnlPct: null,
      matches: [],
      errorMessage: consumption.errorMessage ?? 'No fue posible consumir los lotes FIFO para la venta.',
    };
  }

  const sellQuantity = candidateSell.quantity;
  const sellFeesOriginal = candidateSell.feesOriginal;
  const sellUnitPriceOriginal = candidateSell.unitPriceOriginal;
  const sellFxRateToMxn = candidateSell.fxRateToMxn;
  let allocatedFees = 0;
  const saleUnitPriceMxn = round6(sellUnitPriceOriginal * sellFxRateToMxn);
  let runningAvailableQuantity = snapshot.availableQuantity;
  const matches = consumption.matches.map((match, index) => {
    const isLastMatch = index === consumption.matches.length - 1;
    const allocatedFeesOriginal = isLastMatch
      ? round6(sellFeesOriginal - allocatedFees)
      : round6((sellFeesOriginal * match.quantityToSell) / sellQuantity);
    allocatedFees = round6(allocatedFees + allocatedFeesOriginal);

    const totalAmountMxn = round6((match.quantityToSell * sellUnitPriceOriginal - allocatedFeesOriginal) * sellFxRateToMxn);
    const fifoRealizedPnlMxn = round6(totalAmountMxn - match.fifoCostBasisMxn);
    const quantityAvailableBeforeSell = runningAvailableQuantity;
    runningAvailableQuantity = round6(runningAvailableQuantity - match.quantityToSell);

    return {
      ...match,
      quantityAvailableBeforeSell,
      allocatedFeesOriginal,
      saleUnitPriceMxn,
      totalAmountMxn,
      fifoRealizedPnlMxn,
      fifoRealizedPnlPct: match.fifoCostBasisMxn > EPSILON ? round6(fifoRealizedPnlMxn / match.fifoCostBasisMxn) : null,
    } satisfies FifoSellMatch;
  });

  const fifoCostBasisMxn = round6(matches.reduce((sum, match) => sum + match.fifoCostBasisMxn, 0));
  const fifoRealizedPnlMxn = round6(matches.reduce((sum, match) => sum + match.fifoRealizedPnlMxn, 0));

  return {
    availableQuantity: snapshot.availableQuantity,
    remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
    fifoCostBasisMxn,
    fifoRealizedPnlMxn,
    fifoRealizedPnlPct: fifoCostBasisMxn > EPSILON ? round6(fifoRealizedPnlMxn / fifoCostBasisMxn) : null,
    matches,
    errorMessage: null,
  };
}

export function summarizeOpenHoldings(buys: StockBuyMovement[], sells: StockSellMovement[]) {
  const securityIds = new Set<string>([...buys.map((buy) => buy.securityId), ...sells.map((sell) => sell.securityId)]);
  const holdings: SecurityHoldingMetrics[] = [];

  for (const securityId of securityIds) {
    const terminalSell: CandidateSell = {
      id: `terminal-${securityId}`,
      securityId,
      tradeDate: '9999-12-31',
      quantity: null,
      unitPriceOriginal: null,
      feesOriginal: null,
      fxRateToMxn: null,
      totalAmountMxn: null,
      createdAt: '9999-12-31T23:59:59.999Z',
    };
    const snapshot = buildPositionSnapshot(buys, sells, securityId, terminalSell);
    if (snapshot.availableQuantity <= EPSILON) {
      continue;
    }

    holdings.push({
      securityId,
      availableQuantity: snapshot.availableQuantity,
      remainingUnitCostMxn:
        snapshot.availableQuantity > EPSILON ? round6(snapshot.remainingFifoCostBasisMxn / snapshot.availableQuantity) : 0,
      remainingFifoCostBasisMxn: snapshot.remainingFifoCostBasisMxn,
    });
  }

  return holdings.sort((left, right) => left.securityId.localeCompare(right.securityId));
}