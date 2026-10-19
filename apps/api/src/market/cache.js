/**
 * A tiny in-process memo for expensive whole-table aggregates (coverage per commodity, the
 * coverage summary). The data behind them is a historical snapshot that only changes when an
 * operator runs the importer, so a few minutes of staleness is harmless; concurrent callers share
 * one computation instead of each scanning two million rows.
 *
 * @template T
 * @typedef {object} Memo
 * @property {() => Promise<T>} get
 * @property {() => void} clear
 */

/**
 * @template T
 * @param {() => Promise<T>} compute
 * @param {{ ttlMs: number, now?: () => number }} options
 * @returns {Memo<T>}
 */
export function memoize(compute, { ttlMs, now = Date.now }) {
  /** @type {{ value: T, at: number } | undefined} */
  let cached;
  /** @type {Promise<T> | undefined} */
  let inflight;
  return {
    async get() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      inflight ??= compute()
        .then((value) => {
          cached = { value, at: now() };
          return value;
        })
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
    clear() {
      cached = undefined;
    },
  };
}
