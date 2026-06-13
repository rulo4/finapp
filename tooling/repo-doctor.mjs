import fs from 'node:fs/promises';
import path from 'node:path';
import {
  listInvalidMigrationFiles,
  listMigrationFiles,
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  resolveRepoPath,
} from './lib/tooling.mjs';

const shouldPrintJson = process.argv.includes('--json');
const results = [];
const RECOMMENDED_TOUR_PREFIXES = ['/dashboard', '/spending', '/income', '/catalogs'];

function addResult(level, check, message, details = null) {
  results.push({ level, check, message, details });
}

function extractConstArrayBlock(content, constName) {
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`export const ${escapedName}[^=]*= \\[(.*?)\\];`, 's'));
  return match?.[1] ?? '';
}

function extractQuotedValues(block, propertyName) {
  const escapedProperty = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...block.matchAll(new RegExp(`${escapedProperty}:\\s*'([^']+)'`, 'g'))].map((match) => match[1]);
}

function extractQuotedArrayValues(block, propertyName) {
  const escapedProperty = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = [];

  for (const match of block.matchAll(new RegExp(`${escapedProperty}:\\s*\\[([^\\]]*)\\]`, 'gs'))) {
    values.push(...[...match[1].matchAll(/'([^']+)'/g)].map((itemMatch) => itemMatch[1]));
  }

  return values;
}

function extractAbsoluteAppRoutes(appContent) {
  return new Set([...appContent.matchAll(/path="(\/[^\"]*)"/g)].map((match) => match[1]));
}

function extractRelativeAppRoutes(appContent) {
  return new Set([...appContent.matchAll(/path="([^/\"][^\"]*)"/g)].map((match) => match[1]));
}

function extractDashboardRouteSegments(content) {
  const blockMatch = content.match(/const DASHBOARD_TAB_BY_ROUTE_SEGMENT:[^=]*=\s*\{([\s\S]*?)\};/);

  if (!blockMatch) {
    return new Set();
  }

  return new Set([...blockMatch[1].matchAll(/([a-z0-9_-]+):\s*'[^']+'/g)].map((match) => match[1]));
}

function compareExactSets(leftValues, rightValues) {
  const leftOnly = [...leftValues].filter((value) => !rightValues.has(value)).sort();
  const rightOnly = [...rightValues].filter((value) => !leftValues.has(value)).sort();

  return {
    leftOnly,
    rightOnly,
    matches: leftOnly.length === 0 && rightOnly.length === 0,
  };
}

async function listFilesRecursive(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath));
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

async function collectStaticDataTourTargets() {
  const srcDirectory = resolveRepoPath('src');
  const allFiles = await listFilesRecursive(srcDirectory);
  const sourceFiles = allFiles.filter((filePath) => /\.(ts|tsx)$/u.test(filePath));
  const targets = new Set();

  for (const filePath of sourceFiles) {
    const content = await readTextIfExists(filePath);
    if (content == null) {
      continue;
    }

    for (const match of content.matchAll(/data-tour="([^"]+)"/g)) {
      targets.add(match[1]);
    }
  }

  return targets;
}

async function checkPackageScripts() {
  const packageJson = await readJsonIfExists(resolveRepoPath('package.json'));
  const scripts = packageJson?.scripts ?? {};

  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    const matches = [...scriptCommand.matchAll(/\bnode\s+([A-Za-z0-9_./-]+\.mjs)\b/g)];

    for (const match of matches) {
      const relativeTarget = match[1];
      const targetPath = resolveRepoPath(relativeTarget.split('/').join(path.sep));

      if (await pathExists(targetPath)) {
        addResult('ok', 'package-scripts', `El script \`${scriptName}\` apunta a un archivo existente.`, relativeTarget);
      } else {
        addResult(
          'warn',
          'package-scripts',
          `El script \`${scriptName}\` apunta a un archivo inexistente.`,
          relativeTarget,
        );
      }
    }
  }
}

async function checkMigrations() {
  const migrations = await listMigrationFiles();
  const invalidFiles = await listInvalidMigrationFiles();

  if (migrations.length === 0) {
    addResult('error', 'migrations', 'No se encontraron migraciones válidas en `supabase/migrations`.');
    return;
  }

  addResult('ok', 'migrations', `Se detectaron ${migrations.length} migraciones válidas.`, migrations.at(-1)?.fileName ?? null);

  for (const invalidFile of invalidFiles) {
    addResult('warn', 'migrations', 'Hay archivos SQL con nombre fuera de convención.', invalidFile);
  }

  for (let index = 1; index < migrations.length; index += 1) {
    const previous = migrations[index - 1];
    const current = migrations[index];

    if (current.number !== previous.number + 1) {
      addResult(
        'error',
        'migrations',
        'La numeración de migraciones tiene huecos o saltos inesperados.',
        `${previous.fileName} -> ${current.fileName}`,
      );
    }
  }
}

