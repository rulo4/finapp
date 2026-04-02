import { addDays, addMonths } from 'date-fns';
import { formatLocalDateAsIsoString, getTodayIsoDate, parseIsoDateString } from '../shared/isoDate';

export type CreditCardExpense = {
  id: string;
  entryDate: string;
  concept: string;
  totalAmountMxn: number;
};

export type CreditCardPayment = {
  id: string;
  paymentDate: string;
  amountMxn: number;
  bonusStatementCreditMxn: number;
  bonusRewardPoints: number;
  notes: string;
};

export type CreditCardStatementReconciliation = {
  id: string;
  statementDate: string;
  adjustedClosingBalanceMxn: number;
  adjustmentNote: string;
};

export type StatementActivityItem = {
  id: string;
  date: string;
  kind: 'expense' | 'payment' | 'bonus' | 'points';
  label: string;
  amountMxn: number;
  points: number;
};

export type CreditCardStatementPeriod = {
  id: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  status: 'open' | 'closed';
  openingBalanceMxn: number;
  spendMxn: number;
  paymentMxn: number;
  bonusStatementCreditMxn: number;
  bonusRewardPoints: number;
  calculatedClosingBalanceMxn: number;
  closingBalanceMxn: number;
  isReconciled: boolean;
  reconciliationId: string | null;
  adjustmentNote: string;
  activity: StatementActivityItem[];
};

export type CreditCardComputation = {
  periods: CreditCardStatementPeriod[];
  currentPeriod: CreditCardStatementPeriod | null;
  lastClosedPeriod: CreditCardStatementPeriod | null;
  recentClosedPeriods: CreditCardStatementPeriod[];
  currentActivity: StatementActivityItem[];
  allTimeRewardPoints: number;
  nextStatementDate: string;
  nextDueDate: string;
};

function getMonthStatementDate(year: number, monthIndex: number, statementDay: number) {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(statementDay, lastDayOfMonth));
}

function getStatementDateOnOrBefore(referenceDate: Date, statementDay: number) {
  const currentMonthDate = getMonthStatementDate(referenceDate.getFullYear(), referenceDate.getMonth(), statementDay);

  if (currentMonthDate.getTime() <= referenceDate.getTime()) {
    return currentMonthDate;
  }

  const previousMonthReference = addMonths(referenceDate, -1);
  return getMonthStatementDate(previousMonthReference.getFullYear(), previousMonthReference.getMonth(), statementDay);
}

function getStatementDateAfter(referenceDate: Date, statementDay: number) {
  const onOrBefore = getStatementDateOnOrBefore(referenceDate, statementDay);
  const nextMonthReference = addMonths(onOrBefore, 1);

  return getMonthStatementDate(nextMonthReference.getFullYear(), nextMonthReference.getMonth(), statementDay);
}

function shiftStatementDate(statementDate: Date, statementDay: number, monthDelta: number) {
  const shiftedReference = addMonths(statementDate, monthDelta);
  return getMonthStatementDate(shiftedReference.getFullYear(), shiftedReference.getMonth(), statementDay);
}

function normalizeAmount(value: number) {
  return Number(value.toFixed(6));
}

function buildActivity(expenses: CreditCardExpense[], payments: CreditCardPayment[]) {
  const activity: StatementActivityItem[] = [];

  for (const expense of expenses) {
    if (!Number.isFinite(expense.totalAmountMxn) || expense.totalAmountMxn === 0) {
      continue;
    }

    activity.push({
      id: `expense-${expense.id}`,
      date: expense.entryDate,
      kind: 'expense',
      label: expense.concept || 'Compra',
      amountMxn: normalizeAmount(expense.totalAmountMxn),
      points: 0,
    });
  }

  for (const payment of payments) {
    if (payment.amountMxn > 0) {
      activity.push({
        id: `payment-${payment.id}`,
        date: payment.paymentDate,
        kind: 'payment',
        label: payment.notes.trim() || 'Abono',
        amountMxn: normalizeAmount(-payment.amountMxn),
        points: 0,
      });
    }

    if (payment.bonusStatementCreditMxn > 0) {
      activity.push({
        id: `bonus-${payment.id}`,
        date: payment.paymentDate,
        kind: 'bonus',
        label: payment.notes.trim() || 'Bonif.',
        amountMxn: normalizeAmount(-payment.bonusStatementCreditMxn),
        points: 0,
      });
    }

    if (payment.bonusRewardPoints > 0) {
      activity.push({
        id: `points-${payment.id}`,
        date: payment.paymentDate,
        kind: 'points',
        label: payment.notes.trim() || 'Puntos',
        amountMxn: 0,
        points: normalizeAmount(payment.bonusRewardPoints),
      });
    }
  }

  return activity.sort((left, right) => {
    if (left.date === right.date) {
      return left.id.localeCompare(right.id);
    }

    return left.date.localeCompare(right.date);
  });
}

