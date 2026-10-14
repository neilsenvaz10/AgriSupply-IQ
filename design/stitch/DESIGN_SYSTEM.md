# FASALYTICS — Design System (extracted from Stitch)

> **Milestone 4 deliverable. Documentation only.** Tailwind config, components and styles have not been changed or implemented.
> **Sources:** `DESIGN.md` (named *AgriIntelligence & Market Risk System*) and the inline `tailwind.config` and markup of the **eight** HTML exports (Batch 1 and Batch 2). The Batch 2 `DESIGN.md` is a byte-identical copy and the Tailwind token block is identical in all eight files, so the token tables below apply to both batches unchanged.
> Values below are quoted from those files. Where the two sources disagree, both are shown.

---

## 1. Brand and style (from DESIGN.md)

"Agri-FinTech Precision": institutional minimalism with deep chlorophyll greens, energetic data accents, high-contrast numerals; calibrated for direct sunlight legibility and multilingual (Hindi/Marathi) use. Cards use the 8 pt grid; touch targets are specified at **≥ 48 × 48 px**.

---

## 2. Colours

### 2.1 Token set (identical in DESIGN.md and every export's Tailwind config)

| Role | Token | Hex |
|---|---|---|
| Canvas | `background` / `surface` / `surface-bright` | `#f8faf8` |
| Surface ramp | `surface-container-lowest` → `highest` | `#ffffff`, `#f2f4f2`, `#eceeec`, `#e6e9e7`, `#e1e3e1` |
| Surface dim / variant | `surface-dim` / `surface-variant` | `#d8dad9` / `#e1e3e1` |
| Text | `on-surface` / `on-surface-variant` | `#191c1b` / `#404940` |
| Outline | `outline` / `outline-variant` | `#707a6f` / `#bfc9bd` |
| **Primary (forest green)** | `primary` / `primary-container` | `#004c22` / `#166534` |
| On-primary | `on-primary` / `on-primary-container` | `#ffffff` / `#93e0a2` |
| Primary tints | `primary-fixed` / `-dim` | `#a6f4b5` / `#8bd79b` |
| Inverse | `inverse-primary` / `inverse-surface` / `inverse-on-surface` | `#8bd79b` / `#2e3130` / `#eff1ef` |
| **Secondary (emerald)** | `secondary` / `secondary-container` | `#006c49` / `#6cf8bb` |
| Secondary tints | `secondary-fixed` / `-dim` | `#6ffbbe` / `#4edea3` |
| **Tertiary (amber/brown)** | `tertiary` / `tertiary-container` | `#5d3900` / `#7d4e00` |
| Tertiary tints | `tertiary-fixed` / `-dim` | `#ffddb8` / `#ffb95f` |
| **Error** | `error` / `error-container` | `#ba1a1a` / `#ffdad6` |
| Surface tint | `surface-tint` | `#1f6c3a` |

### 2.2 Semantic and accent colours

DESIGN.md defines a second, brand-level palette in prose that is **not the same hex values** as the token set above:

| Purpose | DESIGN.md prose | Nearest token in exports |
|---|---|---|
| Structural green | `#166534` | `primary-container` `#166534` ✅ matches |
| Positive signal / low risk | `#10B981` | `secondary-fixed-dim` `#4edea3` ✖ different |
| Highlight (live AI nodes) | `#84CC16` electric lime | **not defined in the Tailwind config; unused** |
| Logistics / liquidity | `#0284C7` sky blue | **not defined; unused** |
| Medium risk | `#F59E0B` | `tertiary-fixed-dim` `#ffb95f` ✖ different |
| High risk | `#EF4444` | `error` `#ba1a1a` ✖ different |
| Strong text | `#0F291E`, `#1E3A2F` | `on-surface` `#191c1b` ✖ different |
| Light cards | `#F0FDF4`, `#ECFDF5` | not tokens; Tailwind `emerald-50` style only if used |

**Risk pills (DESIGN.md):** Low `#ECFDF5` bg / `#065F46` text / `#10B981` dot · Medium `#FFFBEB` / `#92400E` / `#F59E0B` · High `#FEF2F2` / `#991B1B` / `#EF4444`.

### 2.3 What the exports actually do

