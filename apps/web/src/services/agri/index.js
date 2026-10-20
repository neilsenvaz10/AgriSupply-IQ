/**
 * Data boundary for the farmer-facing screens.
 *
 * Screens read their data through one hook below and render the standard state shape. Since
 * Milestone 2.3B the Dashboard, Market Explorer and Commodities screens read the read-only HISTORICAL
 * market endpoints of the Express API (see ./historical.js); every record they show comes from the
 * API and is labelled as historical, never live. The remaining screens (forecast, comparison,
 * allocation, simulation, copilot) have no backend yet, so their hooks still report `unavailable`:
 * they make NO network request, return NO sample data, and never fall back to demo values.
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

export {
  useCommodityCatalogue,
  useCoverage,
  useDistricts,
  useMandiObservations,
  useMarketDirectory,
  useMarketDetail,
  useStates,
} from './hooks';
export const useForecast = () => FORECAST;
export const useMandiComparison = () => COMPARISON;
export const useHarvestAllocation = () => ALLOCATION;
export const useScenarioResult = () => SCENARIO;
export const useCopilot = () => COPILOT;
