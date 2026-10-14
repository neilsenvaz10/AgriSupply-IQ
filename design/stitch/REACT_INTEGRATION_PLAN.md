# FASALYTICS — React Integration Plan (Phase 7)

> **Milestone 4 deliverable. Planning only.** React, Vite and Tailwind have **not** been initialised. No component was converted.
> Inputs: `SCREEN_MAP.md`, `DESIGN_SYSTEM.md`, `MISSING_SCREENS.md`, `PROJECT.md` §11.4.
> **Scope (updated):** all **eight** exports: Batch 1 (dashboard, comparison, allocation, copilot) and Batch 2 (forecast, commodities, market explorer, simulator). Batch 2 currently lives in `design/stitch/new-exports/`; before Phase 7 it should be preserved immutably alongside `original/`.
> Rule from PROJECT.md: the Stitch exports are the primary visual reference; do **not** redesign them. Originals in `design/stitch/original/` are immutable.

---

## 1. Principles

1. **Visual fidelity first, honest behaviour second.** Reproduce layout, colour, type and spacing; replace every hardcoded value and fake action with real data or an explicit disabled state.
2. **One computation source.** Dashboard, comparison, allocation and assistant must show identical numbers because they read the same API response (the exports contradict each other).
3. **Data-driven geography and commodities.** No state, mandi or crop appears in code, routes or copy.
4. **Everything labelled.** Each figure carries granularity, reporting date and observed/forecast/scenario/demo status.
5. **Browser talks only to Express.** Never to PostgreSQL, FastAPI or Groq directly.

---

## 2. Component architecture

Folder layout follows PROJECT.md §11.4.3 (under `apps/web/src/`):

```text
app/            router, providers, error boundary
layouts/        AppShell, TopBar, BottomTabBar, SideRail (desktop)
components/ui/  Button, Chip, Pill/RiskPill, Card, Input, Slider, Tabs, Toast, Skeleton, EmptyState, Banner
components/data/ DataBadge (granularity), FreshnessChip, TierBadge, SourceNote, UnitValue (₹/quintal)
components/charts/ PriceSeriesChart, ForecastBand, ArrivalBars, Donut, BarCompare, Sparkline (+ table alternative)
features/
  geography/    StateSelect, DistrictSelect, MandiSearch, LocationChip
  commodity/    CommodityPicker, VarietySelect, CommodityChip
  forecast/     ForecastPanel, HorizonSelector, BacktestMetrics, UnavailableReason
  compare/      MandiCard, ComparisonTable, AssumptionsDrawer, SortChips
  risk/         RiskSignalList, RiskPill, StaleWarning
  allocate/     StrategyToggle, AllocationDonut, AllocationSlider, LedgerRow, ExplanationList
  assistant/    ChatThread, MessageBubble, ToolResultCard, PromptChips, VoiceToggle
  simulate/     ScenarioControls, DeltaSummary
pages/          one per route
services/api/   typed client, endpoint modules, error mapping
styles/         tokens.css (from DESIGN_SYSTEM.md §6)
locales/        en, hi, mr (extensible)
```

### Mapping from existing exports

| Stitch pattern (file) | Becomes |
|---|---|
| Header + EN/हि/म toggle (all) | `TopBar`, `LanguageSwitch` |
| Bottom tab bar (all) | `BottomTabBar` (+ `SideRail` on desktop) |
| Commodity chips (dashboard) | `CommodityChip` list driven by selected + recent commodities |
| Hero recommendation card (dashboard) | `RecommendationCard` (variants: recommended / unavailable / stale) |
| Mini + full donut (dashboard, allocation) | `Donut` |
| Mandi cards (dashboard, comparison) | `MandiCard` (compact and rich variants) |
| Comparison table / bars (comparison) | `ComparisonTable`, `BarCompare` |
| Action tray + toast (comparison) | `ActionTray`, `Toast` (actions only where a real service exists) |
| Strategy toggle + sliders + ledgers (allocation) | `StrategyToggle`, `AllocationSlider`, `LedgerRow` |
| Chat bubbles / answer card / prompts (copilot) | `MessageBubble`, `ToolResultCard`, `PromptChips` |
| Risk / status pills (all) | `RiskPill`, `Pill` |
| Horizon segmented control (forecast) | `HorizonSelector` (also base for `StrategyToggle`, `SortChips`) |
| Hero price + band, trajectory chart, daily snap cards (forecast) | `ForecastHero`, `ForecastBand` chart, `DayCard` list |
| Driver list (forecast) | `DriverList` (icon + text, evidence link) |
| Method note (forecast) | `MethodNote` fed by API metadata |
| Category chips with counts, search (commodities) | `CategoryChips`, `SearchField` |
| Spotlight card, commodity card (commodities) | `CommoditySpotlight`, `CommodityCard` with `TierBadge` |
| Readiness legend (commodities) | `TierLegend` |
| State pills + dropdown pair (markets) | `StatePills`, `GeographySelect` |
| Mandi hub card with checkbox (markets) | `MandiHubCard` (selectable) |
| Coverage bar (markets) | `CoverageBar` |
| Map card (markets) | `MapPanel` (provider decision pending) |
| Baseline lot card, lever slider, impact card, waterfall (simulator) | `BaselineCard`, `LeverSlider`, `DeltaSummary`, `Waterfall` |

