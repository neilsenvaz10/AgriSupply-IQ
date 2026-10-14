# FASALYTICS — Stitch Screen Map

> **Milestone 4 deliverable.** Inventory and analysis only. No screen has been converted to React.
> **Source of truth for visuals:** the preserved originals in `design/stitch/original/` (immutable) and the second batch in `design/new-exports/` (see §1.1).
> **Analysed:** 14 October 2026 by reading every export's source and screenshot. **Batch 1** (4 screens) in `original/`; **Batch 2** (4 screens) added the same day.
> A static Stitch export is **not** a working screen. Nothing below is marked implemented.

**Eight screens now exist** (two batches of four). Batch 2 closes four of the P0 gaps listed in `MISSING_SCREENS.md`, but it is built on the same mobile-only shell and repeats the same classes of defect (hardcoded values, unsupported "live/verified" claims).

---

## 1. Preservation record

| Item | Value |
|---|---|
| Original location (before) | `stitch_fasalytics_agritech_intelligence_platform/` (repo root) |
| Preserved location (now) | `design/stitch/original/stitch_fasalytics_agritech_intelligence_platform/` |
| Files | 9 (4 × `code.html`, 4 × `screen.png`, 1 × `DESIGN.md`) |
| Total size | 1,148,569 bytes (≈ 1.1 MB) |
| Move method | Directory move on the same volume; internal structure and filenames unchanged |
| Verification | SHA-256 of every file computed before and after the move; **9/9 identical**, 0 missing, 0 extra, 0 overwritten |
| Unclassified files | None |

### File inventory and checksums

All paths are relative to `design/stitch/original/stitch_fasalytics_agritech_intelligence_platform/`.

| # | Path | Ext | Bytes | SHA-256 | Screen / component | Purpose |
|---|---|---|---:|---|---|---|
| 1 | `agriintelligence_market_risk_system/DESIGN.md` | .md | 12,030 | `C38B67CFE7FAD0A1D31F3EE6F62099CBCC5EB2CD84CE99A65B54C80A0607248A` | Design system | Authoritative token and style specification |
| 2 | `fasalytics_farmer_dashboard/code.html` | .html | 35,387 | `DBB2F855D32995EE0F423E97CF1722823C8CA74A4E748D23F6FEE15E1DB2BD7A` | Farmer dashboard | Home screen markup, styles, inline script |
| 3 | `fasalytics_farmer_dashboard/screen.png` | .png | 262,214 | `7B7F887123107545429CF26E8FE085AB131093509643D0F11C403E04CBB46F01` | Farmer dashboard | Full-page mobile screenshot, 244 × 1600 px |
| 4 | `smart_mandi_comparison/code.html` | .html | 37,116 | `BD6D9782C7E50B313E46D726F145D1DB49D112A111A5D7CA64C280BF7187DBC9` | Mandi comparison | Markup, styles, inline script |
| 5 | `smart_mandi_comparison/screen.png` | .png | 214,765 | `AEECEF3A65D445BF54B97AE5B1EE42984E9E5D2A890DD10E8A644D4794D5A5FD` | Mandi comparison | Full-page mobile screenshot, 224 × 1600 px |
| 6 | `smart_harvest_allocation/code.html` | .html | 38,799 | `5368A09659F64091D8038151908A56104215F09ED64CB089F1229C0BD178F168` | Harvest allocation | Markup, styles, inline script |
| 7 | `smart_harvest_allocation/screen.png` | .png | 242,779 | `A5C4B60684DB7DD5572724BF59D8E4C82D44376795FAF548860CBF1ECE0B67BF` | Harvest allocation | Full-page mobile screenshot, 274 × 1600 px |
| 8 | `fasalytics_ai_copilot/code.html` | .html | 26,605 | `C232F87C2519C1FF2B924DD9F6DDABB601DA3740D2059002FCB7C57C813DC0EE` | AI copilot | Markup, styles, inline script |
| 9 | `fasalytics_ai_copilot/screen.png` | .png | 278,874 | `BF877C70B3891013C3637EBB471A16F686C2E731B51CB41AE64910B7FF9CEB94` | AI copilot | Full-page mobile screenshot, 352 × 1600 px |

### 1.1 Batch 2 inventory (added 14 October 2026)

> **Location note:** you described these as being under `design/stitch/new-exports/`. They are actually at **`design/new-exports/`** (one level up). Nothing was moved. Paths below are the real ones; moving the folder under `design/stitch/` is a one-line decision for you.
> Not yet preserved in an immutable location: `design/new-exports/` should be treated as read-only like `original/`.

All paths relative to `design/new-exports/`. Hashes were computed with SHA-256 on 14 October 2026.

