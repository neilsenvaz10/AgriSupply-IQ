import { useCallback, useEffect, useReducer, useState } from 'react';
import { ApiError, isApiError } from '../../services/api/errors';
import { fetchHealth } from '../../services/api/health';
import type { HealthResponse } from '../../services/api/health';
import { useApiClient } from '../../services/api/context';

export type HealthState =
  | { phase: 'loading' }
  | { phase: 'ok'; response: HealthResponse; checkedAt: Date; latencyMs: number }
  | { phase: 'error'; error: ApiError; checkedAt: Date };

type Action =
  | { type: 'start' }
  | { type: 'success'; response: HealthResponse; latencyMs: number }
  | { type: 'failure'; error: ApiError };

function reducer(_state: HealthState, action: Action): HealthState {
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
 */
export function useApiHealth(): { state: HealthState; recheck: () => void } {
  const client = useApiClient();
  const [state, dispatch] = useReducer(reducer, { phase: 'loading' } as HealthState);
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
      .catch((error: unknown) => {
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
