import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema/index.js';

describe('Drizzle schema (Milestone 8 scope)', () => {
  it('defines only the neutral system_metadata table', () => {
    const tables = Object.values(schema).map((table) => getTableName(table));
    expect(tables).toEqual(['system_metadata']);
  });

  it('system_metadata has the documented columns', () => {
    const columns = getTableColumns(schema.systemMetadata);
    expect(Object.keys(columns)).toEqual(['key', 'value', 'updatedAt']);
    expect(columns.key.primary).toBe(true);
    expect(columns.value.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });
});

describe('migrations folder', () => {
  const files = readdirSync(MIGRATIONS_FOLDER);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  it('contains numbered SQL migrations and the drizzle-kit journal', () => {
    expect(sqlFiles.length).toBeGreaterThanOrEqual(1);
    for (const file of sqlFiles) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    expect(files).toContain('meta');
  });

  it('has a journal entry for every migration file and vice versa', () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    );
    const tags = journal.entries.map((/** @type {{ tag: string }} */ e) => `${e.tag}.sql`).sort();
    expect(tags).toEqual(sqlFiles);
  });

  it('creates no agricultural tables yet (that is Phase 2)', () => {
    const sql = sqlFiles.map((f) => readFileSync(join(MIGRATIONS_FOLDER, f), 'utf8')).join('\n');
    const created = [...sql.matchAll(/CREATE TABLE\s+"?([a-z_]+)"?/gi)].map((m) => m[1]);
    expect(created).toEqual(['system_metadata']);
    expect(sql).not.toMatch(/commodit|market|mandi|price|forecast|observation/i);
  });

  it('contains no credentials or role passwords', () => {
    const sql = sqlFiles.map((f) => readFileSync(join(MIGRATIONS_FOLDER, f), 'utf8')).join('\n');
    expect(sql).not.toMatch(/PASSWORD|postgres:\/\//i);
  });
});