| # | Path | Ext | Bytes | SHA-256 | Screen | Purpose |
|---|---|---|---:|---|---|---|
| 10 | `ai_price_forecasting/code.html` | .html | 32,235 | `A4A074C07D6E964C6D0A7E17F59C14DBC7AFDB381C6A5524DD3B0D3E3D8D5169` | AI Price Forecasting | Markup, styles (no scripts) |
| 11 | `ai_price_forecasting/screen.png` | .png | 273,538 | `50995392647CD4507E7CB5F60DDF267E09CB78ACA26C621A56B00376B94BC410` | AI Price Forecasting | Full-page screenshot, 302 × 1600 |
| 12 | `all_crop_commodity_explorer/code.html` | .html | 34,502 | `DC59B4AA4E0474DA6809D765C415845E8EF61F6C7FE05929214A287F1ED21E5B` | Explore Commodities | Markup, styles (no scripts) |
| 13 | `all_crop_commodity_explorer/screen.png` | .png | 311,759 | `97AA74B819BBE51EBDA671F62A56CFF1A7B4F3D0B1F75D6055DE505F3E5ECAE8` | Explore Commodities | Full-page screenshot, 337 × 1600 |
| 14 | `nationwide_market_explorer/code.html` | .html | 32,942 | `D5BE138560BC0555C36231897EB82A204B2C08673A05DF19B264A92E4DB0F77C` | Nationwide Market Explorer | Markup, styles (no scripts) |
| 15 | `nationwide_market_explorer/screen.png` | .png | 226,221 | `D620526912DB5A8681A1FBD0470DB2002CB6EF096E7CBF58C51ED0A0DE838314` | Nationwide Market Explorer | Full-page screenshot, 337 × 1600 |
| 16 | `what_if_market_simulator/code.html` | .html | 34,036 | `4DD812E4E37620835932A6A03B33BB5B63D76566EB8941D3D76C43CFCBB093EE` | What-If Simulator | Markup, styles, inline script |
| 17 | `what_if_market_simulator/screen.png` | .png | 263,655 | `46A57F441CF8193A61CB33ACDF2C2CF4BEE0042CD0A5D877052B49B931D9724B` | What-If Simulator | Full-page screenshot, 324 × 1600 |
| 18 | `agriintelligence_market_risk_system/DESIGN.md` | .md | 12,030 | `C38B67CFE7FAD0A1D31F3EE6F62099CBCC5EB2CD84CE99A65B54C80A0607248A` | Design system | **Byte-identical duplicate** of Batch 1 `DESIGN.md` (same hash) |

**Completeness:** every new screen has its `code.html` and `screen.png`. No CSS, JS, image or font files exist beyond these (same as Batch 1: all styling is Tailwind CDN, all images remote). Folder names differ from the screen titles (`all_crop_commodity_explorer` = "Explore Commodities"; `what_if_market_simulator` = "What-If Simulator").

**Batch 1 integrity re-verified in this pass:** 9/9 original files still match their pre-move SHA-256 hashes.

**Finding vs. earlier assumption:** the folder `agriintelligence_market_risk_system/` contains **only `DESIGN.md`**. It is the design-system source, **not a screen**, so there is no "market risk" screen export (it appears in `MISSING_SCREENS.md`).

---

## 2. Cross-cutting facts about all four exports

