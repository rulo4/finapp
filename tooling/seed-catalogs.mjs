import { createClient } from '@supabase/supabase-js';
import {
  getFlagValue,
  hasFlag,
  loadEnvFile,
  normalizeCaseInsensitive,
  normalizeTicker,
  readJsonFile,
  resolveRepoPath,
} from './lib/tooling.mjs';

const argv = process.argv.slice(2);
const envFile = getFlagValue(argv, '--env-file') ?? '.env.remote';
const presetName = getFlagValue(argv, '--preset') ?? 'staging-demo';
const demoEmail = getFlagValue(argv, '--email') ?? process.env.SUPABASE_DEMO_USER_EMAIL ?? null;
const dryRun = hasFlag(argv, '--dry-run');

if (!demoEmail) {
  process.stderr.write('Falta el correo de la cuenta demo. Usa `--email` o `SUPABASE_DEMO_USER_EMAIL`.\n');
  process.exit(1);
}

const fileVariables = await loadEnvFile(envFile);
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? fileVariables.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

if (!supabaseUrl) {
  process.stderr.write('No se encontró `SUPABASE_URL` ni `VITE_SUPABASE_URL`.\n');
  process.exit(1);
}

if (!serviceRoleKey) {
  process.stderr.write('Falta `SUPABASE_SERVICE_ROLE_KEY` para sembrar catálogos de una cuenta demo.\n');
  process.exit(1);
}

const seedFile = resolveRepoPath('tooling', 'data', 'catalog-seeds.json');
const presets = await readJsonFile(seedFile);
const preset = presets[presetName];

if (!preset) {
  process.stderr.write(`No existe el preset \`${presetName}\` en tooling/data/catalog-seeds.json.\n`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findUserByEmail(email) {
  const target = email.trim().toLowerCase();
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }

    const match = data.users.find((user) => user.email?.trim().toLowerCase() === target) ?? null;
    if (match) {
      return match;
    }

    if (data.users.length < 200) {
      return null;
    }

    page += 1;
  }
}

async function insertMissingRows(tableName, rows, uniqueKeyFromRow, selectColumns) {
  const { data: existingRows, error: selectError } = await supabase
    .from(tableName)
    .select(selectColumns)
    .eq('user_id', demoUser.id);

  if (selectError) {
    throw selectError;
  }

  const existingKeys = new Set(existingRows.map(uniqueKeyFromRow));
  const missingRows = rows.filter((row) => !existingKeys.has(uniqueKeyFromRow(row)));

  if (dryRun || missingRows.length === 0) {
    return { inserted: 0, skipped: missingRows.length === 0 ? rows.length : rows.length - missingRows.length, missingRows };
  }

  const { error: insertError } = await supabase.from(tableName).insert(missingRows);
  if (insertError) {
    throw insertError;
  }

  return { inserted: missingRows.length, skipped: rows.length - missingRows.length, missingRows: [] };
}

const demoUser = await findUserByEmail(demoEmail);

if (!demoUser) {
  process.stderr.write(`No se encontró una cuenta demo con el correo ${demoEmail}.\n`);
  process.exit(1);
}

const summary = [];

const namedCatalogs = [
  'expense_categories',
  'income_sources',
  'stores',
  'unit_of_measures',
  'investment_entities',
];

for (const tableName of namedCatalogs) {
  const rows = (preset[tableName] ?? []).map((row) => ({
    user_id: demoUser.id,
    is_active: true,
    notes: null,
    ...row,
  }));

  const result = await insertMissingRows(
    tableName,
    rows,
    (row) => normalizeCaseInsensitive(row.name),
    'name',
  );

  summary.push({ tableName, ...result });
}

{
  const rows = (preset.payment_instruments ?? []).map((row) => ({
    user_id: demoUser.id,
    is_active: true,
    notes: null,
    ...row,
  }));

  const result = await insertMissingRows(
    'payment_instruments',
    rows,
    (row) => `${normalizeCaseInsensitive(row.name)}::${row.instrument_type}`,
    'name, instrument_type',
  );

  summary.push({ tableName: 'payment_instruments', ...result });
}

{
  const rows = (preset.brokers ?? []).map((row) => ({
    user_id: demoUser.id,
    is_active: true,
    notes: null,
    default_fee_factor: 0,
    ...row,
  }));

  const result = await insertMissingRows(
    'brokers',
    rows,
    (row) => normalizeCaseInsensitive(row.name),
    'name',
  );

  summary.push({ tableName: 'brokers', ...result });
}

{
  const rows = (preset.securities ?? []).map((row) => ({
    user_id: demoUser.id,
    is_active: true,
    notes: null,
    exchange_code: null,
    sector: null,
    industry: null,
    country_code: null,
    website_url: null,
    ...row,
  }));

  const result = await insertMissingRows(
    'securities',
    rows,
    (row) => `${normalizeTicker(row.ticker)}::${normalizeTicker(row.exchange_code ?? '')}`,
    'ticker, exchange_code',
  );

  summary.push({ tableName: 'securities', ...result });
}

process.stdout.write(`Cuenta demo: ${demoEmail}\n`);
process.stdout.write(`Preset: ${presetName}\n`);
process.stdout.write(`Modo: ${dryRun ? 'dry-run' : 'insert'}\n`);

for (const entry of summary) {
  process.stdout.write(`- ${entry.tableName}: insertados=${entry.inserted}, ya-existentes=${entry.skipped}\n`);
}
