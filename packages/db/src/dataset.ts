// Writes one version of the public dataset as SQLite, JSON, and a zip of CSVs.
//
//   npm run dataset -- --version 2026-10-25

import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { DATASET_FILES, DATASET_TABLES, isDatasetVersion, type DatasetKind, type DatasetTable } from './dataset-tables.ts';
import { pgConfig } from './pg-config.ts';
import { writeStoredZip } from './zip.ts';

export interface BuiltDataset {
  version: string;
  directory: string;
  rows: Record<string, number>;
}

export async function buildDataset(options: {
  connectionString: string;
  directory: string;
  version: string;
  notes?: string;
}): Promise<BuiltDataset> {
  if (!isDatasetVersion(options.version)) {
    throw new Error(`dataset version ${JSON.stringify(options.version)} must be letters, numbers, dots, underscores or hyphens`);
  }
  const finalDir = join(options.directory, options.version);
  const staging = join(options.directory, `${options.version}.partial`);
  await mkdir(options.directory, { recursive: true });

  const client = new pg.Client(pgConfig(options.connectionString));
  await client.connect();
  let committed = false;
  let published = false;
  try {
    const existing = await client.query('SELECT 1 FROM dataset_release WHERE version = $1', [options.version]);
    if (existing.rowCount) throw new Error(`Dataset version ${options.version} already exists`);
    if (await exists(finalDir)) throw new Error(`Dataset directory ${finalDir} already exists`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(join(staging, 'csv'), { recursive: true });
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const rows = await writeTables(client, staging, options.version);
    await client.query('COMMIT');
    committed = true;
    await writeFile(join(staging, 'manifest.json'), JSON.stringify({ version: options.version, rows }));
    await rename(staging, finalDir);
    published = true;
    await client.query('INSERT INTO dataset_release (version, notes) VALUES ($1, $2)', [options.version, options.notes ?? null]);
    return { version: options.version, directory: finalDir, rows };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    await rm(staging, { recursive: true, force: true });
    if (published) await rm(finalDir, { recursive: true, force: true });
    throw error;
  } finally {
    await client.end();
  }
}

async function writeTables(client: pg.Client, staging: string, version: string): Promise<Record<string, number>> {
  const sqlite = new DatabaseSync(join(staging, DATASET_FILES.sqlite));
  sqlite.exec('PRAGMA journal_mode = OFF');
  sqlite.exec('PRAGMA synchronous = OFF');
  const json = createWriteStream(join(staging, DATASET_FILES.json));
  const counts: Record<string, number> = {};
  const csvFiles: { name: string; path: string }[] = [];
  try {
    await writeChunk(json, `{"version":${JSON.stringify(version)},"source_url":"https://muslimscholars.info","tables":{`);
    let firstTable = true;
    for (const table of DATASET_TABLES) {
      const count = await writeTable(client, sqlite, json, staging, table, firstTable);
      counts[table.name] = count;
      csvFiles.push({ name: `${table.name}.csv`, path: join(staging, 'csv', `${table.name}.csv`) });
      firstTable = false;
    }
    await writeChunk(json, '}}');
    await endStream(json);
    await writeStoredZip(join(staging, DATASET_FILES.csv), csvFiles);
    await rm(join(staging, 'csv'), { recursive: true, force: true });
    return counts;
  } catch (error) {
    json.destroy();
    throw error;
  } finally {
    sqlite.close();
  }
}

async function writeTable(
  client: pg.Client,
  sqlite: DatabaseSync,
  json: WriteStream,
  staging: string,
  table: DatasetTable,
  firstTable: boolean,
): Promise<number> {
  sqlite.exec(createSql(table));
  const insert = sqlite.prepare(
    `INSERT INTO ${quote(table.name)} (${table.columns.map(column => quote(column.name)).join(', ')}) VALUES (${table.columns.map(() => '?').join(', ')})`,
  );
  const csvPath = join(staging, 'csv', `${table.name}.csv`);
  const csv = createWriteStream(csvPath);
  let count = 0;
  try {
    await writeChunk(csv, `${table.columns.map(column => csvCell(column.name)).join(',')}\n`);
    await writeChunk(json, `${firstTable ? '' : ','}${JSON.stringify(table.name)}:[`);
    await client.query(`DECLARE dataset_export NO SCROLL CURSOR FOR ${selectSql(table)}`);
    sqlite.exec('BEGIN');
    try {
      for (;;) {
        const fetched = await client.query<Record<string, unknown>>('FETCH 500 FROM dataset_export');
        if (fetched.rows.length === 0) break;
        for (const raw of fetched.rows) {
          const jsonRow: Record<string, unknown> = {};
          const sqliteRow: (string | number | null)[] = [];
          for (const column of table.columns) {
            const value = jsonCell(column.kind, raw[column.name]);
            jsonRow[column.name] = value;
            sqliteRow.push(sqliteCell(column.kind, value));
          }
          insert.run(...sqliteRow);
          await writeChunk(csv, `${table.columns.map(column => csvCell(jsonRow[column.name])).join(',')}\n`);
          await writeChunk(json, `${count === 0 ? '' : ','}${JSON.stringify(jsonRow)}`);
          count += 1;
        }
      }
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    } finally {
      await client.query('CLOSE dataset_export').catch(() => undefined);
    }
    await writeChunk(json, ']');
    await endStream(csv);
    return count;
  } catch (error) {
    csv.destroy();
    throw error;
  }
}

function selectSql(table: DatasetTable): string {
  const columns = table.columns.map(column => quote(column.name)).join(', ');
  const order = table.orderBy.map(quote).join(', ');
  return `SELECT ${columns} FROM ${quote(table.name)} ORDER BY ${order}`;
}

function createSql(table: DatasetTable): string {
  const columns = table.columns.map(column => `${quote(column.name)} ${sqliteType(column.kind)}`);
  const primaryKey = table.primaryKey.map(quote).join(', ');
  return `CREATE TABLE ${quote(table.name)} (${columns.join(', ')}, PRIMARY KEY (${primaryKey}))`;
}

function sqliteType(kind: DatasetKind): string {
  if (kind === 'int' || kind === 'bool') return 'INTEGER';
  if (kind === 'real') return 'REAL';
  return 'TEXT';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function quote(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected column ${name}`);
  return `"${name}"`;
}

function jsonCell(kind: DatasetKind, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (kind === 'date') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (kind === 'bool') return Boolean(value);
  if (kind === 'int') {
    const number = typeof value === 'bigint' ? Number(value) : Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`integer out of range: ${String(value)}`);
    return number;
  }
  if (kind === 'real') return typeof value === 'number' ? value : Number(value);
  if (kind === 'json') return value;
  return typeof value === 'string' ? value : String(value);
}

function sqliteCell(kind: DatasetKind, value: unknown): string | number | null {
  if (value === null) return null;
  if (kind === 'bool') return value ? 1 : 0;
  if (kind === 'json') return JSON.stringify(value);
  if (kind === 'int' || kind === 'real') return value as number;
  return String(value);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

async function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function endStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
}