async function checkDocumentationMigrationReferences() {
  const migrations = await listMigrationFiles();
  const latestNumber = migrations.at(-1)?.number ?? 0;
  const documentationFiles = ['README.md', 'DEPLOY.md'];

  for (const relativePath of documentationFiles) {
    const content = await readTextIfExists(resolveRepoPath(relativePath));

    if (content == null) {
      addResult('warn', 'docs', 'No se encontró un archivo de documentación esperado.', relativePath);
      continue;
    }

    const references = [...content.matchAll(/supabase\/migrations\/(\d{3})_[A-Za-z0-9_]+\.sql/g)].map((match) => Number(match[1]));
    const highestReference = references.length > 0 ? Math.max(...references) : 0;

    if (highestReference === 0) {
      addResult('warn', 'docs', 'El documento no referencia migraciones explícitas.', relativePath);
      continue;
    }

    if (highestReference < latestNumber) {
      addResult(
        'warn',
        'docs',
        'El documento referencia migraciones más antiguas que el estado actual del repo.',
        `${relativePath}: ${String(highestReference).padStart(3, '0')} < ${String(latestNumber).padStart(3, '0')}`,
      );
      continue;
    }

    addResult('ok', 'docs', 'El documento referencia la migración más reciente conocida.', relativePath);
  }
}

async function checkOpencodeConfig() {
  const configPath = resolveRepoPath('opencode.json');
  const config = await readJsonIfExists(configPath);

  if (!config) {
    addResult('warn', 'opencode', 'No se encontró `opencode.json`.');
    return;
  }

  for (const instructionPath of config.instructions ?? []) {
    const absoluteInstructionPath = resolveRepoPath(instructionPath);
    if (await pathExists(absoluteInstructionPath)) {
      addResult('ok', 'opencode', 'La instrucción declarada en `opencode.json` existe.', instructionPath);
    } else {
      addResult('error', 'opencode', 'Una instrucción declarada en `opencode.json` no existe.', instructionPath);
    }
  }

  for (const [serverName, serverConfig] of Object.entries(config.mcp ?? {})) {
    if (serverConfig?.type !== 'local') {
      addResult('ok', 'opencode', `El MCP \`${serverName}\` no requiere validación de archivo local.`);
      continue;
    }

    const commandParts = Array.isArray(serverConfig.command) ? serverConfig.command : [];
    const fileArgument = commandParts.find((value) => value.endsWith('.mjs') || value.endsWith('.js'));

    if (!fileArgument) {
      addResult('warn', 'opencode', `El MCP \`${serverName}\` no expone un archivo JS/MJS en su comando.`);
      continue;
    }

    const absoluteCommandPath = resolveRepoPath(fileArgument);
    if (await pathExists(absoluteCommandPath)) {
      addResult('ok', 'opencode', `El archivo del MCP \`${serverName}\` existe.`, fileArgument);
    } else {
      addResult('error', 'opencode', `El archivo del MCP \`${serverName}\` no existe.`, fileArgument);
    }
  }
}