- Almost all colour comes from the token classes (`bg-primary`, `text-on-surface-variant`, …).
- **Raw Tailwind palette colours leak in:** the dashboard's weather banner uses `amber-50/200/600/800/900/950`, the AI card uses `emerald-100/200/300/400/500`, and several places use `bg-black/25–80`. These are **not tokens**.
- Hardcoded hex values appear only inside inline SVG and scripts: `#004c22 #006c49 #166534 #6cf8bb #7d4e00 #bfc9bd #eceeec #00210b` (dashboard), `#10B981 #4edea3 #F59E0B #ffb95f #eceeec` (allocation, includes the DESIGN.md prose values), `#707a6f #ba1a1a #004c22` (copilot).
- The allocation donut uses `#ffb95f` / `#004c22` / `#4edea3` for its three segments, while its legend dots use `bg-secondary-fixed-dim` / `bg-primary` / `bg-tertiary-fixed-dim`, so legend and chart roughly but not exactly agree.

### 2.4 Inconsistencies and recommendation

| Issue | Recommendation |
|---|---|
| Two palettes (token set vs prose semantic colours) | Adopt the **token set** as canonical and map the semantic intents onto it (success → `secondary`, warning → `tertiary-fixed-dim`, danger → `error`) *or* formally add `success/warning/danger` tokens carrying the prose hexes. Decide once; do not mix. |
| Lime `#84CC16` and sky `#0284C7` unused | Keep as reserved accent tokens only if a screen needs them; otherwise drop. |
| Raw Tailwind `amber-*`, `emerald-*` leaks | Replace with warning/success tokens during Phase 7. |
| Chart colours hand-typed in SVG | Move to `--chart-*` tokens consumed by the chart component. |

---

## 3. Typography

| Aspect | Value | Source |
|---|---|---|
| Families | **Plus Jakarta Sans** (display, headings, body); **Inter** (metrics, labels) | DESIGN.md, exports |
| Weights loaded | 400, 500, 600, 700, 800 for both | Google Fonts URL in exports |
| Icon font | Material Symbols Outlined (variable) | exports |
| Loading | **External** (Google Fonts); none local | exports |
| Multilingual | DESIGN.md: add **Noto Sans Devanagari** fallback, 8–12% taller line-height | **Not implemented in any export** |
| Numerals | DESIGN.md: Inter tabular figures (`tnum`) and slashed zeros for prices | **Not implemented**: no `font-variant-numeric` anywhere |

### Type scale (identical in DESIGN.md and Tailwind config)

| Token | Family | Size / line height | Weight | Letter-spacing |
|---|---|---|---|---|
| `headline-display` | Jakarta | 48 / 56 | 800 | −0.03em |
| `headline-display-mobile` | Jakarta | 32 / 40 | 800 | −0.02em |
| `headline-lg` | Jakarta | 32 / 40 | 700 | −0.02em |
| `headline-lg-mobile` | Jakarta | 24 / 32 | 700 | −0.01em |
| `headline-md` | Jakarta | 24 / 32 | 700 | −0.01em |
| `headline-sm` | Jakarta | 20 / 28 | 600 | 0 |
| `metric-xl` | Inter | 40 / 48 | 700 | −0.02em |
| `metric-xl-mobile` | Inter | 30 / 36 | 700 | −0.01em |
| `metric-lg` | Inter | 28 / 34 | 700 | 0 |
| `metric-md` | Inter | 20 / 26 | 600 | 0 |
| `body-lg` | Jakarta | 18 / 28 | 400 | 0 |
| `body-md` | Jakarta | 16 / 24 | 400 | 0 |
| `body-sm` | Jakarta | 14 / 20 | 400 | 0 |
| `label-md` | Inter | 14 / 20 | 600 | 0.01em |
| `label-sm` | Inter | 12 / 16 | 600 | 0.02em |
| `label-xs` | Inter | 11 / 14 | 700 | 0.04em |

**Notes:** the exports use `label-xs` (11 px) very heavily for important facts (rates, distances, risk), which is small for field use in sunlight. Several places also use arbitrary `text-[9px]`, `text-[10px]`, `text-[13px]`, `text-[15px]` sizes outside the scale.

---

## 4. Spacing, layout and shape

### 4.1 Spacing tokens

| Token | Value |
|---|---|
| `space-xs` / `sm` / `md` / `lg` / `xl` | 0.25 / 0.5 / 1 / 1.5 / 2.5 rem |
| `gutter` / `gutter-mobile` | 1.5 / 1 rem |
| `margin` / `margin-mobile` | 2 / 1 rem |

Exports also use many off-scale Tailwind values (`p-3.5`, `p-4.5` (not valid in default Tailwind), `gap-2.5`, `px-3.5`).

### 4.2 Layout

