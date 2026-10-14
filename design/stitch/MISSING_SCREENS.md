# FASALYTICS — Missing Screens and Nationwide / All-Crop UX Gaps

> **Milestone 4 deliverable. Identification only.** No screen was generated or designed here.
> **Baseline (updated for Batch 2):** **eight** mobile HTML exports: dashboard, mandi comparison, harvest allocation, AI copilot (Batch 1) plus AI Price Forecasting, Explore Commodities, Nationwide Market Explorer, What-If Simulator (Batch 2, in `design/stitch/new-exports/`) and `DESIGN.md`. See `SCREEN_MAP.md`.
> **Priority scale:** **P0** essential for the core demo · **P1** important supporting · **P2** optional.
> Several features are intentionally merged into one route where that gives a better user flow.

---

## 1. Coverage summary

| Result | Before Batch 2 | **Now** | Screens |
|---|---:|---:|---|
| Export exists (mobile mock-up, with defects) | 4 | **8** | Dashboard, comparison, allocation, AI assistant, **forecast, commodity catalogue, market explorer, what-if simulator** |
| Partially covered inside an existing export | 6 | **3** | Net return (inside comparison), risk (pills/KPIs), weather (banner text) |
| No export at all | 10 | **8** | Landing, auth, historical analytics, Fair Price Card, crowd insights, alerts, feedback, profile |

"Partially covered" means a fragment appears within a screen but there is no dedicated, data-capable design.

**What Batch 2 changed:** all four P0 gaps named last time (Market Explorer, Commodity catalogue, Forecast, What-if) now have an export. **What it did not change:** all eight screens are still **mobile only**, still use **fixed sample content**, still have **no loading/empty/error/stale states**, and none shows the **capability tier by granularity** or a true **last reported date** consistently. Several new screens add unsupported "live/real-time/verified" claims and fabricated accuracy numbers (see `SCREEN_MAP.md` §6–7).

---

## 2. Screen gap table

