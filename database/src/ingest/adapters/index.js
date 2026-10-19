import { mandiAdapter } from './mandi.js';
import { nationalAdapter } from './national.js';
import { stateAdapter } from './state.js';
import { wpiAdapter } from './wpi.js';

/**
 * The importable datasets, in the order they are imported (D, C, A, B): small and geography-free
 * first, so the framework is proven before the multi-million-row files.
 */
export const DATASETS = {
  D: { adapter: wpiAdapter, defaultFile: 'Wholesale-Price-Index-from-2012-to-2024.csv' },
  C: { adapter: nationalAdapter, defaultFile: 'crop_price_dataset.csv' },
  A: { adapter: mandiAdapter, defaultFile: 'Agriculture_price_dataset.csv' },
  B: { adapter: stateAdapter, defaultFile: 'merged_preprocessed_all_reports.csv' },
};

export const DATASET_ORDER = /** @type {const} */ (['D', 'C', 'A', 'B']);
