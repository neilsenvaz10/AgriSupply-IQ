import v8 from 'node:v8';
import vm from 'node:vm';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readCsv } from './csv.js';

const dir = mkdtempSync(join(tmpdir(), 'fasalytics-csv-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** @param {string} name @param {string} content */
function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

/** @param {string} path @param {{ highWaterMark?: number }} [options] */
async function readAll(path, options = {}) {
  const { header, records } = await readCsv(path, options);
  const rows = [];
  for await (const r of records) rows.push(r);
  return { header, rows };
}

describe('streaming CSV reader', () => {
  it('returns the header immediately, then numbered data rows', async () => {
    const { header, rows } = await readAll(file('a.csv', 'a,b,c\n1,2,3\n4,5,6\n'));
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => [r.rowNumber, r.values])).toEqual([
      [1, ['1', '2', '3']],
      [2, ['4', '5', '6']],
    ]);
    expect(rows.every((r) => !r.columnCountMismatch)).toBe(true);
  });

  it('handles quoted fields with commas, doubled quotes and line breaks', async () => {
    const { rows } = await readAll(
      file('q.csv', 'a,b\n"x, y","say ""hi"""\n"line1\nline2",plain\n'),
    );
    expect(rows[0].values).toEqual(['x, y', 'say "hi"']);
    expect(rows[1].values).toEqual(['line1\nline2', 'plain']);
  });

  it('accepts CRLF line endings and a UTF-8 byte-order mark', async () => {
    const { header, rows } = await readAll(
      file('b.csv', '﻿"Crop","Jan-2013"\r\n"Bajra","131.60"\r\n'),
    );
    expect(header).toEqual(['Crop', 'Jan-2013']);
    expect(rows[0].values).toEqual(['Bajra', '131.60']);
  });

  it('keeps empty cells, skips blank lines, and reads a final row without a trailing newline', async () => {
    const { rows } = await readAll(file('e.csv', 'a,b,c\n1,,3\n\n,,\n7,8,9'));
    expect(rows.map((r) => r.values)).toEqual([
      ['1', '', '3'],
      ['', '', ''],
      ['7', '8', '9'],
    ]);
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
  });

  it('never repairs a broken row: it flags the column-count mismatch and keeps the raw cells', async () => {
    const { rows } = await readAll(file('m.csv', 'a,b,c\n1,2\n1,2,3,4\n1,2,3\n'));
    expect(rows.map((r) => r.columnCountMismatch)).toEqual([true, true, false]);
    expect(rows[0].values).toEqual(['1', '2']);
    expect(rows[1].values).toEqual(['1', '2', '3', '4']);
  });

  it('surfaces an unterminated quote as one broken final row instead of swallowing silently', async () => {
    const { rows } = await readAll(file('u.csv', 'a,b\n1,2\n"unterminated,3\n4,5\n'));
    expect(rows[0].columnCountMismatch).toBe(false);
    expect(rows[rows.length - 1].columnCountMismatch).toBe(true);
  });

  it('returns an empty header for an empty file', async () => {
    const { header, rows } = await readAll(file('empty.csv', ''));
    expect(header).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('reads across chunk boundaries identically (tiny chunks)', async () => {
    const content = 'a,b\n"x, ""y""",2\n3,"z\nw"\n';
    const whole = await readAll(file('c1.csv', content));
    const tiny = await readAll(file('c2.csv', content), { highWaterMark: 2 });
    expect(tiny.rows.map((r) => r.values)).toEqual(whole.rows.map((r) => r.values));
  });

  it('streams a large file with bounded memory (rows are not retained)', async () => {
    // Measure RETAINED memory, not garbage: force a collection before every sample. Without it the
    // heap grows with uncollected garbage and the result depends on when V8 happens to collect.
    v8.setFlagsFromString('--expose-gc');
    const collect = vm.runInNewContext('gc');
    const lines = ['id,value'];
    for (let i = 0; i < 300_000; i += 1) lines.push(`${i},${'x'.repeat(40)}`);
    const path = file('big.csv', lines.join('\n') + '\n');
    lines.length = 0; // the test's own copy of the text is not part of what is measured
    collect();
    const before = process.memoryUsage().heapUsed;
    let count = 0;
    let peak = 0;
    const { records } = await readCsv(path);
    for await (const r of records) {
      count += 1;
      if (count % 50_000 === 0) {
        collect();
        peak = Math.max(peak, process.memoryUsage().heapUsed - before);
      }
      if (r.rowNumber !== count) throw new Error('row numbering broke');
    }
    expect(count).toBe(300_000);
    // Retaining the 300,000 parsed rows would cost on the order of 100 MB; streaming retains almost nothing.
    expect(peak).toBeLessThan(40 * 1024 * 1024);
  });
});