async function checkNavigationAgainstRoutes() {
  const [navigationContent, appContent, dashboardContent] = await Promise.all([
    readTextIfExists(resolveRepoPath('src', 'config', 'navigation.ts')),
    readTextIfExists(resolveRepoPath('src', 'App.tsx')),
    readTextIfExists(resolveRepoPath('src', 'pages', 'DashboardPage.tsx')),
  ]);

  if (navigationContent == null || appContent == null || dashboardContent == null) {
    addResult('warn', 'navigation', 'No se pudieron revisar rutas y navegación porque faltan archivos base.');
    return;
  }

  const sidebarBlock = extractConstArrayBlock(navigationContent, 'sidebarNavigationItems');
  const spendingBlock = extractConstArrayBlock(navigationContent, 'spendingTabs');
  const investmentBlock = extractConstArrayBlock(navigationContent, 'investmentTabs');
  const dashboardBlock = extractConstArrayBlock(navigationContent, 'dashboardTabs');
  const absoluteRoutes = extractAbsoluteAppRoutes(appContent);
  const relativeRoutes = extractRelativeAppRoutes(appContent);
  const dashboardSegments = extractDashboardRouteSegments(dashboardContent);
  let foundIssue = false;

  for (const sidebarRoute of extractQuotedValues(sidebarBlock, 'to')) {
    if (!absoluteRoutes.has(sidebarRoute)) {
      foundIssue = true;
      addResult('error', 'navigation', 'Un item principal de navegación no existe como ruta canónica en `App.tsx`.', sidebarRoute);
    }
  }

  for (const matchPath of extractQuotedArrayValues(sidebarBlock, 'matchPaths')) {
    const hasCoverage = absoluteRoutes.has(matchPath) || [...absoluteRoutes].some((routePath) => routePath.startsWith(`${matchPath}/`));

    if (!hasCoverage) {
      foundIssue = true;
      addResult('warn', 'navigation', 'Un `matchPaths` de navegación no coincide con rutas explícitas ni prefijos conocidos.', matchPath);
    }
  }

  for (const tabRoute of extractQuotedValues(spendingBlock, 'to')) {
    if (tabRoute === '/spending') {
      if (!absoluteRoutes.has(tabRoute)) {
        foundIssue = true;
        addResult('error', 'navigation', 'La tab base de gastos no existe en `App.tsx`.', tabRoute);
      }

      continue;
    }

    const segment = tabRoute.slice('/spending/'.length);
    if (!absoluteRoutes.has('/spending') || !relativeRoutes.has(segment)) {
      foundIssue = true;
      addResult('error', 'navigation', 'Una tab de gastos no coincide con las rutas anidadas reales.', tabRoute);
    }
  }

  for (const tabRoute of extractQuotedValues(investmentBlock, 'to')) {
    if (tabRoute === '/investments') {
      if (!absoluteRoutes.has(tabRoute)) {
        foundIssue = true;
        addResult('error', 'navigation', 'La tab base de inversiones no existe en `App.tsx`.', tabRoute);
      }

      continue;
    }

    const segment = tabRoute.slice('/investments/'.length);
    if (!absoluteRoutes.has('/investments') || !relativeRoutes.has(segment)) {
      foundIssue = true;
      addResult('error', 'navigation', 'Una tab de inversiones no coincide con las rutas anidadas reales.', tabRoute);
    }
  }

  for (const tabRoute of extractQuotedValues(dashboardBlock, 'to')) {
    if (tabRoute === '/dashboard') {
      if (!absoluteRoutes.has(tabRoute)) {
        foundIssue = true;
        addResult('error', 'navigation', 'La tab base de dashboard no existe en `App.tsx`.', tabRoute);
      }

      continue;
    }

    const segment = tabRoute.slice('/dashboard/'.length);
    if (!absoluteRoutes.has('/dashboard/:dashboardTab') || !dashboardSegments.has(segment)) {
      foundIssue = true;
      addResult('error', 'navigation', 'Una tab de dashboard no coincide con los segmentos soportados por `DashboardPage`.', tabRoute);
    }
  }

  if (!foundIssue) {
    addResult('ok', 'navigation', 'Las rutas principales y tabs de navegación coinciden con `App.tsx` y `DashboardPage`.');
  }
}

