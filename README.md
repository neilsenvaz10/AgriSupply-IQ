# FASALYTICS (AgriSupply-IQ)

> AI-driven market and risk intelligence platform for agricultural supply chains.  
> Built for **SYRUS 7.0 Hackathon** by **Team CodeSparks Innovators**.

---

## Overview

FASALYTICS helps smallholder farmers and FPOs (Farmer Producer Organizations) make data-backed decisions on **when, where, and how much** of their harvest to sell. 

Instead of chasing the highest sticker price at a distant mandi, the platform calculates **true net returns** by factoring in recent mandi arrivals, 1–7 day price forecasts, transport & handling costs, spoilage risk, and market congestion.

### Scope: nationwide and all-crop

FASALYTICS is designed for **all of India and all agricultural commodities** (India → State/UT → District → Mandi → Commodity → Variety). Nothing is hardcoded to a state or a crop; commodities and markets are discovered from data.

- **Architecture supports everything; data decides capability.** Each commodity–market series is assigned a capability tier (Full / Limited / State-Level Intelligence / Insufficient Data) using measurable criteria and backtests, never a crop whitelist.
- **Early validation** uses well-covered series (e.g. Potato and Onion in Maharashtra) only to prove the pipeline. They are examples, not limits.
- **Honest data labelling:** the supplied datasets are *historical*. Mandi-, state- and national-level records are never blended, and historical data is never shown as a current price. See [docs/data-sources/DATASET_COVERAGE.md](./docs/data-sources/DATASET_COVERAGE.md) for dataset coverage by state.

### Key Capabilities
- **Mandi Price & Arrival Tracking:** Source-tracked modal prices and volume arrivals across target mandis.
- **1–7 Day Price Forecasting:** Tabular time-series forecasts with confidence intervals and uncertainty metrics.
- **Net Return Comparison:** Side-by-side comparison of 3+ feasible mandis factoring in logistics, packing, and mandi fees.
- **Smart Harvest Allocation:** Solves multi-market split decisions to optimize returns while mitigating volume and price shock.
- **Fair Price Card & Risk Engine:** Visual summary of estimated price band, weather risks, and market pressure indicators.
- **Tool-Grounded AI Copilot:** Natural language scenario simulations ("What if diesel goes up 10%?") powered by Groq API tool-calling.
- **Vernacular & Accessible:** Mobile-first PWA design with multilingual support (Marathi, Hindi, English).

---

## Repository Structure

```text
AgriSupply-IQ/
├── PROJECT.md                  # Master blueprint, architecture specs & phased roadmap
├── README.md                   # Project overview
├── .env.example                # Environment template (placeholders only; copy to .env)
├── .gitignore                  # Protects secrets, datasets, models and build output
├── apps/
│   ├── web/                    # React + Vite + TypeScript frontend      (Milestone 5)
│   └── api/                    # Express + TypeScript backend            (Milestone 6)
├── services/
│   └── intelligence/           # Python 3.12 FastAPI ML service          (Milestone 7)
├── database/
│   └── migrations/             # PostgreSQL migrations                   (Milestone 8)
├── data/
│   └── raw/                    # Original historical CSVs (git-ignored, read-only)
│                               # Agriculture_price_dataset, merged_preprocessed_all_reports,
│                               # crop_price_dataset, Wholesale-Price-Index-from-2012-to-2024
├── design/
│   └── stitch/
│       ├── original/           # Immutable Google Stitch exports (do not edit)
│       │   └── stitch_fasalytics_agritech_intelligence_platform/
│       │       ├── agriintelligence_market_risk_system/   # DESIGN.md (design system)
│       │       ├── fasalytics_farmer_dashboard/           # code.html + screen.png
│       │       ├── smart_mandi_comparison/
│       │       ├── smart_harvest_allocation/
│       │       └── fasalytics_ai_copilot/
│       ├── (Batch 2 exports currently at design/new-exports/: forecast, commodities,
│       │    market explorer, what-if simulator)
│       ├── SCREEN_MAP.md               # Screen inventory, checksums, defects
│       ├── DESIGN_SYSTEM.md            # Extracted tokens and components
│       ├── MISSING_SCREENS.md          # Gaps vs nationwide, all-crop scope
│       └── REACT_INTEGRATION_PLAN.md   # Phase 7 conversion plan
└── docs/
    └── data-sources/
        └── DATASET_COVERAGE.md  # Dataset coverage, provenance and limitations
```

> `compose.yaml` is introduced in Milestone 9 (Docker Compose integration).

---

## Proposed Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS | Mobile-first responsive web app & PWA |
| **Backend API** | Node.js, Express, TypeScript | Main application API, auth, business orchestration |
| **Database** | PostgreSQL + Prisma / Drizzle | Relational data, mandi records, transaction logs |
| **ML & Analytics** | Python, FastAPI, Pandas, scikit-learn, XGBoost | Price forecasting, arrival trends, risk scoring |
| **Optimization** | SciPy / PuLP | Constrained harvest allocation solver |
| **AI Assistant** | Groq API (Function/Tool Calling) | Deterministic-tool grounded copilot & scenario queries |
| **Auth** | Firebase Auth | Phone OTP and role-based access |

---

## Implementation Roadmap

The full engineering blueprint and stage-by-stage implementation guide is documented in [PROJECT.md](./PROJECT.md):

- **Phase 1:** Foundation & environment (monorepo, services, database, Docker, local validation)
- **Phase 2:** Market data engineering (nationwide ingestion, normalisation, provenance, registries)
- **Phase 3:** Multi-crop forecasting (generalised models, backtesting, uncertainty, eligibility)
- **Phase 4:** Risk intelligence (volatility, price-drop, supply pressure, freshness, weather)
- **Phase 5:** Mandi comparison (net returns, transport costs, sell-now vs wait)
- **Phase 6:** Smart Harvest Allocation (risk-adjusted optimisation, explainable plans)
- **Phase 7:** Frontend integration (Stitch designs → React dashboard, PWA)
- **Phase 8:** AI assistant (Groq tool-calling copilot & what-if simulator)
- **Phase 9:** Accessibility & communication (multilingual, alerts, SMS/WhatsApp, voice)
- **Phase 10:** Testing, deployment & demo

---

## Current Status

- [x] Problem statement & requirements analysis
- [x] UI/UX prototypes designed in Google Stitch
- [x] Master engineering specification & roadmap ([PROJECT.md](./PROJECT.md))
- [x] Phase 1 / Milestone 1: development environment verified
- [x] Phase 1 / Milestone 2: historical datasets profiled ([coverage report](./docs/data-sources/DATASET_COVERAGE.md))
- [x] Phase 1 / Milestone 3: monorepo foundation, `.gitignore`, `.env.example`, raw data organised
- [x] Phase 1 / Milestone 4: Google Stitch assets preserved, inventoried and documented ([screen map](./design/stitch/SCREEN_MAP.md))
- [ ] Core services & data pipeline implementation (not started)

---

## License

Private repository for SYRUS 7.0 Hackathon development.