| Aspect | DESIGN.md (intended) | Exports (actual) |
|---|---|---|
| Grid | 12 col ≥ 1024 px; 8 col 640–1023; 4 col < 640 | Mobile only; single column |
| Desktop shell | Fixed 260 px left rail, fluid canvas max 1600 px | **Not present** |
| Mobile shell | Stacked decision cards; carousels only for mandi comparison and timelines | Top bar 64 px (`h-16`), bottom tab bar 64 px (`h-16`) with a raised centre action; chip carousels used for crops and sort |
| Content width | n/a | `px-margin-mobile` (16 px); allocation caps at `max-w-lg` (512 px) centred |
| Safe areas | n/a | `pt-safe` / `pb-safe` via `env(safe-area-inset-*)` |
| Min touch target | 48 × 48 px | Mostly met by nav (`min-h-[48px]`), **violated** by the language toggle (28 × 28 px) and small action buttons (`py-1.5`, `h-7`) |

### 4.3 Radii

| Source | Values |
|---|---|
| DESIGN.md `rounded:` | `sm 0.25`, `DEFAULT 0.5`, `md 0.75`, `lg 1`, `xl 1.5`, `full` |
| Exports' Tailwind config | `DEFAULT 0.25`, `lg 0.5`, `xl 0.75`, `full` |
| What markup uses | `rounded-2xl` (cards, Tailwind default 1 rem), `rounded-xl` (0.75 rem inputs/chips), `rounded-full` (pills), `rounded-lg`, plus `rounded-md`, `rounded` |

The two radius tables disagree on names (`DEFAULT` 0.5 vs 0.25), but the **visual results agree** with DESIGN.md's prose (cards 16 px, inputs 12 px, pills full). Treat prose + markup as authoritative and reconcile token names in Phase 7.

### 4.4 Elevation (DESIGN.md prose; exports approximate with Tailwind shadows)

| Level | Spec |
|---|---|
| 0 | Canvas, flat |
| 1 | 1 px `rgba(22,101,52,.08)` outline + `0 2px 8px -2px rgba(22,101,52,.04), 0 8px 24px -4px rgba(22,101,52,.06)` |
| 2 | `0 4px 12px -2px rgba(22,101,52,.06), 0 16px 32px -6px rgba(22,101,52,.10)`; stroke `rgba(16,185,129,.25)` |
| 3 | `0 24px 48px -12px rgba(15,41,30,.20)` + `backdrop-blur-md` over `rgba(15,41,30,.40)` |

**Actual markup** uses stock `shadow-sm`, `shadow-md`, `shadow-xl`, `backdrop-blur-xl`, and header/footer shadows like `shadow-[0_1px_8px_rgba(0,0,0,0.04)]`. The tinted-green shadow system from DESIGN.md is **not implemented**.

---

## 5. Components

### 5.1 Present in the exports

| Component | Where | Notes |
|---|---|---|
| App header with language toggle | all | Remote logo image; toggle is visual only |
| Bottom tab bar with raised centre action | all | 5 items; `data-path` only |
| Location chip | dashboard | |
| Freshness chip ("Live Feed • 12m ago") | dashboard | Misleading; see §7 |
| Alert / banner (weather & transport) | dashboard | Amber raw palette |
| Commodity chip with quantity | dashboard | Horizontal scroll |
| Lot meta strip | dashboard | |
| Hero recommendation card (gradient) | dashboard | Confidence pill, payout pod, CTA |
| Price trajectory chart (SVG) | dashboard | Static; marker with tooltip |
| Mandi card (compact) | dashboard | Rate / transport / net grid |
| Mandi comparison card (rich) | comparison | Rank badge, risk index, cost breakdown |
| Sort/filter chip carousel | comparison | Inert |
| Horizontal bar comparison | comparison | |
| Data table (metric × mandi) | comparison | Horizontal scroll container |
| Route/map card | comparison | Static background image |
| Sticky action tray + toast | comparison | |
| Strategy segmented control | allocation | Three presets |
| Donut chart + legend | dashboard (mini), allocation | Pure SVG |
| KPI card / risk gauge badge | allocation | |
| Allocation slider card with ledger | allocation | |
| "Why this allocation" explanation list | allocation | |
| Chat bubbles, AI answer card | copilot | |
| Prompt chip carousel, pill input with mic | copilot | |
| Status pill / risk pill / badge | all | Matches DESIGN.md pills |

### 5.1b New patterns introduced by Batch 2 (forecast, commodities, markets, simulator)

