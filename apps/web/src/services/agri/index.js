/**
 * Data boundary for the farmer-facing screens.
 *
 * Every screen reads its data through one hook below and renders the standard state shape, so a
 * later phase replaces the BODY of a hook with a real request through the Express API client
 * (`../api/client.js`) without touching any page. Today there is no agricultural data pipeline,
 * no registry and no trained model, so every hook reports `unavailable`. They make NO network
 * request, return NO sample data, and never fall back to demo values.
 *
 * @typedef {'unavailable' | 'loading' | 'error' | 'ready'} DataStatus
 *
 * @typedef {object} DataState
 * @property {DataStatus} status
 * @property {unknown} data Present only when `status === 'ready'`.
 * @property {string} reason Plain-language explanation shown when not ready.
 * @property {string} needs What must exist before this becomes ready (shown in docs and tests).
 * @property {() => void} [retry] Provided by a real implementation when `status === 'error'`.
 */

/**
 * @param {string} reason
 * @param {string} needs
 * @returns {Readonly<DataState>}
 */
function unavailable(reason, needs) {
  return Object.freeze({ status: 'unavailable', data: null, reason, needs });
}

const DASHBOARD = unavailable(
  'Market data will appear here once the ingestion pipeline is connected.',
  'Phase 2 market data plus Phase 3 forecasts and Phase 5 comparison (Express /prices, /forecasts, /compare)',
);
const MARKETS = unavailable(
  'Market directory data is not available yet.',
  'Phase 2 canonical state, district and market registries (Express /markets)',
);
const COMMODITIES = unavailable(
  'Commodity catalogue data is not available yet.',
  'Phase 2 commodity registry and capability tiers (Express /commodities)',
);
const FORECAST = unavailable(
  'Forecasts are not available until the forecasting service is trained and validated.',
  'Phase 3 validated models served by the intelligence service (Express /forecasts)',
);
const COMPARISON = unavailable(
  'Mandi comparison requires verified market prices and cost inputs.',
  'Phase 2 prices plus Phase 5 cost engine (Express /compare)',
);
const ALLOCATION = unavailable(
  'Allocation recommendations require verified market and forecast data.',
  'Phase 6 allocation optimiser (Express /allocate)',
);
const SCENARIO = unavailable(
  'Risk simulation is not yet connected to the intelligence engine.',
  'Phase 8 scenario engine (Express /scenarios)',
);
const COPILOT = unavailable(
  'AI Copilot is not yet configured.',
  'Phase 8 tool-grounded assistant (Express /chat)',
);

export const useDashboardOverview = () => DASHBOARD;
export const useMarketDirectory = () => MARKETS;
export const useCommodityCatalogue = () => COMMODITIES;
export const useForecast = () => FORECAST;
export const useMandiComparison = () => COMPARISON;
export const useHarvestAllocation = () => ALLOCATION;
export const useScenarioResult = () => SCENARIO;
export const useCopilot = () => COPILOT;
