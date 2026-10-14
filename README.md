# FASALYTICS (AgriSupply-IQ)

> AI-driven market and risk intelligence platform for agricultural supply chains.  
> Built for **SYRUS 7.0 Hackathon** by **Team CodeSparks Innovators**.

---

## Overview

FASALYTICS helps smallholder farmers and FPOs (Farmer Producer Organizations) make data-backed decisions on **when, where, and how much** of their harvest to sell. 

Instead of chasing the highest sticker price at a distant mandi, the platform calculates **true net returns** by factoring in real-time/recent mandi arrivals, 1–7 day price forecasts, transport & handling costs, spoilage risk, and market congestion.

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
├── PROJECT.md                                      # Master blueprint, architecture specs & phased roadmap
├── README.md                                       # Project overview and quickstart
└── stitch_fasalytics_agritech_intelligence_platform/ # Exported UI designs & reference prototypes (Google Stitch)
    ├── agriintelligence_market_risk_system/
    ├── fasalytics_ai_copilot/
    ├── fasalytics_farmer_dashboard/
    ├── smart_harvest_allocation/
    └── smart_mandi_comparison/
```

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

- **Phase 1:** Environment setup, repo scaffolding & data source adapters
- **Phase 2:** Canonical data pipeline & database migrations
- **Phase 3:** Forecasting engine & backtesting baseline
- **Phase 4:** Mandi comparison & net return calculators
- **Phase 5:** Smart Harvest Allocation optimization engine
- **Phase 6:** Backend APIs & orchestration layer
- **Phase 7:** Frontend dashboard conversion (from Stitch prototype to React)
- **Phase 8:** Groq API tool-calling copilot & scenario simulator
- **Phase 9:** Validation, unit tests & deployment

---

## Current Status

- [x] Problem statement & requirements analysis
- [x] UI/UX prototypes designed in Google Stitch
- [x] Master engineering specification & roadmap ([PROJECT.md](./PROJECT.md))
- [ ] Core services & data pipeline implementation (in progress)

---

## License

Private repository for SYRUS 7.0 Hackathon development.