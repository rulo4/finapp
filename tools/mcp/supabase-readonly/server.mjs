import process from 'node:process';
import { Pool } from 'pg';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  listMigrationFiles,
  loadEnvFile,
  quoteIdentifier,
  readJsonIfExists,
  readTextIfExists,
  resolveRepoPath,
  sanitizeIdentifier,
} from '../../../tooling/lib/tooling.mjs';

let cachedPool = null;

function buildDatabaseUrl() {
  if (process.env.SUPABASE_READONLY_DB_URL) {
    return process.env.SUPABASE_READONLY_DB_URL;
  }

  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }

  const poolerUrlPromise = readTextIfExists(resolveRepoPath('supabase', '.temp', 'pooler-url'));
  return poolerUrlPromise.then((poolerUrl) => {
    if (!poolerUrl) {
      return null;
    }

    if (!process.env.SUPABASE_REMOTE_DB_PASSWORD) {
      return null;
    }

    const url = new URL(poolerUrl.trim());
    url.password = process.env.SUPABASE_REMOTE_DB_PASSWORD;
    return url.toString();
  });
}

async function getPool() {
  if (cachedPool) {
    return cachedPool;
  }

  const connectionString = await buildDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'No se encontró una conexión Postgres. Usa SUPABASE_READONLY_DB_URL o SUPABASE_REMOTE_DB_PASSWORD junto con supabase/.temp/pooler-url.',
    );
  }

  const useSsl = !/localhost|127\.0\.0\.1/u.test(connectionString);
  cachedPool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 2,
  });

  return cachedPool;
}

async function queryRows(sql, values = []) {
  const pool = await getPool();
  const result = await pool.query(sql, values);
  return result.rows;
}

function asToolText(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: 'auna-supabase-readonly',
  version: '0.1.0',
});

server.tool('project_info', 'Lee metadatos locales de Supabase y OpenCode para este repo.', async () => {
  const [linkedProject, projectRef, configToml, remoteEnv] = await Promise.all([
    readJsonIfExists(resolveRepoPath('supabase', '.temp', 'linked-project.json')),
    readTextIfExists(resolveRepoPath('supabase', '.temp', 'project-ref')),
    readTextIfExists(resolveRepoPath('supabase', 'config.toml')),
    loadEnvFile('.env.remote'),
  ]);

  return asToolText({
    linkedProject,
    projectRef: projectRef?.trim() ?? null,
    configToml,
    remoteUrl: remoteEnv.VITE_SUPABASE_URL ?? null,
    hasRemoteAnonKey: Boolean(remoteEnv.VITE_SUPABASE_ANON_KEY),
    canConnectToPostgres: Boolean(await buildDatabaseUrl()),
  });
});

server.tool('list_migrations', 'Lista las migraciones locales del repo.', async () => {
  const migrations = await listMigrationFiles();

  return asToolText({
    count: migrations.length,
    latest: migrations.at(-1)?.fileName ?? null,
    migrations: migrations.map((migration) => ({
      number: migration.number,
      fileName: migration.fileName,
      relativePath: migration.relativePath,
    })),
  });
});

server.tool(
  'list_tables',
  'Lista tablas base del esquema indicado.',
  {
    schema: z.string().default('public'),
  },
  async ({ schema }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const rows = await queryRows(
      `
        select table_name
        from information_schema.tables
        where table_schema = $1
          and table_type = 'BASE TABLE'
        order by table_name
      `,
      [safeSchema],
    );

    return asToolText({ schema: safeSchema, tables: rows.map((row) => row.table_name) });
  },
);

server.tool(
  'describe_table',
  'Describe columnas, defaults y nulabilidad de una tabla.',
  {
    table: z.string(),
    schema: z.string().default('public'),
  },
  async ({ table, schema }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const safeTable = sanitizeIdentifier(table, 'Tabla');
    const columns = await queryRows(
      `
        select
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default
        from information_schema.columns
        where table_schema = $1
          and table_name = $2
        order by ordinal_position
      `,
      [safeSchema, safeTable],
    );
    const constraints = await queryRows(
      `
        select
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_schema as foreign_table_schema,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        left join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        left join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
          and tc.table_schema = ccu.table_schema
        where tc.table_schema = $1
          and tc.table_name = $2
        order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position
      `,
      [safeSchema, safeTable],
    );

    return asToolText({ schema: safeSchema, table: safeTable, columns, constraints });
  },
);

server.tool(
  'list_policies',
  'Lista policies RLS del esquema o de una tabla concreta.',
  {
    table: z.string().optional(),
    schema: z.string().default('public'),
  },
  async ({ table, schema }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const values = [safeSchema];
    let sql = `
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where schemaname = $1
    `;

    if (table) {
      values.push(sanitizeIdentifier(table, 'Tabla'));
      sql += ' and tablename = $2';
    }

    sql += ' order by tablename, policyname';
    const rows = await queryRows(sql, values);
    return asToolText({ schema: safeSchema, table: table ?? null, policies: rows });
  },
);

server.tool(
  'list_indexes',
  'Lista índices del esquema o de una tabla concreta.',
  {
    table: z.string().optional(),
    schema: z.string().default('public'),
  },
  async ({ table, schema }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const values = [safeSchema];
    let sql = `
      select schemaname, tablename, indexname, indexdef
      from pg_indexes
      where schemaname = $1
    `;

    if (table) {
      values.push(sanitizeIdentifier(table, 'Tabla'));
      sql += ' and tablename = $2';
    }

    sql += ' order by tablename, indexname';
    const rows = await queryRows(sql, values);
    return asToolText({ schema: safeSchema, table: table ?? null, indexes: rows });
  },
);

server.tool(
  'count_rows',
  'Cuenta registros de una tabla en modo solo lectura.',
  {
    table: z.string(),
    schema: z.string().default('public'),
  },
  async ({ table, schema }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const safeTable = sanitizeIdentifier(table, 'Tabla');
    const rows = await queryRows(
      `select count(*)::bigint as total from ${quoteIdentifier(safeSchema)}.${quoteIdentifier(safeTable)}`,
    );
    return asToolText({ schema: safeSchema, table: safeTable, total: Number(rows[0]?.total ?? 0) });
  },
);

server.tool(
  'preview_rows',
  'Devuelve una muestra acotada de filas de una tabla.',
  {
    table: z.string(),
    schema: z.string().default('public'),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ table, schema, limit }) => {
    const safeSchema = sanitizeIdentifier(schema, 'Schema');
    const safeTable = sanitizeIdentifier(table, 'Tabla');
    const rows = await queryRows(
      `select * from ${quoteIdentifier(safeSchema)}.${quoteIdentifier(safeTable)} limit $1`,
      [limit],
    );
    return asToolText({ schema: safeSchema, table: safeTable, limit, rows });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (cachedPool) {
      await cachedPool.end();
    }

    process.exit(0);
  });
}