The Tailwind token block is **byte-identical** across both batches, so Batch 2 adds **no new colours, type tokens, spacing or radii**. It adds patterns:

| Pattern | Screen | Notes |
|---|---|---|
| Segmented horizon control with `role="tablist"` / `aria-selected` | Forecast | Only export with tab semantics; reuse for allocation strategy and sort |
| Hero metric with range chip ("Band: ₹2,790 – ₹2,890") | Forecast | Needs a defined interval level (e.g. "80% interval") |
| Confidence-band chart (past dashed + forecast solid + shaded band + "TODAY" marker + peak flag) | Forecast | The first chart that distinguishes observed from forecast; formalise as `ForecastBand` |
| Horizontal snap-scrolling daily cards with highlighted peak | Forecast | `snap-x snap-mandatory`; peak card uses `ring-2 ring-secondary-fixed` |
| Driver list with coloured dots | Forecast | Colour-only meaning; add icon + text |
| Category chips with counts | Commodities | Count badge inside chip |
| Spotlight card (image header, 3-up metric grid, "top mandis" strip) | Commodities | |
| Eligibility legend ("Forecast Qualified / Exploratory Screened / Data Aggregating") | Commodities | Closest thing to capability tiers; formalise as `TierBadge` |
| Commodity card with trailing status strip (forecast / alert / storage) | Commodities | Strip colour varies by content type (secondary, error-container, tertiary-fixed) |
| Sticky bottom primary CTA above the tab bar | Commodities | `sticky bottom-20` |
| State quick-pills with counts and dropdown filter pair | Markets | The first geographic selector pattern |
| Stylised map card with hub markers and legend overlay | Markets | Hand-drawn SVG; not usable as a map |
| Coverage bar with three tiers (82 / 14 / 4%) and legend | Markets | Good pattern for data coverage; needs real tiers |
| Source tag chip (e-NAM, Govt APMC) and reporting-time footer strip | Markets | The right idea for provenance and freshness |
| Selectable card with checkbox (multi-select for compare) | Markets | Checkbox unlabeled |
| Range slider with value pill (`tabular-nums`) and scale caption | Simulator | The only use of tabular numerals |
| Preset chip row that writes slider values | Simulator | |
| Baseline struck-through vs simulated metric with delta pill | Simulator | Good: baseline preserved visibly |
| Itemised "waterfall" list + proportion bar | Simulator | Static legend never updates |
| "Action shift" alert card (tertiary tint) | Simulator | |
| Two-up image comparison cards | Simulator | |

### 5.2 Specified in DESIGN.md but **not** present in any export

Form inputs with persistent labels (48 px, focus ring `#10B981`/3 px tint), checkboxes and radios (20 px with 48 px wrapper), **Mandi Arbitrage Card** (split-column local vs regional with freight deduction; closest analogue: comparison card), **Commodity Holding Horizon Gauge** (15 / 30 / 60-day multi-step risk bar), secondary outlined button style (1.5 px border), AI-trigger button style (emerald on `#ECFDF5` with lime glow), AI confidence chip (dark capsule with lime glyph).

### 5.3 Needed for nationwide, all-crop scope but **not designed anywhere**

Status after Batch 2:

| Needed | Status |
|---|---|
| State selector | ⚠️ pills + dropdown trigger designed (markets); **dropdown/sheet content not designed** |
| District and mandi cascading selector | ❌ not designed |
| Commodity catalogue with search and categories | ✅ designed (commodities); varieties ❌ |
| Eligibility/availability badges | ⚠️ legend designed (commodities); per-granularity badge ❌ |
| "Last reported price + reporting date" indicator | ⚠️ reporting-time strip designed (markets), but wording is "live" |
| Forecast panel with uncertainty band and horizon selector | ✅ designed (forecast) |
| Backtest metrics panel | ❌ (only a one-line fabricated note) |
| Stale / missing / unsupported states | ❌ not designed anywhere |
| Data-source/provenance disclosure | ⚠️ tags only (e-NAM, Govt APMC) |
| Crop/mandi change sheet (forecast "Change") | ❌ |
| Registration/login, alerts list, feedback form, profile/settings | ❌ |
| Empty, loading and error skeletons | ❌ |
| Desktop navigation rail and multi-column layouts | ❌ |

---

## 6. Proposed design tokens (documentation only)

This is a **proposed** structure for Phase 7 (CSS variables consumed by a Tailwind theme). Nothing is created now.

