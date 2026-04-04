import { type DriveStep } from 'driver.js';
import { type PageTourKey } from './tourStorage';

type PageTourDefinition = {
  version: string;
  buildSteps: () => DriveStep[];
};

type CatalogSummaryItem = {
  key: string;
  label: string;
  minimumValues: string[];
};

const catalogSummaryItems: readonly CatalogSummaryItem[] = [
  { key: 'expense_categories', label: 'Categorias de gasto', minimumValues: ['Comida', 'Transporte', 'Servicios', 'Salud'] },
  { key: 'income_sources', label: 'Fuentes de ingreso', minimumValues: ['Salario', 'Honorarios', 'Intereses', 'Dividendos'] },
  { key: 'payment_instruments', label: 'Instrumentos de pago', minimumValues: ['Efectivo', 'Debito principal', 'Credito principal'] },
  { key: 'stores', label: 'Tiendas', minimumValues: ['Supermercado', 'Marketplace', 'Restaurante', 'Farmacia'] },
  { key: 'unit_of_measures', label: 'Unidades de medida', minimumValues: ['pieza', 'kg', 'litro', 'servicio'] },
  { key: 'brokers', label: 'Brokers', minimumValues: ['Broker principal', 'Factor de comision base'] },
  { key: 'investment_entities', label: 'Entidades de inversion', minimumValues: ['Cetes', 'Pagares', 'Prestamos', 'Caja de ahorro'] },
  { key: 'securities', label: 'Valores bursatiles', minimumValues: ['Tickers activos', 'Empresa', 'Tipo', 'Moneda'] },
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCatalogTourContext() {
  const pageElement = document.querySelector('[data-tour="catalogs-page"]');

  if (!(pageElement instanceof HTMLElement)) {
    return {
      key: 'expense_categories',
      label: 'Categorias de gasto',
      description: 'Clasifica egresos recurrentes y operativos.',
    };
  }

  return {
    key: pageElement.dataset.tourCatalogKey ?? 'expense_categories',
    label: pageElement.dataset.tourCatalogLabel ?? 'Categorias de gasto',
    description: pageElement.dataset.tourCatalogDescription ?? 'Clasifica egresos recurrentes y operativos.',
  };
}

function buildCatalogMinimumsHtml() {
  const { key, label, description } = getCatalogTourContext();
  const currentCatalog = catalogSummaryItems.find((catalog) => catalog.key === key);
  const currentMinimums = currentCatalog?.minimumValues ?? ['Nombre claro', 'Solo registros que ya uses'];

  return [
    '<div class="tour-popover__stack">',
    `<p>${escapeHtml(description)}</p>`,
    `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(currentMinimums.join(', '))}.</p>`,
    '<p>Empieza por lo que ya capturas hoy. Completa el resto despues.</p>',
    '</div>',
  ].join('');
}

function buildCatalogSummaryHtml() {
  const items = catalogSummaryItems
    .map(
      (catalog) =>
        `<li><strong>${escapeHtml(catalog.label)}:</strong> ${escapeHtml(catalog.minimumValues.join(', '))}.</li>`,
    )
    .join('');

  return [
    '<div class="tour-popover__stack">',
    '<p>Este es el minimo sugerido para arrancar sin sobrecargar la captura.</p>',
    `<ul class="tour-popover__list">${items}</ul>`,
    '</div>',
  ].join('');
}

const pageTours: Record<PageTourKey, PageTourDefinition> = {
  catalogs: {
    version: 'v1',
    buildSteps: () => [
      {
        element: '[data-tour="catalogs-page"]',
        popover: {
          title: 'Catalogos',
          description:
            'Aqui se definen listas reutilizables para ingresos, egresos e inversion. Mantenerlas limpias reduce captura libre y mejora reportes.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="catalogs-selector"]',
        popover: {
          title: 'Catalogo activo',
          description: buildCatalogMinimumsHtml(),
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="catalogs-grid"]',
        popover: {
          title: 'Captura y mantenimiento',
          description:
            'La primera fila sirve para alta rapida. Las demas filas se editan en linea y cada registro se guarda por separado.',
          side: 'top',
          align: 'center',
        },
      },
      {
        element: '[data-tour="catalogs-page"]',
        popover: {
          title: 'Minimos sugeridos',
          description: buildCatalogSummaryHtml(),
          side: 'over',
          align: 'center',
        },
      },
    ],
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