export function computeCreditCardPeriods({
  statementDay,
  graceDays,
  expenses,
  payments,
  reconciliations,
  today = getTodayIsoDate(),
}: {
  statementDay: number;
  graceDays: number;
  expenses: CreditCardExpense[];
  payments: CreditCardPayment[];
  reconciliations: CreditCardStatementReconciliation[];
  today?: string;
}): CreditCardComputation {
  const todayDate = parseIsoDateString(today) ?? new Date();
  const activity = buildActivity(expenses, payments);
  const earliestKnownDate = [
    ...expenses.map((expense) => expense.entryDate),
    ...payments.map((payment) => payment.paymentDate),
    ...reconciliations.map((reconciliation) => reconciliation.statementDate),
    today,
  ]
    .filter(Boolean)
    .sort()[0] ?? today;
  const earliestDate = parseIsoDateString(earliestKnownDate) ?? todayDate;
  const firstBoundary = getStatementDateOnOrBefore(earliestDate, statementDay);
  const nextBoundary = getStatementDateAfter(todayDate, statementDay);
  const boundaries: Date[] = [firstBoundary];

  while (boundaries[boundaries.length - 1].getTime() < nextBoundary.getTime()) {
    boundaries.push(shiftStatementDate(boundaries[boundaries.length - 1], statementDay, 1));
  }

  const reconciliationByDate = new Map(
    reconciliations.map((reconciliation) => [reconciliation.statementDate, reconciliation]),
  );

  let openingBalanceMxn = 0;
  const periods: CreditCardStatementPeriod[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startDate = formatLocalDateAsIsoString(boundaries[index]);
    const endDate = formatLocalDateAsIsoString(boundaries[index + 1]);
    const periodActivity = activity.filter((item) => item.date >= startDate && item.date < endDate);
    const spendMxn = normalizeAmount(
      periodActivity.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountMxn, 0),
    );
    const paymentMxn = normalizeAmount(
      periodActivity.filter((item) => item.kind === 'payment').reduce((sum, item) => sum + Math.abs(item.amountMxn), 0),
    );
    const bonusStatementCreditMxn = normalizeAmount(
      periodActivity.filter((item) => item.kind === 'bonus').reduce((sum, item) => sum + Math.abs(item.amountMxn), 0),
    );
    const bonusRewardPoints = normalizeAmount(
      periodActivity.filter((item) => item.kind === 'points').reduce((sum, item) => sum + item.points, 0),
    );
    const calculatedClosingBalanceMxn = normalizeAmount(openingBalanceMxn + spendMxn - paymentMxn - bonusStatementCreditMxn);
    const reconciliation = reconciliationByDate.get(endDate) ?? null;
    const closingBalanceMxn = reconciliation ? reconciliation.adjustedClosingBalanceMxn : calculatedClosingBalanceMxn;
    const dueDate = formatLocalDateAsIsoString(addDays(boundaries[index + 1], graceDays));
    const status = endDate <= today ? 'closed' : 'open';

    periods.push({
      id: `${startDate}:${endDate}`,
      startDate,
      endDate,
      dueDate,
      status,
      openingBalanceMxn: normalizeAmount(openingBalanceMxn),
      spendMxn,
      paymentMxn,
      bonusStatementCreditMxn,
      bonusRewardPoints,
      calculatedClosingBalanceMxn,
      closingBalanceMxn: normalizeAmount(closingBalanceMxn),
      isReconciled: Boolean(reconciliation),
      reconciliationId: reconciliation?.id ?? null,
      adjustmentNote: reconciliation?.adjustmentNote ?? '',
      activity: [...periodActivity].sort((left, right) => {
        if (left.date === right.date) {
          return right.id.localeCompare(left.id);
        }

        return right.date.localeCompare(left.date);
      }),
    });

    openingBalanceMxn = normalizeAmount(closingBalanceMxn);
  }

  const currentPeriod = periods.find((period) => period.status === 'open') ?? null;
  const lastClosedPeriod = [...periods].reverse().find((period) => period.status === 'closed') ?? null;
  const recentClosedPeriods = periods.filter((period) => period.status === 'closed').slice(-8).reverse();

  return {
    periods,
    currentPeriod,
    lastClosedPeriod,
    recentClosedPeriods,
    currentActivity: currentPeriod?.activity ?? [],
    allTimeRewardPoints: normalizeAmount(payments.reduce((sum, payment) => sum + payment.bonusRewardPoints, 0)),
    nextStatementDate: currentPeriod?.endDate ?? formatLocalDateAsIsoString(nextBoundary),
    nextDueDate: currentPeriod?.dueDate ?? formatLocalDateAsIsoString(addDays(nextBoundary, graceDays)),
  };
}