async function checkCatalogs() {
  const [catalogsContent, appContent] = await Promise.all([
    readTextIfExists(resolveRepoPath('src', 'config', 'catalogs.ts')),
    readTextIfExists(resolveRepoPath('src', 'App.tsx')),
  ]);

  if (catalogsContent == null || appContent == null) {
    addResult('warn', 'catalogs', 'No se pudieron revisar los catálogos porque faltan archivos base.');
    return;
  }

  const catalogKeys = [...catalogsContent.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((match) => match[1]);
  const uniqueCatalogKeys = new Set(catalogKeys);
  let foundIssue = false;

  if (catalogKeys.length !== uniqueCatalogKeys.size) {
    foundIssue = true;
    addResult('error', 'catalogs', 'Hay keys duplicadas en `catalogConfigs`.');
  }

  const hasCatalogBaseRoute = appContent.includes('path="/catalogs"');
  const hasCatalogDynamicRoute = appContent.includes('path="/catalogs/:catalogKey"');

  if (!hasCatalogBaseRoute || !hasCatalogDynamicRoute) {
    foundIssue = true;
    addResult('error', 'catalogs', 'Las rutas de catálogos no cubren la vista base y la dinámica por `catalogKey`.');
  }

  if (!foundIssue) {
    addResult('ok', 'catalogs', 'Los catálogos tienen keys únicas y soporte de rutas base/dinámica.');
  }
}

async function checkTours() {
  const [
    storageContent,
    registryContent,
    catalogsContent,
    catalogsPageContent,
    staticDataTourTargets,
  ] = await Promise.all([
    readTextIfExists(resolveRepoPath('src', 'features', 'tours', 'tourStorage.ts')),
    readTextIfExists(resolveRepoPath('src', 'features', 'tours', 'tourRegistry.ts')),
    readTextIfExists(resolveRepoPath('src', 'config', 'catalogs.ts')),
    readTextIfExists(resolveRepoPath('src', 'pages', 'CatalogsPage.tsx')),
    collectStaticDataTourTargets(),
  ]);

  if (storageContent == null || registryContent == null || catalogsContent == null || catalogsPageContent == null) {
    addResult('warn', 'tours', 'No se pudo revisar la consistencia de tours porque faltan archivos.');
    return;
  }

  const typeMatch = storageContent.match(/export type PageTourKey = ([^;]+);/);
  const storageKeys = new Set(
    [...(typeMatch?.[1].matchAll(/'([a-z0-9-]+)'/g) ?? [])].map((match) => match[1]),
  );
  const registryKeys = new Set(
    [...registryContent.matchAll(/^\s{2}([a-z0-9-]+):\s*\{/gm)].map((match) => match[1]),
  );
  const catalogKeys = new Set([...catalogsContent.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((match) => match[1]));
  const tourCatalogKeys = new Set([...registryContent.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((match) => match[1]));
  const staticSelectors = [...registryContent.matchAll(/element:\s*'\[data-tour="([^"]+)"\]'/g)].map((match) => match[1]);
  const tourPathPrefixes = new Set([...registryContent.matchAll(/pathname\.startsWith\('([^']+)'\)/g)].map((match) => match[1]));
  let foundIssue = false;

  for (const key of storageKeys) {
    if (!registryKeys.has(key)) {
      foundIssue = true;
      addResult('error', 'tours', 'Hay una key de tour en storage que no existe en el registry.', key);
    }
  }

  for (const key of registryKeys) {
    if (!storageKeys.has(key)) {
      foundIssue = true;
      addResult('error', 'tours', 'Hay una key de tour en el registry que no existe en storage.', key);
    }
  }

  const catalogComparison = compareExactSets(catalogKeys, tourCatalogKeys);
  for (const missingKey of catalogComparison.leftOnly) {
    foundIssue = true;
    addResult('error', 'tours', 'Hay un catálogo sin resumen equivalente en `tourRegistry`.', missingKey);
  }

  for (const extraKey of catalogComparison.rightOnly) {
    foundIssue = true;
    addResult('error', 'tours', 'Hay un resumen de tour para un catálogo inexistente.', extraKey);
  }

  for (const selector of staticSelectors) {
    if (!staticDataTourTargets.has(selector)) {
      foundIssue = true;
      addResult('error', 'tours', 'El registry referencia un `data-tour` que no existe en el código fuente.', selector);
    }
  }

  if (!catalogsPageContent.includes('data-tour={`catalog-tab-${catalog.key}`}')) {
    foundIssue = true;
    addResult('error', 'tours', 'No se encontró el target dinámico esperado para tabs de catálogos en `CatalogsPage`.');
  }

  for (const recommendedPrefix of RECOMMENDED_TOUR_PREFIXES) {
    if (!tourPathPrefixes.has(recommendedPrefix)) {
      addResult('warn', 'tours', 'Una pantalla prioritaria aún no tiene tour registrado.', recommendedPrefix);
    }
  }

  if (!foundIssue) {
    addResult('ok', 'tours', 'Las keys, catálogos y targets de tours son consistentes.');
  }
}

function printTextReport() {
  const grouped = {
    error: results.filter((result) => result.level === 'error'),
    warn: results.filter((result) => result.level === 'warn'),
    ok: results.filter((result) => result.level === 'ok'),
  };

  const lines = [];
  lines.push(`Errores: ${grouped.error.length}`);
  lines.push(`Warnings: ${grouped.warn.length}`);
  lines.push(`Checks OK: ${grouped.ok.length}`);

  for (const result of results) {
    const suffix = result.details ? ` (${result.details})` : '';
    lines.push(`[${result.level.toUpperCase()}] ${result.check}: ${result.message}${suffix}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

await checkPackageScripts();
await checkMigrations();
await checkDocumentationMigrationReferences();
await checkOpencodeConfig();
await checkNavigationAgainstRoutes();
await checkCatalogs();
await checkTours();

if (shouldPrintJson) {
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
} else {
  printTextReport();
}

if (results.some((result) => result.level === 'error')) {
  process.exitCode = 1;
}
