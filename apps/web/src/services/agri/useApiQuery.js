import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { isApiError } from '../api/errors';
import { useApiClient } from '../api/context';
import { describeError } from './historical';

/**
 * Data hooks built on the shared API client. Both cancel the in-flight request when the inputs
 * change or the component unmounts, and neither ever supplies data of its own: a failure is an
 * `error` state, an unselected input is `unavailable`.
 *
 * The returned shape is the standard DataState of services/agri/index.js, so pages render it with
 * the existing `DataState` component. While the inputs have changed but their request has not
 * finished, the state is `loading`: the previous inputs' result is never shown for the new ones.
 *
 * @typedef {{ status: 'unavailable' | 'loading' | 'error' | 'ready', data: any, reason: string, needs: string, retry?: () => void }} QueryState
 */

/**
 * Keeps a ref pointing at the latest callback without writing to it during render.
 *
 * @template T
 * @param {T} value
 */
function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** @param {unknown} error */
const isAbort = (error) => isApiError(error) && error.kind === 'aborted';

/**
 * One request. `run` is called with the client and an AbortSignal and must resolve with the data.
 * Re-runs when `key` changes (use a stable string of the inputs) or `retry` is called.
 *
 * @template T
 * @param {string} key identifies the inputs; the request restarts when it changes
 * @param {(client: import('../api/client').ApiClient, signal: AbortSignal) => Promise<T>} run
 * @param {{ enabled?: boolean, unavailableReason?: string }} [options]
 * @returns {QueryState}
 */
export function useApiQuery(
  key,
  run,
  { enabled = true, unavailableReason = 'Nothing selected.' } = {},
) {
  const client = useApiClient();
  const runRef = useLatest(run);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(
    /** @type {{ key: string, attempt: number, outcome: 'ready' | 'error', data: any, reason: string } | null} */ (
      null
    ),
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    runRef
      .current(client, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ key, attempt, outcome: 'ready', data, reason: '' });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setResult({ key, attempt, outcome: 'error', data: null, reason: describeError(error) });
      });
    return () => controller.abort();
  }, [client, key, enabled, attempt, runRef]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!enabled) {
    return { status: 'unavailable', data: null, reason: unavailableReason, needs: '' };
  }
  if (!result || result.key !== key || result.attempt !== attempt) {
    return { status: 'loading', data: null, reason: '', needs: '' };
  }
  return {
    status: result.outcome,
    data: result.data,
    reason: result.reason,
    needs: '',
    retry,
  };
}

/**
 * @typedef {{ has_more: boolean, next_cursor: string | null, limit: number }} Pagination
 * @typedef {{ data: any[], pagination: Pagination, meta: any }} Page
 */

/** @type {any} */
const EMPTY = {
  key: '',
  attempt: 0,
  status: 'loading',
  items: [],
  pagination: null,
  meta: null,
  reason: '',
  loadingMore: false,
  moreError: '',
};

/**
 * @param {any} state
 * @param {any} action
 */
function pagedReducer(state, action) {
  switch (action.type) {
    case 'page1':
      return {
        key: action.key,
        attempt: action.attempt,
        status: 'ready',
        items: action.page.data,
        pagination: action.page.pagination,
        meta: action.page.meta,
        reason: '',
        loadingMore: false,
        moreError: '',
      };
    case 'fail':
      return {
        ...EMPTY,
        key: action.key,
        attempt: action.attempt,
        status: 'error',
        reason: action.reason,
      };
    default:
      break;
  }
  // Follow-up page actions belong to one set of inputs; ignore any that arrive for a stale one.
  if (action.key !== state.key || action.attempt !== state.attempt) return state;
  switch (action.type) {
    case 'more-start':
      return { ...state, loadingMore: true, moreError: '' };
    case 'more':
      return {
        ...state,
        loadingMore: false,
        items: [...state.items, ...action.page.data],
        pagination: action.page.pagination,
      };
    case 'more-fail':
      return { ...state, loadingMore: false, moreError: action.reason };
    default:
      return state;
  }
}

/**
 * A cursor-paginated list. Page 1 loads when `key` changes; `loadMore` fetches the next page with
 * the server's cursor and appends it. Changing `key` (a filter change) resets the list.
 *
 * @param {string} key
 * @param {(client: import('../api/client').ApiClient, cursor: string | null, signal: AbortSignal) => Promise<Page>} fetchPage
 * @param {{ enabled?: boolean, unavailableReason?: string }} [options]
 */
export function usePagedQuery(
  key,
  fetchPage,
  { enabled = true, unavailableReason = 'Nothing selected.' } = {},
) {
  const client = useApiClient();
  const fetchRef = useLatest(fetchPage);
  const [attempt, setAttempt] = useState(0);
  const [state, dispatch] = useReducer(pagedReducer, EMPTY);
  const moreController = useRef(/** @type {AbortController | null} */ (null));

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    fetchRef
      .current(client, null, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) dispatch({ type: 'page1', key, attempt, page });
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        dispatch({ type: 'fail', key, attempt, reason: describeError(error) });
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [client, key, enabled, attempt, fetchRef]);

  const current = state.key === key && state.attempt === attempt;
  const loadMore = useCallback(() => {
    const cursor = state.pagination?.next_cursor;
    if (!current || !cursor || state.loadingMore) return;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    dispatch({ type: 'more-start', key, attempt });
    fetchRef
      .current(client, cursor, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) dispatch({ type: 'more', key, attempt, page });
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        dispatch({ type: 'more-fail', key, attempt, reason: describeError(error) });
      });
  }, [client, current, key, attempt, state.pagination, state.loadingMore, fetchRef]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!enabled) {
    return {
      ...EMPTY,
      status: /** @type {const} */ ('unavailable'),
      reason: unavailableReason,
      loadMore,
      retry,
    };
  }
  // Until the request for the current inputs has produced something, show loading, never the
  // previous inputs' list.
  if (!current) return { ...EMPTY, loadMore, retry };
  return { ...state, loadMore, retry };
}
