import { type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faChartLine,
  faCoins,
  faFolderOpen,
  faHandHoldingDollar,
  faTableList,
  faWallet,
} from '@fortawesome/free-solid-svg-icons';

export type NavigationItem = {
  label: string;
  to: string;
  icon: IconDefinition;
};

export const navigationItems: readonly NavigationItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: faChartLine },
  { label: 'Ingresos', to: '/income', icon: faArrowTrendUp },
  { label: 'Egresos', to: '/expenses', icon: faArrowTrendDown },
  { label: 'Inversión', to: '/investments', icon: faWallet },
  { label: 'Compras de acciones', to: '/stocks/buys', icon: faTableList },
  { label: 'Ventas de acciones', to: '/stocks/sells', icon: faHandHoldingDollar },
  { label: 'Dividendos', to: '/dividends', icon: faCoins },
  { label: 'Catálogos', to: '/catalogs', icon: faFolderOpen },
];
