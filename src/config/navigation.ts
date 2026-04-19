import { type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faBriefcase,
  faCamera,
  faChartPie,
  faChartSimple,
  faCreditCard,
  faFolderOpen,
  faHandHoldingDollar,
  faMoneyBillTrendUp,
  faPiggyBank,
  faReceipt,
} from '@fortawesome/free-solid-svg-icons';
import { catalogTabs } from './catalogs';

export type NavigationItem = {
  label: string;
  to: string;
  icon: IconDefinition;
  matchPaths?: readonly string[];
  tabs?: readonly NavigationTab[];
};

export type NavigationTab = {
  label: string;
  to: string;
  icon: IconDefinition;
  end?: boolean;
};

export type DashboardTabKey = 'income' | 'expense' | 'investment' | 'security';

export const dashboardTabs: readonly NavigationTab[] = [
  { label: 'Ingresos', to: '/dashboard', icon: faArrowTrendUp, end: true },
  { label: 'Egresos', to: '/dashboard/expenses', icon: faArrowTrendDown },
  { label: 'Inversión', to: '/dashboard/investments', icon: faPiggyBank },
  { label: 'Valores', to: '/dashboard/securities', icon: faBriefcase },
];

export const spendingTabs: readonly NavigationTab[] = [
  { label: 'Egresos', to: '/spending', icon: faArrowTrendDown, end: true },
  { label: 'Tickets', to: '/spending/tickets', icon: faReceipt },
  { label: 'Escaneo', to: '/spending/scan', icon: faCamera },
  { label: 'Tarjetas', to: '/spending/credit-cards', icon: faCreditCard },
];

export const investmentTabs: readonly NavigationTab[] = [
  { label: 'Inversión', to: '/investments', icon: faPiggyBank, end: true },
  { label: 'Compras', to: '/investments/buys', icon: faBriefcase },
  { label: 'Ventas', to: '/investments/sells', icon: faMoneyBillTrendUp },
  { label: 'Posiciones', to: '/investments/holdings', icon: faChartPie },
  { label: 'Dividendos', to: '/investments/dividends', icon: faHandHoldingDollar },
];

export const sidebarNavigationItems: readonly NavigationItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: faChartSimple, tabs: dashboardTabs },
  { label: 'Ingresos', to: '/income', icon: faArrowTrendUp },
  {
    label: 'Gastos',
    to: '/spending',
    icon: faArrowTrendDown,
    matchPaths: ['/spending', '/expenses', '/credit-cards', '/tickets'],
    tabs: spendingTabs,
  },
  {
    label: 'Inversiones',
    to: '/investments',
    icon: faPiggyBank,
    matchPaths: ['/investments', '/stocks', '/dividends'],
    tabs: investmentTabs,
  },
  { label: 'Catálogos', to: '/catalogs', icon: faFolderOpen, tabs: catalogTabs },
];

function pathnameMatches(basePath: string, pathname: string) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function getNavigationItemForPathname(pathname: string) {
  return (
    sidebarNavigationItems.find((item) => {
      const matchPaths = item.matchPaths ?? [item.to];

      return matchPaths.some((matchPath) => pathnameMatches(matchPath, pathname));
    }) ?? null
  );
}