---

## 3. Routing

Routes are generic. Selections live in the URL (shareable, back-button safe), never encoded as place or crop names.

| Route | Screen | Notes |
|---|---|---|
| `/` | Landing (P2) | optional |
| `/login`, `/register` | Auth (P1) | guest allowed |
| `/dashboard` | Farmer dashboard | |
| `/markets` | Market Explorer | `?state=<id>&district=<id>&q=` |
| `/markets/:marketId` | Market detail | `?commodity=<id>` |
| `/commodities` | Catalogue | optional if picker is inline |
| `/forecast` | Forecast | `?commodity=<id>&market=<id>&h=1..7` |
| `/compare` | Mandi comparison + net return | `?commodity=<id>&qty=<q>&origin=<id>&markets=<id,id,id>` |
| `/allocate` | Harvest allocation | same selection keys |
| `/risk` | Risk intelligence | `?commodity&market` |
| `/simulate` | What-if | `?baseline=<runId>` |
| `/assistant` | AI assistant | |
| `/alerts`, `/feedback`, `/profile` | P1 screens | |

### 3.1 Navigation for eight screens

The exports' five-tab bar (Dashboard · Mandis · Allocate · AI Copilot · Profile) cannot reach Forecast, Commodities or Simulator. **Proposal (needs your approval):**

| Entry point | Destination | Reached from |
|---|---|---|
| Tab **Dashboard** | `/dashboard` | bottom bar |
| Tab **Markets** (current "Mandis") | `/markets` (explorer) | bottom bar |
| Tab **Plan** (current "Allocate") | `/compare` → `/allocate` → `/simulate` as a stepper | bottom bar, centre action |
| Tab **Copilot** | `/assistant` | bottom bar |
| Tab **Profile** | `/profile` | bottom bar |
| Commodities | `/commodities` (opened as the commodity picker) | any commodity chip, Markets, Dashboard |
| Forecast | `/forecast` | a market or commodity detail, Dashboard card, Plan stepper |
| Simulator | `/simulate` | Plan stepper, Copilot, comparison |

Alternatively add a sixth item or use a "More" sheet; keep the five-tab visual pattern from the exports either way.

**Screen flow:** Commodity picker → Market Explorer (or Dashboard) → Forecast → Compare → Allocate → Simulate; the Copilot is reachable from every step with the current selection as context.

**Identifiers** are opaque canonical IDs (UUID/slug) from the registries, never display names, because mandi names repeat across states. React Router v6 (data router) is sufficient. Unknown or ineligible selections render a typed "unavailable" view, not a 404.

---

## 4. State management

Keep it small: **no global store library initially.**

| State | Where | Notes |
|---|---|---|
| Selected commodity / state / district / mandi / date range / horizon / comparison picks | **URL search params** (single source of truth), parsed by one `useSelection()` hook | Shareable; survives reload |
| Harvest quantity, origin, risk tolerance, cost assumptions | URL where small; otherwise `useReducer` in a `PlanContext` | Persist drafts to `localStorage` (non-sensitive) |
| Server data (prices, forecasts, comparisons, allocations) | A thin typed fetch layer with request de-duplication (custom hook, or TanStack Query if approved later) | Each response carries `as_of`, `source`, `granularity`, `tier` |
| Freshness | Derived from response metadata, never from the client clock alone | Drives `FreshnessChip` and stale banners |
| Loading / error | Per-request state with a standard shape `{status, data, error}` | Skeletons, retry, mapped error codes |
| Auth/user | `AuthContext` (Firebase) | Token attached by API client |
| Language | `LocaleContext` | Persist preference |

**Approval note:** TanStack Query would remove boilerplate, but no library is added until you approve it.

---

## 5. API integration boundaries

All calls go **browser → Express (`/api/v1`) →** PostgreSQL / FastAPI / Groq.

