import type { Config } from 'tailwindcss';
import { borderRadius, colors, fontFamilyRole, fontSize, spacing } from './src/styles/stitchTokens';

/**
 * Self-hosted font stacks (see src/main.tsx for the @fontsource-variable imports).
 * Devanagari fallbacks are named so Hindi/Marathi text renders with a suitable system font
 * until a dedicated Devanagari web font is approved (DESIGN.md requires one).
 */
const stacks = {
  'Plus Jakarta Sans': [
    '"Plus Jakarta Sans Variable"',
    '"Noto Sans Devanagari"',
    '"Nirmala UI"',
    'system-ui',
    'sans-serif',
  ],
  Inter: ['"Inter Variable"', '"Noto Sans Devanagari"', '"Nirmala UI"', 'system-ui', 'sans-serif'],
} as const;

const fontFamily = Object.fromEntries(
  Object.entries(fontFamilyRole).map(([role, family]) => [role, [...stacks[family]]]),
);

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ...colors },
      borderRadius: { ...borderRadius },
      spacing: { ...spacing },
      fontFamily: {
        ...fontFamily,
        sans: [...stacks['Plus Jakarta Sans']],
      },
      fontSize: fontSize as unknown as Record<string, [string, Record<string, string>]>,
    },
  },
  plugins: [],
};

export default config;
