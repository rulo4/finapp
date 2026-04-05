import { type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faBriefcase,
  faChartPie,
  faChartSimple,
  faCreditCard,
  faFolderOpen,
  faHandHoldingDollar,
  faMoneyBillTrendUp,
  faPiggyBank,
  faReceipt,
} from '@fortawesome/free-solid-svg-icons';

export type NavigationItem = {
  label: string;
  to: string;
  icon: IconDefinition;
};

export const navigationItems: readonly NavigationItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: faChartSimple },
  { label: 'Ingresos', to: '/income', icon: faArrowTrendUp },
  { label: 'Egresos', to: '/expenses', icon: faArrowTrendDown },
  { label: 'Tarjetas', to: '/credit-cards', icon: faCreditCard },
  { label: 'Inversión', to: '/investments', icon: faPiggyBank },
  { label: 'Compras de acciones', to: '/stocks/buys', icon: faBriefcase },
  { label: 'Ventas de acciones', to: '/stocks/sells', icon: faMoneyBillTrendUp },
  { label: 'Posiciones de acciones', to: '/stocks/holdings', icon: faChartPie },
  { label: 'Dividendos', to: '/dividends', icon: faHandHoldingDollar },
  { label: 'Tickets', to: '/tickets', icon: faReceipt },
  { label: 'Catálogos', to: '/catalogs', icon: faFolderOpen },
];