| Aspect | Finding (verified from source) |
|---|---|
| Form factor | **Mobile only.** All four set `<meta name="shell-type" content="mobile_tab">`, a bottom tab bar, and `min-height: max(884px, 100dvh)`. No tablet or desktop layouts exist. |
| Framework | Plain HTML + **Tailwind via Play CDN** (`cdn.tailwindcss.com`) with an inline `tailwind.config`. No external stylesheet, no build step. |
| Shared shell | Identical head (same config hash `3f8776e058dc` in all four), identical fixed header (logo, EN/हि/म toggle, bell, avatar), identical 5-tab bottom nav. |
| Fonts | Google Fonts: **Plus Jakarta Sans**, **Inter**, **Material Symbols Outlined** (all remote). No Noto Sans Devanagari is loaded (DESIGN.md requires it). |
| Remote hosts | `cdn.tailwindcss.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, `lh3.googleusercontent.com` (images). |
| Remote images | 17 `src` references plus 1 CSS `url()` to `lh3.googleusercontent.com` (logo, avatars, photos, map). **No local image assets exist.** |
| Dark mode | `darkMode: "class"` configured but **no `dark:` classes used**. |
| Document quality | No `<title>`; `lang="en"` only; viewport sets `maximum-scale=1.0, user-scalable=no` (blocks pinch-zoom: an accessibility defect). |
| Navigation | 5 bottom-tab links are all `href="#"` (inert). Header controls have no handlers. |
| Data | **Every number is hardcoded sample data** for one scenario (100 Qtl tomato, Junnar, Maharashtra). |
| Cross-screen contradictions | The same facts differ between screens: Nashik distance is 118 km (dashboard, comparison) but 82 km (allocation); Pune modal rate ₹2,250 (dashboard) vs ₹2,280 (comparison, allocation); Nashik net for 100 Qtl is ₹2,48,500 (dashboard, copilot), ₹2,45,525 (comparison). This is expected for unconnected mock-ups and is the reason one computation source is mandatory in Phase 7. |
| Reuse | The header, bottom navigation, and card patterns are repeated verbatim in each file: strong candidates for shared components. |

---

## 3. Screen entries

### 3.1 Farmer Dashboard

| Field | Value |
|---|---|
| Original folder | `fasalytics_farmer_dashboard/` |
| HTML | `fasalytics_farmer_dashboard/code.html` (445 lines) |
| Screenshot | `fasalytics_farmer_dashboard/screen.png` (244 × 1600) |
| Purpose | Home: location, commodity/lot selector, top recommendation, price trajectory, top-3 mandi comparison, allocation teaser |
| Proposed route | `/dashboard` |
| Layouts available | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Major components:** fixed header with language toggle · location chip · "Live Feed" chip · weather/transport alert banner · horizontally scrollable commodity chips with quantity · lot meta strip · photo card · gradient AI recommendation card (headline, confidence pill, net-payout pod, CTA) · 7-day SVG line chart with peak marker · three mandi cards (rate, transport, net) · allocation donut teaser + explanation · peer-activity row · demo-disclaimer pill · bottom tab bar.

**Interactions shown:** commodity chip selection is the only working client-side behaviour (swaps classes; it does not change any data). Every other control is visual only.

**External dependencies:** Tailwind CDN, Google Fonts (Inter, Plus Jakarta Sans, Material Symbols), 6 remote images.

**Missing assets / limitations:** no local images; chart is a hand-drawn static SVG (not data-driven); no empty, loading, error or stale states; no desktop layout.

**Phase 7 notes:** replace the static chart with a data-bound chart; commodity chips must come from the commodity catalogue (not a fixed list); location chip must come from the farmer profile; the "Live Feed" chip must be replaced by a real reporting-date/freshness indicator.

---

### 3.2 Mandi Comparison & Arbitrage

| Field | Value |
|---|---|
| Original folder | `smart_mandi_comparison/` |
| HTML | `smart_mandi_comparison/code.html` (510 lines) |
| Screenshot | `smart_mandi_comparison/screen.png` (224 × 1600) |
| Purpose | Compare mandis by net realization with cost breakdown and a pick-and-act tray |
| Proposed route | `/compare` |
| Layouts available | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Major components:** context bar (commodity, quantity, farm baseline) · sort chips (Highest Net Return, Shortest Distance, Lowest Risk, Best Window) · arbitrage banner · three ranked mandi cards (gross price, net per quintal, itemised transport / cess / transit loss, risk index) · net-earnings bar comparison · comparison table · route map card with background image · "Mandi Desk" support row · sticky action tray (Lock Rate & Route, Split Allocation) · toast.

**Interactions shown:** the two tray buttons show a toast; close button works. Sort chips, the "analytics" button and "Call Desk" are inert.

**External dependencies:** Tailwind CDN, Google Fonts, 3 remote `<img>` plus one remote CSS background map image.

**Known defects in the export (do not carry into React):**
- **Nested `<main>` inside `<main>`** (invalid HTML).
- **Internally inconsistent numbers:** banner says "+₹36,500 Gain" and "₹273/Qtl more", but its own cards show net ₹2,45,525 vs ₹2,18,260 (a ₹27,265 difference, which the Pune card itself states).
- **Disagrees with the Dashboard:** Pune modal ₹2,250 vs ₹2,280; Solapur net ₹2,36,000 vs ₹2,26,112; Nashik net ₹2,48,500 vs ₹2,45,525.
- The toast message **fabricates a booking** ("Driver assigned: Eicher MH-14-AZ-4421"), and "Verified Transporters Ready" implies a freight service that does not exist.

**Phase 7 notes:** rows must be computed by the comparison API from the same source as every other screen; no booking/locking action unless a real service exists (otherwise disable with an explanation).

---

### 3.3 Smart Harvest Allocation

| Field | Value |
|---|---|
| Original folder | `smart_harvest_allocation/` |
| HTML | `smart_harvest_allocation/code.html` (529 lines) |
| Screenshot | `smart_harvest_allocation/screen.png` (274 × 1600) |
| Purpose | Show and adjust how a lot is split across mandis; explain the allocation |
| Proposed route | `/allocate` |
| Layouts available | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Major components:** header chips · lot summary · three-way strategy toggle (Conservative / Balanced / Aggressive) · SVG donut with legend · KPI cards (net earnings, crash-risk exposure, logistics) · three mandi allocation cards, each with a 0–100 slider and gross/transport/spoilage/net ledger · "Why this allocation?" explanation list · corridor photo card · primary and secondary CTAs.

**Interactions shown (the most functional export):** strategy buttons and sliders re-render donut, ledgers and KPIs through inline JavaScript. This logic is **a visual simulation, not an optimizer**: fixed rates (₹2,650 / ₹2,280 / ₹2,450 per quintal), fixed freight, and a made-up risk formula `0.35·nashik + 0.10·pune + 0.05·sangamner`.

**Known defects:**
- **Allocation total is not constrained to 100**; the code explicitly leaves a "free adjustment mode" and the donut simply rescales.
- "Capped at 60 Qtl max safety" is text; the slider is not capped.
- **Rendered output contradicts the static markup:** HTML says ₹2,38,450 / "+₹20,190 / Down from 68% risk", while the script renders ₹2,39,048 / "₹-2,852 vs dumping 100% locally" / 22%, which is a *negative* gain for the "recommended" plan.
- Uses `alert()` for "Generate Mandi Gate Passes" (fabricated QR passes) and "Simulate What-If Scenarios".
- Facts presented as known: "arrivals capped at 450 tons tomorrow", "90 minutes cash liquidity", "Corridor Transit Forecast: Clear", "GPS Ready".

**Phase 7 notes:** sliders must call the allocation API and respect solver constraints (sum, caps from verified data only); show baseline vs optimized with real inputs; remove unsupported claims.

---

### 3.4 AI Copilot

| Field | Value |
|---|---|
| Original folder | `fasalytics_ai_copilot/` |
| HTML | `fasalytics_ai_copilot/code.html` (283 lines) |
| Screenshot | `fasalytics_ai_copilot/screen.png` (352 × 1600) |
| Purpose | Chat assistant with decision explanation, P&L comparison, curve and quick actions |
| Proposed route | `/assistant` |
| Layouts available | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Major components:** assistant status bar with voice toggle · timestamp chip · user bubble (Marathi-English mix) · structured AI answer card (confidence chip, decision, risk explanation, two P&L cards, SVG net curve, action chips, feedback thumbs) · in-feed lot/dispatch card · suggested-prompt carousel · pill input with mic, attach and send.

**Interactions shown:** suggested prompts fill the input; send clears it; voice toggle flips a label. **Sending produces no response**: there is no chat logic.

**Known defects:** "96% Confidence" is an unexplained number; the answer states specific prices, 34 °C and spoilage percentages as facts; "APMC Live Data: 4 mins ago" is asserted; the answer's "₹2,48,500 / 70% sell" figure differs in meaning from the Dashboard's same number (100 Qtl); the form input has no label; the photo-attach button implies image analysis that does not exist.

**Phase 7 notes:** render structured tool results as cards; show source and reporting date on every figure; the quick prompts must be generated from context rather than fixed crops.

---

## 3b. Batch 2 screen entries

**Shared facts for Batch 2** (verified): same mobile-only shell, same header and bottom tab bar, **Tailwind config byte-identical to Batch 1** (same 3,696-character token block, same colours/radii/spacing), same fonts and CDN dependencies, no `<title>`, `user-scalable=no`, `href="#"` navigation. Differences: a duplicated `<style>` block, only **one** `<main>` (the nesting defect of Batch 1 is not repeated), and `role="tablist"` / `aria-selected` appear in the forecast screen (an improvement). **Three of four screens have no JavaScript at all**; only the simulator has logic.

### 3.5 AI Price Forecasting

| Field | Value |
|---|---|
| Original folder | `design/new-exports/ai_price_forecasting/` |
| HTML / screenshot | `code.html` (371 lines) / `screen.png` (302 × 1600) |
| Purpose | 1–7-day price forecast for one crop at one mandi with trajectory, drivers and dispatch context |
| Proposed route | `/forecast` |
| Layouts | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Components:** page title with model badge · crop + mandi context card with "Change" selector · segmented horizon control (1-Day / 3-Day / 7-Day) · hero projected modal price with band and callout · SVG price trajectory (past dashed, forecast solid, shaded band, day-3 flag) · horizontally scrolling 7-day cards (peak day highlighted) · "Key Predictive Drivers" list · dispatch-destination image card · methodology disclaimer · CTAs ("Compare Inter-State Mandis for Wheat", "Set Price Alert at ₹2,800+").

**Interactions:** none implemented (no script). The tab control is markup only.

**What it gets right for FASALYTICS:** it shows a **band**, a **peak day**, a daily breakdown, and a methodology note that cites the screening thresholds; it has a "Change crop or mandi" affordance; it names a specific mandi *and state* ("Khanna Mandi, Ludhiana, Punjab").

**Defects / unsupported claims:**
- "Prophet + Ensemble v3.2 • **93% Backtested**", "**APMC Calibrated**", "rolling-origin **WAPE 4.2%** across northern wheat corridors": fabricated; no model exists, and PROJECT.md selects models by backtest, not by name.
- "**Agmarknet: 5,400 Qtl**" shows a *mandi-level arrival*. The supplied data has **no mandi-level arrivals** (state level only).
- "Real-time Factors", "Today 07:00 AM Sync", "Verified APMC API Model" next to "Illustrative Demo Data".
- Rail wagon allotment ("94%"), weather ("zero precipitation through Friday"), and buyer influx ("Delhi flour mills") presented as facts: no data source exists.
- Only 1/3/7-day horizons; the product requires any horizon 1–7 (the cards do show all seven).
- **Day 1 is labelled "Today ₹2,680 Baseline rate"**: a forecast for day 1 should be tomorrow; "today" is an observation. The chart's y-axis (₹2,700–₹2,900) excludes the "Now ₹2,680" and "−7D ₹2,680" values.
- The model band is drawn as a single smooth shape; no definition of interval level or calibration.

**Phase 7 notes:** replace badges with API-provided `model_version`, `generated_at`, `last_observed_date`, backtest metrics and interval level; add the **unavailable / stale / insufficient-data** variants (this export has only the happy path); add observed vs forecast legend text, not colour alone.

---

### 3.6 Explore Commodities

| Field | Value |
|---|---|
| Original folder | `design/new-exports/all_crop_commodity_explorer/` |
| HTML / screenshot | `code.html` (367 lines) / `screen.png` (337 × 1600) |
| Purpose | Directory of all commodities with category filter, search and forecast-eligibility indicators |
| Proposed route | `/commodities` |
| Layouts | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Components:** header ("All-India Agricultural Commodity Directory & Forecasting Eligibility") · search with mic · category chips with counts (All, Vegetables, Cereals & Grains, Pulses, Oilseeds, Spices, Fruits) · spotlight card (wheat: model price, 7-day trend, historical depth, "AI Reliability", top liquidity mandis) · six commodity cards (price, change %, mandi count, forecast/risk strip) · **"Algorithmic Readiness Index" legend** (Forecast Qualified 365+ days / Exploratory Screened / Data Aggregating) · sticky CTA "Explore Mandis for Selected Crop".

**Interactions:** none (no script). No card is shown as selected, so the CTA has no object.

**What it gets right:** it is the closest design to the project's **capability tiers** (Section 4.2.1 of PROJECT.md) and shows per-commodity mandi counts; includes a Hindi name ("गेहूं"); has sort control and a search that is written as "all-India".

**Defects / unsupported claims:**
- Numbers inconsistent *within* the screen and with the other new screen: "240+ commodities" here vs "180+" in the Market Explorer; category counts (48+32+24+18+28+38 = 188) do not sum to 240.
- "**AI Reliability 92% / Trained**", "**94% Fit**", "89% Fit", "91% Fit": fabricated, undefined metrics. "5 Years Continuous APMC" for wheat is unverifiable (supplied mandi-level wheat ends Feb 2024).
- Three of six cards carry a forecast badge; the others carry risk or storage notes: the eligibility concept is not applied uniformly.
- "Heat & Spoilage Alert", "High Storage Humidity Risk", "Export Linked": unsupported.
- "FASALYTICS AI model updates daily at 18:00 IST via Agmarknet & State APMC feeds": a data-pipeline claim that does not exist.
- The six cards are a fixed sample (rice, soybean, tomato, onion, cotton, gram): the **list itself must be dynamic**.
- Invalid utility classes in markup (`py-0.2`) and no label for the input.

**Phase 7 notes:** drive entirely from the commodity registry; tier badge computed server-side from eligibility rules (never a "% fit"); selection state plus URL param; categories from data (Dataset B has 16 groups / 433 commodities).

---

### 3.7 Nationwide Market Explorer

| Field | Value |
|---|---|
| Original folder | `design/new-exports/nationwide_market_explorer/` |
| HTML / screenshot | `code.html` (414 lines) / `screen.png` (337 × 1600) |
| Purpose | Discover mandis across India by state and crop; select several to compare |
| Proposed route | `/markets` (the existing "Mandis" tab) |
| Layouts | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Components:** title with "3,240+ Live" badge and filter button · search (state / mandi / commodity) · state quick-pills with counts · **State** and **Crops** dropdown triggers · stylised India map card with five hubs · three KPI tiles · "Live Market Hubs" list of four mandi cards (name, source tag e-NAM/Govt APMC, state, commodity, modal price, delta, arrival, reporting time, status) with checkboxes · "National Network Health" coverage bar (82/14/4%) · CTA "Compare Selected Mandis (3)".

**Interactions:** none (no script); checkboxes are native but their count is hardcoded.

**What it gets right:** it is the first screen with **geography first** (state pills, state dropdown, mandi shown with state), a **reporting time per mandi**, a **source tag**, and a **three-level coverage summary**; the "reporting: yesterday, closing" variant acknowledges lag.

**Defects / unsupported claims:**
- **Missing district level**: filters stop at state and crop; the required path is India → State → District → Mandi. Duplicate mandi names across states are distinguished only by state, not district.
- **Cross-commodity comparison**: the three pre-checked cards are Wheat (Azadpur), Tomato (Kolar), Soybean (Indore); "Compare Selected Mandis (3)" would compare different crops, which is not meaningful.
- Heavy "live / real-time" language: "3,240+ **Live**", "Real-time price discovery", "**Live** Market Hubs", "Agmarknet & e-NAM **Live**", "8m ago", "GPS Density Tracking", "96% Reliable Feed". None can be true of historical files.
- Counts disagree: 3,240 vs "Active Mandis 2,845"; "28 States"; "Commodities 180+" (vs 240+ in the other screen); state pill counts sum to 1,048 of 3,240.
- Rank/status text ("Asia Largest", "High Liquidity", "Mill Procurement Active", "Export Dispatches Open") has no source.
- The map is a hand-drawn silhouette with five hardcoded hubs placed along a near-vertical line, **not at their real positions**; it must be replaced by a real map or removed.
- "Avg Turnover ₹92.4 Cr" is unexplained.
- Checkboxes have no labels (accessibility).

**Phase 7 notes:** needs a district selector and mandi disambiguation; "data availability" chip per mandi must read **mandi-level / state-level / none** and **last reported date**; selection logic must enforce **one commodity** for comparison; map needs a provider/licence decision.

---

### 3.8 What-If Simulator

| Field | Value |
|---|---|
| Original folder | `design/new-exports/what_if_market_simulator/` |
| HTML / screenshot | `code.html` (456 lines) / `screen.png` (324 × 1600) |
| Purpose | Stress-test a harvest plan with freight, price and storage-duration levers |
| Proposed route | `/simulate` |
| Layouts | Mobile only |
| Status | **Export available; inventory complete; React conversion pending; backend integration pending; visual testing pending** |

**Components:** header chips · baseline lot card (commodity, quantity, route, baseline realisation) · four preset chips (Fuel Hike +20%, Crash −10%, Hold 5 Days, Custom) · three range sliders (freight −15…+25%, spot price −20…+15%, storage 0…7 days) · baseline-vs-simulated payout with delta badge · itemised waterfall and proportion bar · "Action Shift Triggered" alert · two-mandi comparison cards · CTAs (Run Full Multi-Mandi Optimization, Reset).

**Interactions (the only scripted screen in Batch 2):** sliders and presets recompute the display using inline JavaScript, `Reset` returns to zero.

**What it gets right:** it implements the **transport +20% / price −10% / wait N days** scenarios named in PROJECT.md §9.2, keeps the **baseline struck through beside the simulated value**, shows an itemised delta, and uses `tabular-nums` (the first use in any export, as DESIGN.md requires).

**Defects:**
- **Wrong arithmetic basis:** the price lever is applied to the *net* baseline (₹4,72,000), not to gross revenue before costs. The rule "price −5% ⇒ −₹23,600" ignores that costs are fixed.
- **Hardcoded model:** freight impact = `(pct/15)·₹1,800`, storage = `days × ₹1,366`, moisture loss `0.4%/day`; none of this comes from data.
- **Rendered output contradicts the static markup:** HTML says "₹4,51,600 / −₹20,400 (−4.3%)", "−₹245/Qtl", "−₹14,500"; the script renders "₹4,42,502 / −₹29,498 (−6.2%)", "−₹236/Qtl", "−₹23,600" (visible in the screenshot). The legend "Freight (9%) / Price Drop (71%) / Storage (20%)" is static and never updates, while the bar widths do.
- **Presets invent forecasts:** "Hold 5 Days" sets price **+3%**; "Crash" sets storage 1 day; "Custom Shock" is a fixed set of values, not a custom mode.
- Static "Action Shift: if diesel rises > 15%, Bhopal Mandi becomes +₹6,200 more profitable" is a hardcoded claim unrelated to the sliders.
- "Verified Lot #MP-492", "Live Modeler", "Real-Time", "Live Sensitivity": unsupported.
- Sliders lack labels/`aria-valuetext`; the preset after Reset is mis-highlighted ("Custom").
- Net-in-hand "₹4,720 / Qtl" is used as if it were the market price in the price calculation.

**Phase 7 notes:** a scenario must be a **server recalculation** (`POST /scenarios`) from a stored baseline, returning baseline, scenario, deltas and warnings. Scenario values are labelled hypothetical; the "Hold N days" case must come from the forecast and storage cost assumptions, never a hardcoded +3%.

---

## 4. Shared components (present in all eight)

| Component | Where | Notes |
|---|---|---|
| App header | all | Logo (remote image), brand text, EN/हि/म toggle (28 px buttons), notification bell, avatar |
| Bottom tab bar | all | Dashboard · Mandis · Allocate (raised) · AI Copilot · Profile; `data-path` attributes only; links are `#` |
| Language toggle | all | Visual only; no translation |
| Risk / status pills | 7 of 8 | Match DESIGN.md pill pattern |
| Card containers | all | `rounded-2xl`, white surface, soft shadow |
| Search field + mic | commodities, markets, copilot | Three variants (`type=text`, `type=search`, pill) |
| Horizontal chip carousel | dashboard, comparison, copilot, commodities, markets, simulator | One pattern, six uses |
| Mandi card (price, delta, arrival, reporting time) | dashboard, comparison, markets | Three similar but different cards; unify |
| Mini-metric tile grid (2–3 columns) | dashboard, comparison, allocation, commodities, markets, simulator | |
| Segmented control | allocation (strategy), forecast (horizon) | Only forecast sets `role="tablist"` |
| SVG chart | dashboard, copilot, forecast, markets (map) | All hand-drawn |