| Screen | Express endpoint (PROJECT.md §5.5) | Behind it |
|---|---|---|
| Geography / commodity pickers, Explorer | `GET /commodities`, `GET /markets` (+ future `/states`, `/districts`) | PostgreSQL registries |
| History | `GET /prices` | PostgreSQL market observations |
| Forecast | `POST /forecasts` | FastAPI intelligence service |
| Risk | `POST /risks` | FastAPI + PostgreSQL |
| Comparison / net return | `POST /compare` | Express cost engine + FastAPI forecasts |
| Allocation | `POST /allocate` | FastAPI optimiser |
| What-if | `POST /scenarios` | Express + FastAPI (reuses compare/allocate) |
| Assistant | `POST /chat` | Express → Groq with validated tool registry |
| Feedback | `POST /feedback` | PostgreSQL |
| Health/status | `GET /health` | n/a |

### Per-screen dependency summary (all eight)

| Screen | Express calls | Needs from backend |
|---|---|---|
| Dashboard | `/markets`, `/forecasts`, `/compare` | Registries, latest reported price + date, top-N eligible mandis, tier |
| Compare | `/compare`, `/prices` | Cost engine, routing/distance, risk, per-mandi freshness |
| Allocate | `/allocate` | Optimiser, constraints, baseline |
| Copilot | `/chat` | Tool registry (Groq), tool-result cards, citations |
| **Forecast** | `/forecasts`, `/prices`, `/commodities`, `/markets` | Point + interval, horizon 1–7, `model_version`, `generated_at`, `last_observed_date`, backtest metrics, tier, unavailable reason |
| **Commodities** | `/commodities`, `/markets` (availability counts) | Categories, varieties, per-commodity coverage/eligibility, latest reported price + date |
| **Markets** | `/markets`, `/prices` | States, districts, mandi registry with canonical IDs, availability by granularity, source, reporting time, coverage summary |
| **Simulator** | `/scenarios` | Stored baseline, bounded parameters, recalculated result and deltas, assumptions list |

**Contract requirements for the front end:** every payload includes `as_of`, `source`, `granularity`, `tier`, `warnings[]`, `request_id`; errors use a stable code set (`INSUFFICIENT_DATA`, `STALE_DATA`, `UNSUPPORTED_COMBINATION`, …). Secrets (Groq, provider keys) never reach the browser; only `VITE_*` values do.

---

## 6. Conversion workflow (per screen)

Follows PROJECT.md §11.4.2, one screen at a time. **Recommended order for the eight screens** (dependencies first):

1. App shell + tokens + shared pills/cards (no data)
2. **Commodity picker / catalogue** and **geography selectors** (needed by everything)
3. **Market Explorer** (uses the pickers; first real data screen: registries + prices)
4. **Forecast** (first screen that needs the ML service)
5. **Compare** (cost engine)
6. **Allocate** (optimiser)
7. **Simulator** (reuses compare + allocate via `/scenarios`)
8. **Dashboard** (aggregates the above)
9. **Copilot** (last: depends on stable tools)

Phase 7 must not start until the Phase 2–6 services these screens call exist or are replaced by clearly labelled fixtures.

1. Re-read `SCREEN_MAP.md` entry and screenshot; list required states (loading, empty, error, stale, unavailable).
2. Create tokens in `tokens.css` (once) and map them into the Tailwind theme.
3. Convert HTML to TSX: `class`→`className`, `for`→`htmlFor`, inline style objects, remove DOM scripting in favour of state/effects, stable keys.
4. Swap hardcoded values for typed props; no literal ₹ values, places or crops remain.
5. Wire to the API client; add all states.
6. Replace every inert control: **works, or disabled with an explanation** (PROJECT.md §11.4.2 step 9).
7. Visual-parity check against the original screenshot; record intentional deviations.
8. Accessibility pass.

### Controls that must **not** be reproduced as-is

| Original control | Reason | Replacement |
|---|---|---|
| "Lock Freight & Slot", "Lock Rate & Route", "Book Nashik Freight" | Implies a booking service and a fabricated driver/vehicle | Disabled with "Booking not available" or a plain "Save plan" |
| "Generate Mandi Gate Passes" (QR) | No such system | Remove, or export a plan summary |
| "Call Desk" / "Fasal Mandi Desk" | No support service defined | Remove until one exists |
| "Verified Transporters Ready", "4 Mini-Trucks Available" | Unverified claims | Remove |
| "Live Feed • 12m ago", "Live Engine", "APMC Live Data" | Data are historical until a recent feed exists | `FreshnessChip` showing reporting date |
| "94% / 96% Confidence", "Yield Engine v4.2" | No calibrated meaning | Interval/uncertainty and model version from the API |
| Photo-attach in chat | No image analysis | Remove |
| "3,240+ Live", "Live Market Hubs", "Agmarknet & e-NAM Live", "Real-time price discovery" | Historical data, no live feed | Reporting-date badge and "Latest reported" wording |
| "Prophet + Ensemble v3.2 • 93% Backtested", "WAPE 4.2%", "% Fit", "AI Reliability" | Fabricated | Model version and real backtest metrics from the API, or hidden |
| "Verified Lot #…", "APMC Calibrated" | No verification exists | Remove |
| Mandi-level arrival ("Agmarknet: 5,400 Qtl") | Arrivals exist only at state level | Show state-level arrival labelled as such, or hide |
| "Set Price Alert at ₹2,800+" | No alert service yet | Disabled until alerts exist |
| "Compare Selected Mandis (3)" with mixed commodities | Not a valid comparison | Enforce one commodity per comparison |
| Simulator presets ("Hold 5 Days" = +3%) | Invented forecast | Preset names only; values from forecast + assumptions |
| "Run Full Multi-Mandi Optimization" | Needs allocation API | Link to `/allocate` with the scenario |
| Hand-drawn India map | Not a map | Real map provider or a list/table view |
| Hardcoded "Verified APMC API Model" footer | Contradicts demo disclaimer | Remove |

