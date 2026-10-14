import { useCallback, useEffect, useReducer, useState } from 'react';
import { ApiError, isApiError } from '../../services/api/errors';
import { fetchHealth } from '../../services/api/health';
import { useApiClient } from '../../services/api/context';

/**
 * Outcome of the health check as rendered by the status card.
 *
 * @typedef {{ phase: 'loading' }
 *   | { phase: 'ok', response: import('../../services/api/health').HealthResponse,
 *       checkedAt: Date, latencyMs: number }
 *   | { phase: 'error', error: ApiError, checkedAt: Date }} HealthState
 */

/**
 * @typedef {{ type: 'start' }
 *   | { type: 'success', response: import('../../services/api/health').HealthResponse,
 *       latencyMs: number }
 *   | { type: 'failure', error: ApiError }} HealthAction
 */

/**
 * @param {HealthState} _state
 * @param {HealthAction} action
 * @returns {HealthState}
 */
function reducer(_state, action) {
  switch (action.type) {
    case 'start':
      return { phase: 'loading' };
    case 'success':
      return {
        phase: 'ok',
        response: action.response,
        latencyMs: action.latencyMs,
        checkedAt: new Date(),
      };
    case 'failure':
      return { phase: 'error', error: action.error, checkedAt: new Date() };
  }
}
/**
 * Calls `GET /health` on the API gateway and exposes the real outcome.
 * It never fabricates a success: every failure surfaces as the `error` phase.
 *
 * @returns {{ state: HealthState, recheck: () => void }}
 */
export function useApiHealth() {
  const client = useApiClient();
  /** @type {[HealthState, import('react').Dispatch<HealthAction>]} */
  const [state, dispatch] = useReducer(reducer, { phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const startedAt = performance.now();
    fetchHealth(client, controller.signal)
      .then((response) => {
        dispatch({
          type: 'success',
          response,
          latencyMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return; // unmounted or superseded
        dispatch({
          type: 'failure',
          error: isApiError(error)
            ? error
            : new ApiError('network', 'Unexpected error while contacting the API.', {
                cause: error,
              }),
        });
      });
    return () => controller.abort();
  }, [client, attempt]);
  const recheck = useCallback(() => {
    dispatch({ type: 'start' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, recheck };
}
