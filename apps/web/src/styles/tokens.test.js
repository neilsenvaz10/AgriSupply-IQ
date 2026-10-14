import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

const extend = config.theme.extend;

describe('Stitch design tokens in the Tailwind theme', () => {
  it('uses the approved canonical palette', () => {
    expect(extend.colors['primary']).toBe('#004c22');
    expect(extend.colors['primary-container']).toBe('#166534');
    expect(extend.colors['secondary']).toBe('#006c49');
    expect(extend.colors['tertiary-container']).toBe('#7d4e00');
    expect(extend.colors['background']).toBe('#f8faf8');
    expect(extend.colors['surface']).toBe('#f8faf8');
  });
  it('carries the full Stitch colour set', () => {
    expect(Object.keys(extend.colors).length).toBe(47);
  });
  it('preserves the Stitch radius and spacing scales', () => {
    expect(extend.borderRadius).toMatchObject({ DEFAULT: '0.25rem', lg: '0.5rem', xl: '0.75rem' });
    expect(extend.spacing).toMatchObject({
      'space-sm': '0.5rem',
      'space-md': '1rem',
      gutter: '1.5rem',
      'margin-mobile': '1rem',
    });
  });
  it('maps type roles to self-hosted families with Devanagari fallbacks', () => {
    const body = extend.fontFamily['body-md'];
    const metric = extend.fontFamily['metric-lg'];
    expect(body?.[0]).toBe('"Plus Jakarta Sans Variable"');
    expect(metric?.[0]).toBe('"Inter Variable"');
    expect(body).toContain('"Noto Sans Devanagari"');
    // Never reference a Google-hosted URL.
    expect(JSON.stringify(extend.fontFamily)).not.toMatch(/googleapis|gstatic/);
  });
  it('defines all 16 Stitch type roles', () => {
    expect(Object.keys(extend.fontSize)).toHaveLength(16);
  });
});