---

## 5. Status summary

| Screen | HTML | Screenshot | Route | Batch | Status |
|---|---|---|---|---|---|
| Farmer dashboard | ✅ | ✅ | `/dashboard` | 1 | Inventory complete; conversion pending |
| Mandi comparison | ✅ | ✅ | `/compare` | 1 | Inventory complete; conversion pending |
| Smart harvest allocation | ✅ | ✅ | `/allocate` | 1 | Inventory complete; conversion pending |
| AI copilot | ✅ | ✅ | `/assistant` | 1 | Inventory complete; conversion pending |
| **AI Price Forecasting** | ✅ | ✅ | `/forecast` | 2 | Inventory complete; conversion pending |
| **Explore Commodities** | ✅ | ✅ | `/commodities` | 2 | Inventory complete; conversion pending |
| **Nationwide Market Explorer** | ✅ | ✅ | `/markets` | 2 | Inventory complete; conversion pending |
| **What-If Simulator** | ✅ | ✅ | `/simulate` | 2 | Inventory complete; conversion pending |
| "Profile" tab target | ❌ | ❌ | `/profile` | n/a | **Missing HTML** and **missing screenshot** (the nav links to it) |
| Market-risk screen (folder name implies one) | ❌ | ❌ | `/risk` | n/a | `DESIGN.md` only: **Missing HTML**, **missing screenshot** |