---

## 7. Visual fidelity approach

| Topic | Plan |
|---|---|
| Reference | `screen.png` per screen (low-resolution: 224–352 px wide full-page captures, so also use the HTML rendered in a browser as the pixel reference) |
| Viewports | **390 px** mobile and **1440 px** desktop; additionally 768 px for the tablet grid |
| Mobile | Match the existing exports closely (they are the design) |
| Desktop | **Not provided by Stitch.** Build from DESIGN.md (260 px rail, 12-column grid, max 1600 px) with the same tokens; record these as new layouts |
| Comparison method | Side-by-side screenshots (original HTML vs React) per viewport; log intentional deviations in `SCREEN_MAP.md` |
| Fidelity vs correctness | Where an export is wrong (nested `<main>`, `user-scalable=no`, 28 px targets, missing labels) fix it and record the deviation |
| Fonts | Self-host Plus Jakarta Sans, Inter, Noto Sans Devanagari and Material Symbols (verify licences) |
| Icons | Material Symbols via package or subset; keep glyph names from the exports |
| Motion | Keep press-scale and transitions; remove perpetual `ping/pulse/bounce` or gate by `prefers-reduced-motion` |

### Accessibility checklist

Pinch-zoom enabled · page `<title>` and `lang` per locale · 48 px targets · labelled form controls and sliders · chart text alternatives (data table) · risk shown by text+icon, not colour alone · keyboard operation and visible focus · screen-reader announcements for async results · contrast verified for amber/emerald accents.

---

## 8. Asset handling

| Dependency in exports | Production plan |
|---|---|
| `cdn.tailwindcss.com` (Play CDN, runtime compiler) | Replace with build-time Tailwind (Milestone 5); theme generated from tokens |
| Google Fonts (Inter, Plus Jakarta Sans) | Self-host via package or downloaded files; check OFL licences; preload |
| Material Symbols (Google Fonts) | Package or subset; self-host |
| `lh3.googleusercontent.com` images (logo, avatars, photos, map) | **Not stored locally; cannot be relied on.** Obtain the logo as a project asset; photos/avatars are illustrative and must be replaced with licensed assets or removed; the map card needs a real map provider decision (licensing/cost) |
| Inline scripts | Rewritten as React logic |

Per this milestone's rules: **nothing was downloaded or replaced.** Asset licences and the logo source must be confirmed before copying anything into the app.

---

## 9. Risks and open decisions

| # | Item | Needs |
|---|---|---|
| 1 | Missing P0 screens (explorer, catalogue, forecast, what-if) | Generate in Stitch or approve in-house design |
| 2 | No desktop designs | Approve building desktop layouts from DESIGN.md |
| 3 | Image/logo licensing and source | Obtain originals/confirm rights |
| 4 | Server-state library | Approve TanStack Query or stay with custom hooks |
| 5 | Token naming reconciliation (palette and radius) | Decide canonical palette (DESIGN_SYSTEM.md §2.4) |
| 6 | Map provider | Decide, or defer the map card |
| 7 | Chart library | PROJECT.md specifies Recharts; confirm it can meet the SVG fidelity of the exports |
| 8 | Current-data feed (Phase 2) | Without recent data, "current recommendation" screens must stay disabled/qualified |
| 9 | Batch 2 location (`design/stitch/new-exports/`, not `design/stitch/`) | Decide whether to move it under `design/stitch/` and mark immutable |
| 10 | Navigation for eight screens | Approve §3.1 proposal |
| 11 | Revision of Batch 2 screens (district level, unavailable states, honest labels) | Approve in-house revision vs regenerate in Stitch |
| 12 | Single eligibility vocabulary (Forecast Qualified / Exploratory vs Full / Limited / State-Level / Insufficient) | Agree names; keep state-vs-mandi distinction |