```text
tokens/
  color
    surface.{canvas, container-lowest..highest, dim, variant}
    text.{primary, secondary, inverse}            # on-surface, on-surface-variant, inverse-on-surface
    border.{default, subtle}                      # outline-variant, outline @ alpha
    brand.{primary, primary-container, on-primary, secondary, secondary-container}
    accent.{ai, logistics}                        # lime / sky: only if retained
    status.{success, warning, danger, info}       # + .bg and .text variants (replaces raw amber/emerald)
    risk.{low, medium, high}                      # semantic risk, text-and-icon alternatives required
    data.{observed, forecast, scenario, demo, stale}   # PROJECT.md §11.2 labels
    chart.{1..6}                                  # categorical series colours
  typography
    family.{display, body, metric}                # Plus Jakarta Sans, Plus Jakarta Sans, Inter (+ Noto Sans Devanagari)
    scale.{display, headline-lg..sm, metric-xl..md, body-lg..sm, label-md..xs}
    numeric.tabular                               # font-variant-numeric: tabular-nums
  space      xs sm md lg xl, gutter, margin       # 4/8/16/24/40, 16 mobile / 24 desktop
  radius     sm md lg xl full                     # reconcile naming with DESIGN.md
  elevation  0 1 2 3                              # the tinted shadows in §4.4
  breakpoint sm 640, lg 1024, 2xl 1600            # DESIGN.md grid
  size       touch-min 48, nav-rail 260, header 64, tabbar 64
  motion     press-scale 0.98, duration-fast/base, reduced-motion respected
```

**Rules to adopt:** one source of truth for colour; semantic tokens not raw palette names; observed/forecast/scenario/demo each have a distinct token plus a text label; no meaning conveyed by colour alone.

---

## 7. Design and accessibility issues found (to fix in Phase 7, not now)

| # | Issue | Evidence |
|---|---|---|
| 1 | Pinch-zoom disabled | `user-scalable=no, maximum-scale=1.0` in all four |
| 2 | No `<title>`, `lang="en"` only | all four; Hindi/Marathi content has no `lang` markup |
| 3 | Missing Devanagari font fallback | DESIGN.md requires it; none loaded |
| 4 | Touch targets below 48 px | language toggle 28 px, small CTAs |
| 5 | Form controls lack labels | allocation sliders, copilot input |
| 6 | Charts have no text alternative | all SVG charts |
| 7 | Colour carries risk meaning | some risk indicators pair colour with text/emoji (good), others colour only |
| 8 | Nested `<main>` | comparison |
| 9 | Dead links `href="#"` | all nav items |
| 10 | Small 9–11 px text for critical values | label-xs and arbitrary sizes |
| 11 | Dark mode configured, unused | `darkMode: "class"`, no `dark:` classes |
| 12 | No reduced-motion handling | continuous `animate-ping/pulse/bounce/spin` |
| 13 | **Misleading data labels** | "Live Feed • 12m ago", "Live Engine", "Live NH-60", "APMC Live Data: 4 mins ago", "96% Confidence", "94% High Confidence", "Verified APMC API Model" next to "Illustrative Demo Data" |

### Additional issues found in Batch 2

| # | Issue | Evidence |
|---|---|---|
| 14 | **More unsupported live/verified language** | "3,240+ Live", "Real-time price discovery", "Agmarknet & e-NAM Live", "8m ago", "Live Modeler", "Live Sensitivity", "Verified Lot #MP-492", "APMC Calibrated", "Real-time Factors" |
| 15 | **Fabricated model metrics** | "Prophet + Ensemble v3.2 • 93% Backtested", "WAPE 4.2%", "AI Reliability 92%", "94% / 89% / 91% Fit" |
| 16 | **Colour-only meaning** | forecast driver dots, coverage-bar tiers, delta arrows without text in some cards |
| 17 | **Checkboxes, search inputs and sliders without labels** | markets, commodities, simulator |
| 18 | **Static text that disagrees with scripted output** | simulator: markup "₹4,51,600" vs rendered "₹4,42,502" |
| 19 | **Invalid/unused utilities** | `py-0.2`, `h-13`, duplicate `<style>` |
| 20 | **Tabular numerals used once** | simulator only; all price text elsewhere is proportional |
| 21 | **Map not a map** | hand-drawn silhouette, markers off true position |
| 22 | **Navigation ignores new screens** | five fixed tabs; Forecast, Commodities, Simulator unreachable |

Item 13 matters most for FASALYTICS: PROJECT.md forbids false live-data claims, and the datasets are historical. These labels must be replaced by real reporting-date and eligibility information.