The earlier "Mandis tab target" gap is now covered by the Nationwide Market Explorer.

**Navigation gap:** the five-item bottom bar (Dashboard, Mandis, Allocate, AI Copilot, Profile) is identical on all eight screens and has **no entry for Forecast, Commodities or Simulator**. Their place in the information architecture is undefined (see `REACT_INTEGRATION_PLAN.md` §3).

No screen is implemented, wired to data, or visually tested. See `MISSING_SCREENS.md` for the full gap analysis.

---

## 6. Inconsistencies between the original and newly generated designs

### 6.1 Structural and visual

| Aspect | Batch 1 | Batch 2 | Impact |
|---|---|---|---|
| Tailwind config / tokens | 3,696-char block | **Identical** | None; tokens are consistent |
| Fonts, CDN, shell | Same | Same | None |
| Nested `<main>` | Present in comparison | Not present | Improvement |
| Content padding | `px-margin-mobile` (dashboard), `px-gutter-mobile`, `max-w-lg` (allocation) | `px-gutter-mobile`, `space-y-space-md` | Minor; both 16 px |
| Tab semantics | none | `role="tablist"` in forecast | Improvement; apply everywhere |
| Numerals | no tabular figures | `tabular-nums` in simulator only | Standardise per DESIGN.md |
| Title treatment | `headline-sm` in a sub-bar (comparison) vs `headline-lg-mobile` (others) | `headline-lg-mobile`, primary colour, extrabold | Pick one page-title style |
| Duplicate `<style>` block | none | duplicated in all four | Harmless; remove on conversion |
| Invalid utility classes | `p-4.5` | `py-0.2`, `h-13` | Silently ignored by Tailwind; fix |
| Photography | tomato-centred | wheat, soybean, assorted commodity photos | Illustrative only; licence unknown |

