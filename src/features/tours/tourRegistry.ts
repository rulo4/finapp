import { type DriveStep } from 'driver.js';
import { type PageTourKey } from './tourStorage';

type PageTourDefinition = {
  version: string;
  buildSteps: () => DriveStep[];
};

type CatalogSummaryItem = {
  key: string;
  label: string;
  description: string;
  minimumValues: string[];
};

const catalogSummaryItems: readonly CatalogSummaryItem[] = [
  {
    key: 'expense_categories',
    label: 'Categorías de gasto',
    description: 'Clasifica egresos para capturar más rápido y entender mejor a dónde se va el dinero.',
    minimumValues: ['Comida', 'Transporte', 'Servicios', 'Salud'],
  },
  {
    key: 'income_sources',
    label: 'Fuentes de ingreso',
    description: 'Agrupa de dónde proviene cada ingreso.',
    minimumValues: ['Salario', 'Honorarios', 'Renta'],
  },
  {
    key: 'payment_instruments',
    label: 'Instrumentos de pago',
    description: 'Define cómo pagas tus egresos.',
    minimumValues: ['Efectivo', 'Débito BBVA', 'Crédito HSBC'],
  },
  {
    key: 'stores',
    label: 'Tiendas',
    description: 'Comercios y puntos de compra recurrentes.',
    minimumValues: ['Amazon', 'Mercadolibre', 'Walmart', 'Local'],
  },
  {
    key: 'unit_of_measures',
    label: 'Unidades de medida',
    description: 'Estandariza cantidades.',
    minimumValues: ['pieza', 'kg', 'litro', 'servicio'],
  },
  {
    key: 'brokers',
    label: 'Brokers',
    description: 'Casas de bolsa para compras y ventas.',
    minimumValues: ['GBM', 'Actinver Trade'],
  },
  {
    key: 'investment_entities',
    label: 'Entidades de inversión',
    description: 'Instituciones que te pagan intereses por tu dinero.',
    minimumValues: ['Cetes', 'Nu', 'Mercadopago', 'Openbank'],
  },
  {
    key: 'securities',
    label: 'Valores bursátiles',
    description: 'Catálogo maestro de valores (acciones, ETFs, Fibras) para compras, ventas y dividendos.',
    minimumValues: ['MSFT', 'VOO', 'FUNO'],
  },
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCatalogMinimumsHtml(catalog: CatalogSummaryItem) {
  const currentMinimums = catalog.minimumValues;

  return [
    '<div class="tour-popover__stack">',
    `<p>${escapeHtml(catalog.description)}</p>`,
    `<p><strong>Ejemplos:</strong> ${escapeHtml(currentMinimums.join(', '))}.</p>`,
    '</div>',
  ].join('');
}

const pageTours: Record<PageTourKey, PageTourDefinition> = {
  catalogs: {
    version: 'v3',
    buildSteps: () => {
      const catalogTabSteps: DriveStep[] = catalogSummaryItems.map((catalog) => ({
        element: `[data-tour="catalog-tab-${catalog.key}"]`,
        popover: {
          title: catalog.label,
          description: buildCatalogMinimumsHtml(catalog),
          side: 'bottom',
          align: 'start',
        },
      }));

      return [
        {
          element: '[data-tour="catalogs-page"]',
          popover: {
            title: 'Catálogos',
            description:
              'Aquí se definen listas reutilizables para ingresos, egresos e inversiones. Cada pestaña representa un catálogo distinto.',
            side: 'bottom',
            align: 'start',
          },
        },
        ...catalogTabSteps,
        {
          element: '[data-tour="catalogs-grid"]',
          popover: {
            title: 'Captura y mantenimiento',
            description:
              'La primera fila sirve para alta rápida. Las demás filas se editan en línea y cada registro se guarda por separado.',
            side: 'top',
            align: 'center',
          },
        },
      ];
    },
  },
};

export function getPageTourKey(pathname: string): PageTourKey | null {
  if (pathname.startsWith('/catalogs')) {
    return 'catalogs';
  }

  return null;
}

export function hasTourForPathname(pathname: string) {
  return getPageTourKey(pathname) != null;
}

export function getPageTourDefinition(pageKey: PageTourKey) {
  return pageTours[pageKey];
}
