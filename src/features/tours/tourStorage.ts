export type PageTourKey = 'catalogs';

const TOUR_STORAGE_PREFIX = 'auna.tour.';

function getTourStorageKey(pageKey: PageTourKey, version: string) {
  return `${TOUR_STORAGE_PREFIX}${pageKey}.${version}`;
}

export function hasSeenTour(pageKey: PageTourKey, version: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(getTourStorageKey(pageKey, version)) === 'true';
}

export function markTourAsSeen(pageKey: PageTourKey, version: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getTourStorageKey(pageKey, version), 'true');
}