### 6.2 Data contradictions across all eight screens

The same entities appear with different numbers. These are expected for unconnected mock-ups; they show why one data source is required.

| Fact | Where and value |
|---|---|
| Wheat modal price | Forecast "now" ₹2,680; Commodity explorer model price ₹2,740; Market explorer Azadpur ₹2,850; Commodity explorer Khanna ₹2,810 |
| Khanna Basmati | Market explorer ₹3,640 ("Basmati 1121"); Commodity explorer ₹3,850 ("Grade 1121") |
| Soybean price | Commodity explorer ₹4,920; Market explorer Indore ₹4,890; Simulator baseline ₹4,720 |
| Commodity count | "240+" (commodity explorer) vs "180+" (market explorer, twice) |
| Mandi count | "3,240+" / "Active 2,845" (market explorer); "184 Mandis registered" (wheat); "142 active mandis" (basmati) |
| Tomato | Batch 1: ₹2,250–₹2,650 at Pune/Nashik/Solapur; Batch 2: ₹2,350 national and ₹2,420 at Kolar |
| Model identity and accuracy | "Prophet + Ensemble v3.2, 93% backtested", "Yield Engine v4.2", "Nashik Hub v4.2", "92% AI reliability", "94% fit", "96% confidence", "94% confidence" |
| Data freshness | "12m ago", "4 mins ago", "8m ago", "07:00 AM sync", "daily 18:00 IST update" |