| # | Screen | Purpose | Export exists? | Complete? | Priority | Key UI components | Nationwide / all-crop requirement | Proposed route | Recommended next action |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Landing page** | Explain value, entry to app | ❌ | n/a | P2 | Hero, how-it-works, language toggle, CTA | Neutral copy (no state/crop examples hardcoded); honest "historical data" framing | `/` | Defer; reuse brand tokens. Not needed for a functional demo. |
| 2 | **Login & registration** | Phone-OTP sign-in, optional guest | ❌ | n/a | P1 | Phone input, OTP, language, guest option | State/district chosen *after* sign-in from registries, not typed free text | `/login`, `/register` | Design after core flow; guest mode may suffice for the demo. |
| 3 | **Farmer dashboard** | Home summary | ✅ | ⚠️ Partially | P0 | Location chip, commodity chips, recommendation card, trajectory, top-3 mandi, allocation teaser | Commodity/location from selectors; freshness chip; tier-aware ("forecast unavailable") states; no fixed crop list | `/dashboard` | Keep as visual base; add state/loading/stale variants and a freshness indicator. |
| 4 | **Nationwide Market Explorer** | Browse markets by state → district → mandi | ✅ **Batch 2** (`nationwide_market_explorer`) | ⚠️ Partially | **P0** | State pills + dropdown, crop dropdown, search, mandi cards with reporting time and source tag, coverage bar, compare selection | Has state and crop but **no district level**; cross-commodity multi-select; "Live" language; map not accurate; needs availability badge (mandi / state / none) and last-reported date | `/markets` | **Revise in Stitch:** add district, mandi disambiguation, single-commodity selection, availability + date chips, remove "Live". |
| 5 | **Commodity catalogue** | Pick any commodity/variety | ✅ **Batch 2** (`all_crop_commodity_explorer`) | ⚠️ Partially | **P0** | Search, category chips with counts, spotlight, commodity cards, readiness legend, CTA | Best match to eligibility tiers; lacks variety list, per-state availability, selected state, empty/loading; fabricated "% fit/AI reliability"; fixed six cards | `/commodities` (or inline picker) | **Revise:** selection state, variety drill-down, tier badge from rules (no %), per-granularity availability; also extract a reusable **picker**. |
| 6 | **Historical price analytics** | Explore history, volatility, seasonality | ❌ (a mini sparkline exists) | n/a | P1 | Line chart with date range, min/max/modal toggle, arrivals bars (state-level labelled), table alternative, data-gap markers | Series labelled by granularity (mandi / state / national); gaps shown, never interpolated | `/markets/:marketId/history` (query: `commodity`) | Design after explorer. |
| 7 | **Price forecasting** | 1–7-day forecast with uncertainty | ✅ **Batch 2** (`ai_price_forecasting`) | ⚠️ Partially (happy path only) | **P0** | Horizon tabs, hero price + band, trajectory chart, 7-day cards, drivers, method note | Good structure; needs unavailable / stale / insufficient-data variants, real interval definition, generated-at and last-observed dates, honest metrics, selector flow for crop/mandi | `/forecast` | **Revise:** add unavailable and stale states, replace badges with API metadata, design the "Change" selector sheet. |
| 8 | **Mandi comparison** | Rank ≥ 3 mandis by net return | ✅ | ⚠️ Partially | **P0** | Ranked cards, cost breakdown, risk, table, sort chips | Cross-district and cross-state mandis; distance/transport assumptions editable and labelled; per-mandi data freshness; handles fewer than 3 eligible mandis | `/compare` | Keep as visual base; add assumption editor, freshness and "insufficient data" states. |
| 9 | **Net return calculator** | Show full cost build-up, editable assumptions | ⚠️ Fragment (cost grid inside comparison) | ❌ | P0 (merge with 8) | Quantity, transport cost, fees, spoilage inputs with units; formula breakdown | Costs are *assumptions* unless verified; unit labels (₹/quintal) | Merged into `/compare` (assumptions drawer) | Fold into the comparison screen as an expandable panel. |
| 10 | **Risk intelligence** | Explain price, supply and freshness risk | ⚠️ Fragments (risk pills, crash-risk KPI) | ❌ | P1 | Risk signal list with evidence, severity chips with icon+text, stale-data warnings | Signals only where data supports them (e.g. state-level supply pressure labelled as state-level) | `/risk` | Design a risk panel reusable on forecast and allocation screens. |
| 11 | **Weather intelligence** | Weather and road-risk context | ⚠️ Fragment (alert banner) | ❌ | P2 | Forecast summary, issue time, route exposure | Optional; only with a verified provider; no causal claims | `/weather` (or panel) | Defer. |
| 12 | **Smart harvest allocation** | Optimised multi-mandi split | ✅ | ⚠️ Partially | **P0** | Strategy toggle, donut, sliders, ledgers, explanation | Any eligible mandis (≥ 2) chosen from the comparison; constraint-respecting sliders (sum = 100%); baseline vs optimized; no invented capacity | `/allocate` | Keep as base; redesign sliders to be constrained and solver-backed. |
| 13 | **Crowd-aware market insights** | Supply-pressure indicator | ❌ | n/a | P1 | Arrival trend vs baseline, pressure chip, scope label | **Must state granularity**: state-level proxy, never "farmers heading to this mandi" without data | Panel on `/compare` and `/markets/:id` | Design as a small component with a mandatory scope label. |
| 14 | **Fair Price Card** | Indicative price band | ❌ | n/a | P1 | Min/modal/max, recent distribution, as-of date, disclaimer | Not shown if no recent mandi data; never called MSP or "fair" without definition | `/fair-price` (or card in explorer) | Design as a card; show only when data qualifies. |
| 15 | **AI assistant** | Grounded Q&A and explanations | ✅ | ⚠️ Partially | **P0** | Chat, structured result cards, prompt chips, voice | Tool-grounded; every figure carries source/date; unavailable data answered honestly; prompts generated from context, not fixed crops | `/assistant` | Keep as visual base; add tool-result cards, citations, error states. |
| 16 | **What-if simulator** | Scenario recalculation | ✅ **Batch 2** (`what_if_market_simulator`) | ⚠️ Partially | **P0** | Baseline lot, presets, three sliders, baseline vs simulated, waterfall, alert, comparison cards | Implements transport / price / hold scenarios; but hardcoded model, price lever on net, presets invent a +3% rise, no selectors, static legend and alert | `/simulate` (or panel on `/compare`) | **Revise:** drive from a server-computed baseline, apply price to gross, remove invented presets, add scenario-source labels and selection of the plan. |
| 17 | **Alerts & notifications** | Price/risk alerts | ❌ | n/a | P1 | Alert list, subscription form, thresholds, opt-out | Subscribe by commodity + location; consent flow | `/alerts` | Design after core; the header bell already exists. |
| 18 | **Farmer feedback** | Record realised sale | ❌ | n/a | P1 | Quantity, price, market, date, comparison to prediction | Free commodity/market selection; self-reported labelled | `/feedback` (or `/history`) | Design after core. |
| 19 | **Profile & settings** | Profile, language, defaults, consent | ❌ | n/a | P1 | Name, home location (state→district), default commodities, language, privacy | Home location via the same cascading selector; tab "Profile" already points here | `/profile` | Design with auth. |
| 20 | **Multilingual & accessibility UI** | Language switch and accessible controls | ⚠️ Fragment (EN/हि/म toggle, visual only) | ❌ | P1 | Language selector, font-size control, voice toggle, high-contrast option | Extensible beyond three languages; Devanagari fallback; number formatting (₹, lakh/crore) | Global component | Specify as a shell feature; not a page. |

