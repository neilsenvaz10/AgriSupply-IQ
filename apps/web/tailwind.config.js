import {
  borderRadius,
  colors,
  fontFamilyRole,
  fontSize,
  spacing,
} from './src/styles/stitchTokens.js';

/**
 * Self-hosted font stacks (see src/main.jsx for the @fontsource-variable imports).
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
};

const fontFamily = Object.fromEntries(
  Object.entries(fontFamilyRole).map(([role, family]) => [role, [...stacks[family]]]),
);

/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
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
      fontSize,
    },
  },
  plugins: [],
};

export default config;