### 6.3 Conceptual inconsistencies

| # | Issue |
|---|---|
| 1 | **Geography:** the market explorer stops at state and crop; DESIGN-level flow needs district and mandi. The forecast screen shows "Khanna Mandi, Ludhiana, Punjab" (district present), but no screen offers a district selector. |
| 2 | **Eligibility vocabulary:** commodity explorer uses "Forecast Qualified / Exploratory Screened / Data Aggregating"; the project's tiers are Full / Limited / State-Level / Insufficient. Both need one agreed vocabulary and a state-vs-mandi distinction. |
| 3 | **Confidence:** Batch 1 uses "94% High Confidence", Batch 2 uses "% Fit", "% Backtested", "% Reliability". None is defined; PROJECT.md §6.4 forbids undefined confidence figures. |
| 4 | **Forecast horizon:** forecast screen offers 1/3/7-day tabs; copilot talks about 3-day hold; dashboard shows Day 1/2/4/7. |
| 5 | **What-if vs allocation:** Batch 1's allocation uses `alert()` for "Simulate What-If Scenarios"; Batch 2 builds the simulator separately but never connects them. |
| 6 | **Flow:** the market explorer's CTA ("Compare Selected Mandis") leads to `/compare`, which today is hardwired to one tomato lot; the commodity explorer's CTA ("Explore Mandis for Selected Crop") leads to the explorer, which has no way to receive that crop. |
| 7 | **Single-lot assumption:** every screen assumes one pre-existing "lot" (100 Qtl); there is no screen that creates or edits it. |
| 8 | **Language:** Hindi/Marathi appear only as isolated labels; there is no language state. |

