import { normalizeLabel, parseDecimal, parseMonthYear } from '../util.js';
import { cells, rejection } from './common.js';

/**
 * Dataset D: Wholesale Price Index (national, monthly). Wide format: one row per item ("Crop"),
 * one column per "Month-Year". Each non-empty cell becomes one index observation.
 * Index values are dimensionless: they go to wpi_observations, never to a price table, and the
 * item is NOT linked to the commodity registry (any link is a separate reviewed step).
 *
 * @type {import('../framework.js').Adapter}
 */
export const wpiAdapter = {
  dataset: 'D',
  factType: 'wpi_index',
  source: {
    code: 'wpi_national_monthly_historical',
    name: 'Wholesale Price Index, national monthly (historical file)',
    sourceType: 'historical_file',
    publisher: null,
    description:
      'Wide CSV: one row per item, one column per month-year. Values are index numbers. The file does not state the index base period.',
    endpointReference: null,
  },
  assumptions: [],
  validateHeader(header) {
    if (header[0]?.trim() !== 'Crop')
      throw new Error('This file does not look like dataset D: the first column must be "Crop".');
    const bad = header.slice(1).filter((h) => parseMonthYear(h) === null);
    if (bad.length)
      throw new Error(
        `Dataset D columns must be "Month-Year"; unrecognised: ${bad.slice(0, 3).join(', ')}`,
      );
  },
  process(rec, header, resolver) {
    if (rec.columnCountMismatch)
      return [
        rejection(
          'structural_error',
          `expected ${header.length} columns, found ${rec.values.length}`,
          header,
          rec,
        ),
      ];
    const get = cells(header, rec);
    const item = get('Crop');
    if (!item)
      return [rejection('missing_required_value', 'the item (Crop) is empty', header, rec)];
    /** @type {import('../framework.js').AdapterItem[]} */
    const items = [];
    let seriesId = null;
    for (let i = 1; i < header.length; i += 1) {
      const column = header[i].trim();
      const cell = (rec.values[i] ?? '').trim();
      const period = parseMonthYear(column);
      const parsed = parseDecimal(cell);
      const raw = { item, column, value: cell };
      if ('blank' in parsed) continue; // a missing month is simply absent, never filled
      if ('invalid' in parsed) {
        items.push({
          reject: { reason: 'invalid_value', detail: 'index value is not a number', raw },
        });
        continue;
      }
      if (parsed.number <= 0) {
        items.push({
          reject: {
            reason: parsed.number < 0 ? 'negative_value' : 'invalid_value',
            detail: 'a price index must be positive',
            raw,
          },
        });
        continue;
      }
      seriesId ??= resolver.wpiSeriesId(item);
      items.push({
        fact: {
          row: { series_id: seriesId, period_month: period, index_value: parsed.value },
          keyFields: [normalizeLabel(item), period],
          fingerprintFields: [item, period, String(parsed.number)],
          qualityFlags: [],
        },
      });
    }
    return items;
  },
};
