import path from 'node:path';
import {
  getPositionalArguments,
  listMigrationFiles,
  readTextFile,
  resolveRepoPath,
} from './lib/tooling.mjs';

const positionalArguments = getPositionalArguments(process.argv.slice(2));
const inputPath = positionalArguments[0] ?? null;
const migrations = await listMigrationFiles();

const targetPath = inputPath
  ? path.isAbsolute(inputPath)
    ? inputPath
    : resolveRepoPath(inputPath)
  : migrations.at(-1)?.absolutePath;

if (!targetPath) {
  process.stderr.write('No hay migraciones para revisar.\n');
  process.exit(1);
}

const sql = await readTextFile(targetPath);
const relativePath = path.relative(resolveRepoPath(), targetPath).split(path.sep).join('/');
const results = [];

function add(level, message, details = null) {
  results.push({ level, message, details });
}

const createdTables = [...sql.matchAll(/create table(?: if not exists)?\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]);

if (createdTables.length === 0) {
  add('warn', 'La migración no crea tablas nuevas; solo se aplicaron checks generales.');
}

for (const tableName of createdTables) {
  const hasGrant = new RegExp(`grant\\s+select,\\s*insert,\\s*update,\\s*delete\\s+on\\s+public\\.${tableName}\\s+to\\s+authenticated`, 'i').test(sql);
  const hasRls = new RegExp(`alter\\s+table\\s+public\\.${tableName}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql);
  const hasPolicy = new RegExp(`create\\s+policy[\\s\\S]+?on\\s+public\\.${tableName}`, 'i').test(sql);
  const hasUserId = /\buser_id\s+uuid\b/i.test(sql);
  const hasIndex = new RegExp(`create\\s+(?:unique\\s+)?index[\\s\\S]+?on\\s+public\\.${tableName}`, 'i').test(sql);

  if (hasGrant) {
    add('ok', `La tabla \`${tableName}\` incluye grants para authenticated.`);
  } else {
    add('error', `La tabla \`${tableName}\` no incluye grants para authenticated.`);
  }

  if (hasRls) {
    add('ok', `La tabla \`${tableName}\` habilita RLS.`);
  } else {
    add('error', `La tabla \`${tableName}\` no habilita RLS.`);
  }

  if (hasPolicy) {
    add('ok', `La tabla \`${tableName}\` define policies.`);
  } else {
    add('error', `La tabla \`${tableName}\` no define policies.`);
  }

  if (hasUserId) {
    add('ok', `La migración incluye una columna \`user_id\` o referencia equivalente para \`${tableName}\`.`);
  } else {
    add('warn', `No se encontró \`user_id uuid\` en la migración de \`${tableName}\`. Verifica si realmente no es user-scoped.`);
  }

  if (hasIndex) {
    add('ok', `La tabla \`${tableName}\` incluye al menos un índice explícito.`);
  } else {
    add('warn', `La tabla \`${tableName}\` no muestra índices explícitos. Revisa si hacen falta.`);
  }
}

if (/\bupdated_at\b/i.test(sql)) {
  if (/set_updated_at_timestamp/i.test(sql)) {
    add('ok', 'La migración usa el trigger estándar para `updated_at`.');
  } else {
    add('warn', 'La migración toca `updated_at` pero no se detectó `set_updated_at_timestamp()`.');
  }
}

if (!/grant\s+select,\s*insert,\s*update,\s*delete/i.test(sql) && createdTables.length === 0) {
  add('warn', 'No se detectaron grants explícitos. Si la migración crea objetos accesibles por authenticated, revisa este punto.');
}

process.stdout.write(`Revisión: ${relativePath}\n`);
for (const result of results) {
  const suffix = result.details ? ` (${result.details})` : '';
  process.stdout.write(`[${result.level.toUpperCase()}] ${result.message}${suffix}\n`);
}

if (results.some((result) => result.level === 'error')) {
  process.exitCode = 1;
}