---

## 7. Mock values that must eventually come from the backend

| Screen | Mock value(s) | Eventual source |
|---|---|---|
| All | Farmer name, "Rameshwar ji", location "Junnar, Pune Dist", lot ID (`#HT-4092`, `#MP-492`, `Lot #4812`), batch grade, "Verified" badges | User profile / saved plan; remove "verified" unless a verification process exists |
| All | EN/हि/म toggle, bell dot | i18n state; alerts API |
| Dashboard | Net payout, "+₹36,500", "+17.2%", 7-day curve, peak ₹2,680, mandi rates/costs/net, trucks available, "42 farmers routing" | `POST /compare`, `POST /forecasts`; trucks and peer counts: remove |
| Comparison | Gross/net per quintal, cess, transit loss, risk index (18/24/48), distances/times, transporter rate ₹120/Qtl, "driver assigned" | `POST /compare` (cost engine, routing, risk); remove booking |
| Allocation | Rates, freight, spoilage %, strategy splits, risk formula, "450 tons cap", "90 minutes" | `POST /allocate`; capacities only if verified |
| Copilot | Entire conversation, 96% confidence, ₹2,48,500 / ₹2,45,700, 34 °C, 4.5% loss, ₹118/Qtl | `POST /chat` with tool results |
| **Forecast** | ₹2,840 projected, band ₹2,790–₹2,890, +₹160 / +5.9%, seven daily prices, past values, y-axis, "Thursday morning", "Delhi flour mills", model name, 93% backtested, WAPE 4.2%, 5,400 Qtl arrival, -12% supply, 94% wagon allotment, weather, Narela +₹110 / 6.2 hrs | `POST /forecasts` (point, interval, horizon, model version, `generated_at`, `last_observed_date`, metrics); arrivals only at their true granularity; weather/rail only from verified providers |
| **Commodities** | 240+ and category counts, spotlight wheat metrics, six commodities with prices and % changes, mandi counts, "% fit", "AI reliability", risk strips, "5 years" depth, Khanna/Sehore/Kota liquidity | Commodity registry + coverage matrix + eligibility service; latest reported price with date |
| **Markets** | 3,240 / 2,845 / 28 / 180+ / ₹92.4 Cr, state pill counts, four mandi cards (price, delta, arrival, reporting time, tags), map hubs, 82/14/4% health, "96% reliable feed" | `GET /markets`, `GET /prices`, coverage service; "Live" replaced by reporting date |
| **Simulator** | Lot, ₹4,72,000 baseline, ₹4,720/Qtl, route 85 km, preset values (+20%, −10%, +3%, 5 days), freight ₹1,800 per 15%, storage ₹1,366/day, 0.4%/day loss, "Bhopal +₹6,200", mandi images | `POST /scenarios` on a stored baseline; storage and loss parameters as labelled assumptions |

---

## 8. Which designs support nationwide and dynamic selection (conceptual)

| Screen | Geographic selection | Commodity selection | Assessment |
|---|---|---|---|
| Market Explorer | State pills + state dropdown; **no district**; mandi shown with state | Crop dropdown + search | **Partially conceptual.** Good direction; add district and mandi disambiguation. |
| Commodity Explorer | None (shows "MP & Punjab" text only) | **Search + categories + counts + eligibility legend** | **Yes for commodity**; needs a place-aware view of availability. |
| Forecast | "Change crop or mandi" selector exists but is not designed | Same | **Conceptual hook only**; the selector flow is missing. |
| Simulator | Route fixed ("Sehore ➔ Indore") | Fixed soybean lot | **Parametric but not selectable**; needs a baseline from a selected plan. |
| Dashboard, comparison, allocation, copilot (Batch 1) | Fixed Maharashtra | Fixed tomato chips | **No** |

**Conclusion:** the two explorers establish the *pattern* for nationwide, all-crop selection. None of the eight screens yet provides the complete India → State → District → Mandi → Commodity → Variety chain, and none shows data availability by granularity.
