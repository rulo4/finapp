import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');
const migrationFilePattern = /^(\d{3})_(.+)\.sql$/;

export function getRepoRoot() {
  return repoRoot;
}

export function resolveRepoPath(...segments) {
  return path.join(repoRoot, ...segments);
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(targetPath) {
  return fs.readFile(targetPath, 'utf8');
}

export async function readTextIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  return readTextFile(targetPath);
}

export async function readJsonFile(targetPath) {
  return JSON.parse(await readTextFile(targetPath));
}

export async function readJsonIfExists(targetPath) {
  const text = await readTextIfExists(targetPath);

  if (text == null) {
    return null;
  }

  return JSON.parse(text);
}

export function formatMigrationNumber(value) {
  return String(value).padStart(3, '0');
}

export async function listMigrationFiles() {
  const migrationsDirectory = resolveRepoPath('supabase', 'migrations');
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && migrationFilePattern.test(entry.name))
    .map((entry) => {
      const match = migrationFilePattern.exec(entry.name);

      return {
        fileName: entry.name,
        number: Number(match[1]),
        slug: match[2],
        absolutePath: path.join(migrationsDirectory, entry.name),
        relativePath: path.posix.join('supabase', 'migrations', entry.name),
      };
    })
    .sort((left, right) => left.number - right.number);
}

export async function listInvalidMigrationFiles() {
  const migrationsDirectory = resolveRepoPath('supabase', 'migrations');
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql') && !migrationFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

export function getFlagValue(argv, flagName) {
  const index = argv.indexOf(flagName);

  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
}

export function hasFlag(argv, flagName) {
  return argv.includes(flagName);
}

export function getPositionalArguments(argv) {
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith('--')) {
      values.push(current);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      index += 1;
    }
  }

  return values;
}

export function parseEnvText(content) {
  const variables = {};

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    variables[key] = value;
  }

  return variables;
}

export async function loadEnvFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveRepoPath(filePath);
  const content = await readTextIfExists(absolutePath);

  if (content == null) {
    return {};
  }

  return parseEnvText(content);
}

export function sanitizeIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} inválido: ${value}`);
  }

  return value;
}

export function quoteIdentifier(value) {
  return `"${sanitizeIdentifier(value, 'Identificador')}"`;
}

export function normalizeCaseInsensitive(value) {
  return value.trim().toLowerCase();
}

export function normalizeTicker(value) {
  return value.trim().toUpperCase();
}
