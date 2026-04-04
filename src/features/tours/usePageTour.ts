import { useCallback, useEffect, useMemo } from 'react';
import { getPageTourKey } from './tourRegistry';
import { maybeAutoStartPageTour, startPageTour } from './tourService';

const attemptedAutoStarts = new Set<string>();

export function usePageTour(pathname: string) {
  const pageKey = useMemo(() => getPageTourKey(pathname), [pathname]);

  const startTour = useCallback(async () => {
    if (!pageKey) {
      return false;
    }

    return startPageTour(pageKey);
  }, [pageKey]);

  useEffect(() => {
    if (!pageKey) {
      return;
    }

    const autoStartSignature = `${pageKey}:${pathname}`;

    if (attemptedAutoStarts.has(autoStartSignature)) {
      return;
    }

    attemptedAutoStarts.add(autoStartSignature);
    void maybeAutoStartPageTour(pageKey);
  }, [pageKey, pathname]);

  return {
    hasTour: pageKey != null,
    startTour,
  };
}
