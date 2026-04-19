import { type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowTrendUp,
  faBriefcase,
  faBuildingColumns,
  faCreditCard,
  faPiggyBank,
  faScaleBalanced,
  faStore,
  faTags,
} from '@fortawesome/free-solid-svg-icons';

export type CatalogKind = 'basic' | 'payment_instruments' | 'securities' | 'brokers';

export type CatalogConfig = {
  key: string;
  label: string;
  description: string;
  kind: CatalogKind;
  icon: IconDefinition;
};

export const catalogConfigs: readonly CatalogConfig[] = [
  {
    key: 'expense_categories',
    label: 'Categorías de gasto',
    description: 'Clasifica tus egresos para entender mejor a dónde va tu dinero y agilizar la captura.',
    kind: 'basic',
    icon: faTags,
  },
  {
    key: 'income_sources',
    label: 'Fuentes de ingreso',
    description: 'Define de dónde provienen tus ingresos.',
    kind: 'basic',
    icon: faArrowTrendUp,
  },
  {
    key: 'payment_instruments',
    label: 'Instrumentos de pago',
    description: 'Administra efectivo, débito y crédito para tus egresos.',
    kind: 'payment_instruments',
    icon: faCreditCard,
  },
  {
    key: 'stores',
    label: 'Tiendas',
    description: 'Catálogo de comercios asociados a tus consumos y compras.',
    kind: 'basic',
    icon: faStore,
  },
  {
    key: 'unit_of_measures',
    label: 'Unidades de medida',
    description: 'Unidades para capturar tus egresos sin texto libre.',
    kind: 'basic',
    icon: faScaleBalanced,
  },
  {
    key: 'brokers',
    label: 'Brokers',
    description: 'Intermediarios para tus operaciones de inversión.',
    kind: 'brokers',
    icon: faBuildingColumns,
  },
  {
    key: 'investment_entities',
    label: 'Entidades de inversión',
    description: 'Vehículos no bursátiles usados en tus inversiones.',
    kind: 'basic',
    icon: faPiggyBank,
  },
  {
    key: 'securities',
    label: 'Valores bursátiles',
    description: 'Catálogo maestro para tus compras, ventas y dividendos.',
    kind: 'securities',
    icon: faBriefcase,
  },
];

export const defaultCatalog = catalogConfigs[0];

export function getCatalogPath(catalogKey: string) {
  return catalogKey === defaultCatalog.key ? '/catalogs' : `/catalogs/${catalogKey}`;
}

export function getCatalogConfig(catalogKey?: string | null) {
  return catalogConfigs.find((catalog) => catalog.key === catalogKey) ?? null;
}

export const catalogTabs = catalogConfigs.map((catalog) => ({
  label: catalog.label,
  to: getCatalogPath(catalog.key),
  icon: catalog.icon,
  end: catalog.key === defaultCatalog.key,
}));