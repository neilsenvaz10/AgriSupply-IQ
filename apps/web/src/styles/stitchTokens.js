/**
 * Design tokens extracted verbatim from the Google Stitch exports
 * (design/stitch/original/.../fasalytics_farmer_dashboard/code.html, inline tailwind.config).
 * The token block is byte-identical across all eight exports.
 *
 * GENERATED ONCE in Milestone 5. Do not hand-edit values; if the design changes,
 * regenerate from the Stitch source and record the change in design/stitch/DESIGN_SYSTEM.md.
 *
 * Canonical brand palette (approved):
 *   primary #004c22 / primary-container #166534, secondary #006c49,
 *   tertiary-container #7d4e00, background #f8faf8.
 */
export const colors = {
    "background": "#f8faf8",
    "error": "#ba1a1a",
    "error-container": "#ffdad6",
    "inverse-on-surface": "#eff1ef",
    "inverse-primary": "#8bd79b",
    "inverse-surface": "#2e3130",
    "on-background": "#191c1b",
    "on-error": "#ffffff",
    "on-error-container": "#93000a",
    "on-primary": "#ffffff",
    "on-primary-container": "#93e0a2",
    "on-primary-fixed": "#00210b",
    "on-primary-fixed-variant": "#005226",
    "on-secondary": "#ffffff",
    "on-secondary-container": "#00714d",
    "on-secondary-fixed": "#002113",
    "on-secondary-fixed-variant": "#005236",
    "on-surface": "#191c1b",
    "on-surface-variant": "#404940",
    "on-tertiary": "#ffffff",
    "on-tertiary-container": "#ffc47d",
    "on-tertiary-fixed": "#2a1700",
    "on-tertiary-fixed-variant": "#653e00",
    "outline": "#707a6f",
    "outline-variant": "#bfc9bd",
    "primary": "#004c22",
    "primary-container": "#166534",
    "primary-fixed": "#a6f4b5",
    "primary-fixed-dim": "#8bd79b",
    "secondary": "#006c49",
    "secondary-container": "#6cf8bb",
    "secondary-fixed": "#6ffbbe",
    "secondary-fixed-dim": "#4edea3",
    "surface": "#f8faf8",
    "surface-bright": "#f8faf8",
    "surface-container": "#eceeec",
    "surface-container-high": "#e6e9e7",
    "surface-container-highest": "#e1e3e1",
    "surface-container-low": "#f2f4f2",
    "surface-container-lowest": "#ffffff",
    "surface-dim": "#d8dad9",
    "surface-tint": "#1f6c3a",
    "surface-variant": "#e1e3e1",
    "tertiary": "#5d3900",
    "tertiary-container": "#7d4e00",
    "tertiary-fixed": "#ffddb8",
    "tertiary-fixed-dim": "#ffb95f"
};

export const borderRadius = {
    "DEFAULT": "0.25rem",
    "lg": "0.5rem",
    "xl": "0.75rem",
    "full": "9999px"
};

export const spacing = {
    "margin": "2rem",
    "gutter-mobile": "1rem",
    "space-sm": "0.5rem",
    "space-xs": "0.25rem",
    "space-md": "1rem",
    "space-lg": "1.5rem",
    "gutter": "1.5rem",
    "margin-mobile": "1rem",
    "space-xl": "2.5rem"
};
/** Stitch type roles -> [size, { lineHeight, letterSpacing?, fontWeight }] */
export const fontSize = {
    "headline-lg-mobile": [
        "24px",
        {
            "lineHeight": "32px",
            "letterSpacing": "-0.01em",
            "fontWeight": "700"
        }
    ],
    "label-sm": [
        "12px",
        {
            "lineHeight": "16px",
            "letterSpacing": "0.02em",
            "fontWeight": "600"
        }
    ],
    "headline-sm": [
        "20px",
        {
            "lineHeight": "28px",
            "fontWeight": "600"
        }
    ],
    "label-xs": [
        "11px",
        {
            "lineHeight": "14px",
            "letterSpacing": "0.04em",
            "fontWeight": "700"
        }
    ],
    "body-sm": [
        "14px",
        {
            "lineHeight": "20px",
            "fontWeight": "400"
        }
    ],
    "metric-xl": [
        "40px",
        {
            "lineHeight": "48px",
            "letterSpacing": "-0.02em",
            "fontWeight": "700"
        }
    ],
    "headline-display-mobile": [
        "32px",
        {
            "lineHeight": "40px",
            "letterSpacing": "-0.02em",
            "fontWeight": "800"
        }
    ],
    "metric-md": [
        "20px",
        {
            "lineHeight": "26px",
            "fontWeight": "600"
        }
    ],
    "body-lg": [
        "18px",
        {
            "lineHeight": "28px",
            "fontWeight": "400"
        }
    ],
    "metric-xl-mobile": [
        "30px",
        {
            "lineHeight": "36px",
            "letterSpacing": "-0.01em",
            "fontWeight": "700"
        }
    ],
    "headline-display": [
        "48px",
        {
            "lineHeight": "56px",
            "letterSpacing": "-0.03em",
            "fontWeight": "800"
        }
    ],
    "label-md": [
        "14px",
        {
            "lineHeight": "20px",
            "letterSpacing": "0.01em",
            "fontWeight": "600"
        }
    ],
    "metric-lg": [
        "28px",
        {
            "lineHeight": "34px",
            "fontWeight": "700"
        }
    ],
    "body-md": [
        "16px",
        {
            "lineHeight": "24px",
            "fontWeight": "400"
        }
    ],
    "headline-lg": [
        "32px",
        {
            "lineHeight": "40px",
            "letterSpacing": "-0.02em",
            "fontWeight": "700"
        }
    ],
    "headline-md": [
        "24px",
        {
            "lineHeight": "32px",
            "letterSpacing": "-0.01em",
            "fontWeight": "700"
        }
    ]
};
/** Stitch maps each type role to a family name (resolved to self-hosted stacks in tailwind.config.js). */
export const fontFamilyRole = {
    "headline-lg-mobile": "Plus Jakarta Sans",
    "label-sm": "Inter",
    "headline-sm": "Plus Jakarta Sans",
    "label-xs": "Inter",
    "body-sm": "Plus Jakarta Sans",
    "metric-xl": "Inter",
    "headline-display-mobile": "Plus Jakarta Sans",
    "metric-md": "Inter",
    "body-lg": "Plus Jakarta Sans",
    "metric-xl-mobile": "Inter",
    "headline-display": "Plus Jakarta Sans",
    "label-md": "Inter",
    "metric-lg": "Inter",
    "body-md": "Plus Jakarta Sans",
    "headline-lg": "Plus Jakarta Sans",
    "headline-md": "Plus Jakarta Sans"
};