---

## 3. Priority classification

### P0 — essential for the core demo (status after Batch 2)
| # | Screen | Export | Remaining design work |
|---|---|---|---|
| 1 | Nationwide Market Explorer | ✅ Batch 2 | District level, mandi disambiguation, availability/date chips, single-commodity compare |
| 2 | Commodity catalogue / picker | ✅ Batch 2 | Selection state, varieties, tier by rule, per-geography availability |
| 3 | Forecast | ✅ Batch 2 | Unavailable / stale / insufficient-data variants, real metadata, selector sheet |
| 4 | Mandi comparison + net return | ✅ Batch 1 | Assumptions drawer, freshness chips, <3-mandi state, consistent numbers |
| 5 | Smart harvest allocation | ✅ Batch 1 | Constrained sliders, baseline vs optimized, remove invented claims |
| 6 | AI assistant | ✅ Batch 1 | Tool-result cards, citations, error states |
| 7 | What-if simulator | ✅ Batch 2 | Server baseline, gross-based price lever, remove invented presets |
| 8 | Farmer dashboard | ✅ Batch 1 | Dynamic selectors, freshness, tier-aware states |

**All P0 screens now have at least one export.** The remaining P0 work is *revision and states*, not new screens.

### P1 — important supporting
Login/registration, historical analytics, risk panel, crowd-aware insight component, Fair Price Card, alerts, feedback, profile/settings, language/accessibility shell.

### P2 — optional
Landing page, weather intelligence.

### Most important missing pieces for a functional hackathon demonstration
1. **Cascading location selector** with district level (not designed anywhere; the explorer has only state).
2. **Unavailable / stale / insufficient-data states** for forecast, comparison and dashboard (the key honesty feature; absent in all eight).
3. **A defined navigation** that exposes Forecast, Commodities and Simulator (the bottom bar has five fixed items).
4. **Desktop layouts** (none exist).
5. **Profile** screen (linked in the nav, not exported).

The two explorers now give the platform a place to demonstrate "nationwide, all-crop", but only if their data comes from the registries and shows availability by granularity.

---

## 4. Nationwide / all-crop requirements by screen

The recurring requirements every new or extended screen must satisfy:

| Requirement | Applies to |
|---|---|
| Geography from registries: state → district → mandi (never free text), duplicate mandi names disambiguated | Explorer, dashboard, comparison, allocation, profile |
| Commodity and variety from a dynamic catalogue with search | All data screens |
| Show **granularity** (mandi / state / national) on every number | Explorer, history, risk, crowd insight |
| Show **reporting date** ("Latest reported price, as of …") and **staleness** | All data screens |
| Show **capability tier / eligibility** and a reason when forecasts are unavailable | Forecast, dashboard, comparison, assistant |
| Distinguish **Observed / Forecast / Scenario / Demo** visually and in text | Charts and cards everywhere |
| Handle < 3 eligible mandis gracefully | Comparison, allocation |
| Responsive: mobile-first **and** desktop (currently mobile only) | All |
| Hindi/Marathi (and extensible) text expansion, Devanagari fonts, ₹ and lakh/crore number formatting | All |
| No hardcoded places or crops in copy, prompts, or sample data | All |

---

## 5. Recommended sequence (design/Stitch work before Phase 7)

1. Cascading **location selector** (state → district → mandi) and finalise the **commodity picker** component (used everywhere).
2. Revise **Market Explorer** (district, availability, single-commodity selection).
3. Add **unavailable / stale / insufficient** variants to **Forecast**.
4. Extend **comparison** with assumptions drawer and freshness/eligibility chips; align numbers with dashboard.
5. **Allocation** with constrained sliders and baseline comparison.
6. Revise **What-if** (server baseline, gross-based lever).
7. Decide **navigation** for the eight screens (see `REACT_INTEGRATION_PLAN.md` §3).
8. Desktop layouts (DESIGN.md already defines the 260 px rail and 12-column grid).
9. P1 screens as time permits.

> **Action needed from the team:** (a) approve revising the Batch 2 screens in Stitch or in-house against the same tokens, (b) generate the location-selector and unavailable-state variants, (c) decide the navigation structure, **before** Phase 7. Per `PROJECT.md §11.4`, any added screen must reuse the same design system and be labelled as new.
