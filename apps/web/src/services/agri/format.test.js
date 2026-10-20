import { describe, expect, it } from 'vitest';
import {
  TIER_LABEL,
  addDays,
  daysBetween,
  describeFreshness,
  coverageTier,
  describePrice,
  formatCount,
  formatDate,
  formatMonth,
  formatRange,
  formatRupees,
} from './format';

const cov = (m, s, n) => ({
  coverage: {
    mandi_daily: { observations: m },
    state_daily: { observations: s },
    national_monthly: { observations: n },
  },
});

describe('formatting historical values', () => {
  it('formats rupees with Indian grouping and shows a missing value as a dash, not zero', () => {
    expect(formatRupees(2300)).toBe('₹2,300');
    expect(formatRupees(123456.5)).toBe('₹1,23,456.5');
    expect(formatRupees(null)).toBe('—');
    expect(formatRupees(0)).toBe('₹0');
  });

  it('formats ISO dates as text without any time-zone shift', () => {
    expect(formatDate('2023-06-06')).toBe('6 Jun 2023');
    expect(formatDate('2025-12-31')).toBe('31 Dec 2025');
    expect(formatDate(null)).toBe('—');
    expect(formatMonth('2010-01-01')).toBe('Jan 2010');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('formats a coverage range, or says there are no observations', () => {
    expect(formatRange({ first_date: '2023-06-06', last_date: '2025-06-11' })).toBe(
      '6 Jun 2023 to 11 Jun 2025',
    );
    expect(formatRange({ first_date: '2024-01-02', last_date: '2024-01-02' })).toBe('2 Jan 2024');
    expect(formatRange({ first_date: null, last_date: null })).toBe('no observations');
  });

  it('formats counts', () => {
    expect(formatCount(735461)).toBe('7,35,461');
    expect(formatCount(null)).toBe('—');
  });

  it('keeps the ORIGINAL unit and flags an assumed unit; it never converts', () => {
    expect(
      describePrice({
        modal_price: 2300,
        price_unit: 'quintal',
        unit_basis: 'assumed_from_documentation',
      }),
    ).toEqual({ amount: '₹2,300', unit: 'per quintal', assumed: true });
    expect(
      describePrice({ modal_price: 3100, price_unit: 'bundle', unit_basis: 'source_stated' }),
    ).toEqual({ amount: '₹3,100', unit: 'per bundle', assumed: false });
    expect(
      describePrice({ modal_price: 50, price_unit: 'unit', unit_basis: 'source_stated' }).unit,
    ).toBe('per unit');
  });
});

describe('commodity coverage tiers', () => {
  it('never lets a state-level or national series count as mandi-level', () => {
    expect(coverageTier(cov(5, 5, 5))).toBe('mandi');
    expect(coverageTier(cov(0, 5, 5))).toBe('state');
    expect(coverageTier(cov(0, 0, 5))).toBe('national');
    expect(coverageTier(cov(0, 0, 0))).toBe('none');
  });

  it('labels each tier distinctly', () => {
    expect(new Set(Object.values(TIER_LABEL)).size).toBe(4);
    expect(TIER_LABEL.state).toMatch(/state-level.*only/i);
    expect(TIER_LABEL.none).toMatch(/no price observations/i);
  });
});

describe('freshness wording', () => {
  it('counts whole calendar days with no time-zone or leap-year drift', () => {
    expect(daysBetween('2024-03-18', '2024-03-28')).toBe(10);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2024-03-28', '2024-03-28')).toBe(0);
    expect(daysBetween('2024-03-28', '2024-03-27')).toBe(-1);
  });

  it('is neutral: reported date, days before a stated reference date, no judgement', () => {
    expect(describeFreshness('2024-03-18', '2024-03-28')).toEqual({
      reported: 'Last reported on 18 Mar 2024',
      relative: '10 days before the reference date (28 Mar 2024)',
      days: 10,
    });
    expect(describeFreshness('2024-03-27', '2024-03-28').relative).toMatch(/^1 day before/);
    expect(describeFreshness('2024-03-28', '2024-03-28').relative).toBe(
      'on the reference date (28 Mar 2024)',
    );
    expect(describeFreshness('2024-03-28', null)).toEqual({
      reported: 'Last reported on 28 Mar 2024',
      relative: null,
      days: null,
    });
    expect(describeFreshness('2024-03-29', '2024-03-28').relative).toMatch(/check the data/);
    for (const days of [0, 1, 400, 4000]) {
      const text = JSON.stringify(describeFreshness('2000-01-01', addDays('2000-01-01', days)));
      expect(text).not.toMatch(/fresh|current|live|stale|recent|old/i);
    }
  });
});
