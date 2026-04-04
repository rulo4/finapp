import { driver, type DriveStep, type Driver } from 'driver.js';
import { getPageTourDefinition } from './tourRegistry';
import { hasSeenTour, markTourAsSeen, type PageTourKey } from './tourStorage';

const TOUR_WAIT_TIMEOUT_MS = 1800;
const TOUR_WAIT_INTERVAL_MS = 120;

let activeDriver: Driver | null = null;

function resolveStepElement(step: DriveStep) {
  if (typeof step.element === 'string') {
    return document.querySelector(step.element);
  }

  if (typeof step.element === 'function') {
    return step.element();
  }

  return step.element;
}

function areStepsReady(steps: DriveStep[]) {
  return steps.every((step) => {
    if (!step.element) {
      return true;
    }

    return resolveStepElement(step) instanceof Element;
  });
}

async function waitForSteps(buildSteps: () => DriveStep[]) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TOUR_WAIT_TIMEOUT_MS) {
    const steps = buildSteps();

    if (steps.length > 0 && areStepsReady(steps)) {
      return steps;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, TOUR_WAIT_INTERVAL_MS);
    });
  }

  return null;
}

export function destroyActiveTour() {
  if (!activeDriver) {
    return;
  }

  activeDriver.destroy();
  activeDriver = null;
}

export async function startPageTour(pageKey: PageTourKey) {
  const definition = getPageTourDefinition(pageKey);
  const steps = await waitForSteps(definition.buildSteps);

  if (!steps) {
    return false;
  }

  destroyActiveTour();

  activeDriver = driver({
    steps,
    allowClose: true,
    allowKeyboardControl: true,
    animate: true,
    overlayOpacity: 0.42,
    overlayColor: '#0f172a',
    smoothScroll: true,
    showProgress: true,
    stagePadding: 10,
    stageRadius: 16,
    popoverOffset: 14,
    popoverClass: 'app-tour-popover',
    nextBtnText: 'Siguiente',
    prevBtnText: 'Anterior',
    doneBtnText: 'Listo',
    progressText: '{{current}} / {{total}}',
    onDestroyed: () => {
      markTourAsSeen(pageKey, definition.version);
      activeDriver = null;
    },
  });

  activeDriver.drive();
  return true;
}

export async function maybeAutoStartPageTour(pageKey: PageTourKey) {
  const definition = getPageTourDefinition(pageKey);

  if (hasSeenTour(pageKey, definition.version)) {
    return false;
  }

  return startPageTour(pageKey);
}
