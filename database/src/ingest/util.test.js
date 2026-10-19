import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  fingerprint,
  normalizeLabel,
  parseDecimal,
  parseIsoDate,
  parseMonthFirstDate,
  parseMonthYear,
  sanitizeMessage,
  sha256,
  sha256File,
} from './util.js';

const dir = mkdtempSync(join(tmpdir(), 'fasalytics-util-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('parseDecimal', () => {
  it.each([
    ['1250', '1250'],
    ['12.50', '12.50'],
    ['  7 ', '7'],
    ['0', '0'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['+3', '3'],
    ['-4.25', '-4.25'],
  ])('reads %j as %j', (cell, value) => {
    expect(parseDecimal(cell)).toMatchObject({ value });
  });
  it('keeps the exact decimal text so no precision is lost', () => {
    expect(parseDecimal('133100.00')).toMatchObject({ value: '133100.00', number: 133100 });
  });
  it.each(['', '   ', undefined])('treats %j as blank, never as zero', (cell) => {
    expect(parseDecimal(cell)).toEqual({ blank: true });
  });
  it.each(['abc', '12abc', '1,250', '1e5', 'NaN', 'Infinity', '--1', '1.2.3', '₹100'])(
    'rejects %j',
    (cell) => {
      expect(parseDecimal(cell)).toEqual({ invalid: true });
    },
  );
});

describe('date parsing', () => {
  it('reads month-first dates (M/D/YYYY) as the coverage report established', () => {
    expect(parseMonthFirstDate('6/6/2023')).toBe('2023-06-06');
    expect(parseMonthFirstDate('12/31/2024')).toBe('2024-12-31');
    expect(parseMonthFirstDate('2/29/2024')).toBe('2024-02-29'); // leap day
  });
  it.each([
    '2/29/2023',
    '13/1/2024',
    '0/5/2024',
    '6/31/2024',
    '31/6/2024',
    '2024-06-06',
    '6-6-2023',
    '',
    'x',
  ])('refuses the impossible or malformed date %j', (cell) => {
    expect(parseMonthFirstDate(cell)).toBeNull();
  });
  it('validates ISO dates against the calendar', () => {
    expect(parseIsoDate('2024-02-29')).toBe('2024-02-29');
    expect(parseIsoDate('2023-02-29')).toBeNull();
    expect(parseIsoDate('2024-13-01')).toBeNull();
    expect(parseIsoDate('2024-1-1')).toBeNull();
  });
  it('reads Month-Year as the first day of the month', () => {
    expect(parseMonthYear('January-2013')).toBe('2013-01-01');
    expect(parseMonthYear('december-2024')).toBe('2024-12-01');
    expect(parseMonthYear('Smarch-2024')).toBeNull();
    expect(parseMonthYear('January 2013')).toBeNull();
  });
});

describe('normalizeLabel', () => {
  it('collapses whitespace, trims and lower-cases, nothing more', () => {
    expect(normalizeLabel('  Tamil   Nadu ')).toBe('tamil nadu');
    expect(normalizeLabel('\tPunjab\n')).toBe('punjab');
    expect(normalizeLabel(' Punjab')).toBe(normalizeLabel('Punjab'));
  });
  it('does NOT repair spelling, punctuation or ampersands (that is the alias decisions job)', () => {
    expect(normalizeLabel('Chattisgarh')).not.toBe(normalizeLabel('Chhattisgarh'));
    expect(normalizeLabel('Jammu & Kashmir')).not.toBe(normalizeLabel('Jammu and Kashmir'));
    expect(normalizeLabel('Tamilnadu')).not.toBe(normalizeLabel('Tamil Nadu'));
  });
  it('treats null and undefined as empty', () => {
    expect(normalizeLabel(null)).toBe('');
    expect(normalizeLabel(undefined)).toBe('');
  });
});

describe('fingerprints and hashes', () => {
  it('is deterministic and order sensitive', () => {
    expect(fingerprint(['a', 1, null])).toBe(fingerprint(['a', 1, null]));
    expect(fingerprint(['a', 1])).not.toBe(fingerprint([1, 'a']));
    expect(fingerprint(['a', '1'])).not.toBe(fingerprint(['a', 1]));
    expect(fingerprint(['x'])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('fingerprints a file by its bytes only (path and name are irrelevant)', async () => {
    const a = join(dir, 'one.csv');
    const b = join(dir, 'copy-with-another-name.csv');
    const c = join(dir, 'changed.csv');
    writeFileSync(a, 'a,b\n1,2\n');
    writeFileSync(b, 'a,b\n1,2\n');
    writeFileSync(c, 'a,b\n1,3\n');
    expect(await sha256File(a)).toBe(await sha256File(b));
    expect(await sha256File(a)).not.toBe(await sha256File(c));
    expect(await sha256File(a)).toBe(sha256('a,b\n1,2\n'));
  });
});

describe('sanitizeMessage', () => {
  it('removes credentials from connection strings and truncates long text', () => {
    const text = sanitizeMessage('could not connect to postgresql://user:hunter2@db:5432/x');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('user:');
    expect(sanitizeMessage('x'.repeat(2000)).length).toBe(500);
  });
});
