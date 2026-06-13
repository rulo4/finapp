import fs from 'node:fs/promises';
import {
  formatMigrationNumber,
  getPositionalArguments,
  listMigrationFiles,
  resolveRepoPath,
  slugify,
} from './lib/tooling.mjs';

const positionalArguments = getPositionalArguments(process.argv.slice(2));
const rawName = positionalArguments.join(' ').trim();

if (!rawName) {
  process.stderr.write('Uso: pnpm run migration:new -- <nombre-descriptivo>\n');
  process.exit(1);
}

const slug = slugify(rawName);
if (!slug) {
  process.stderr.write('No se pudo generar un nombre de archivo válido para la migración.\n');
  process.exit(1);
}

const migrations = await listMigrationFiles();
const nextNumber = formatMigrationNumber((migrations.at(-1)?.number ?? 0) + 1);
const fileName = `${nextNumber}_${slug}.sql`;
const filePath = resolveRepoPath('supabase', 'migrations', fileName);

const template = `-- ${rawName}\n\n-- Checklist para tablas user-scoped:\n-- 1. user_id uuid not null default auth.uid() references auth.users(id) on delete cascade\n-- 2. grant select, insert, update, delete ... to authenticated\n-- 3. alter table ... enable row level security\n-- 4. create policy ... para select/insert/update/delete\n-- 5. create index ... user_id donde aplique\n-- 6. trigger updated_at si agregas esa columna\n\n-- Escribe aquí la migración.\n`;

await fs.writeFile(filePath, template, { flag: 'wx' });
process.stdout.write(`Creada: supabase/migrations/${fileName}\n`);
