import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { ApiClientContext } from '../api/context';
import { useApiQuery, usePagedQuery } from './useApiQuery';

const fakeClient = { baseUrl: 'http://api.test', timeoutMs: 1000, get: vi.fn() };
const wrapper = ({ children }) => (
  <ApiClientContext.Provider value={fakeClient}>{children}</ApiClientContext.Provider>
);

/** A promise the test resolves by hand, so loading states can be observed. */
function deferred() {
  /** @type {any} */
  let resolve;
  /** @type {any} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useApiQuery', () => {
  it('goes loading -> ready with the data the request returned', async () => {
    const d = deferred();
    const { result } = renderHook(() => useApiQuery('k', () => d.promise), { wrapper });
    expect(result.current.status).toBe('loading');
    await act(async () => d.resolve({ rows: 3 }));
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual({ rows: 3 });
  });

  it('reports a failure as an error with a plain reason and a working retry', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network', 'Could not reach'))
      .mockResolvedValueOnce('second try');
    const { result } = renderHook(() => useApiQuery('k', run), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.reason).toMatch(/could not be reached/i);
    expect(result.current.data).toBeNull();
    act(() => result.current.retry?.());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe('second try');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('is unavailable (and sends nothing) while disabled', () => {
    const run = vi.fn();
    const { result } = renderHook(
      () => useApiQuery('k', run, { enabled: false, unavailableReason: 'Choose a state first.' }),
      { wrapper },
    );
    expect(result.current).toMatchObject({
      status: 'unavailable',
      reason: 'Choose a state first.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('aborts the in-flight request when the inputs change, and never shows the old result for the new inputs', async () => {
    /** @type {AbortSignal[]} */
    const signals = [];
    const first = deferred();
    const second = deferred();
    const run = vi.fn((_client, signal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const { result, rerender } = renderHook(({ k }) => useApiQuery(k, run), {
      wrapper,
      initialProps: { k: 'a' },
    });
    rerender({ k: 'b' });
    expect(signals[0].aborted).toBe(true);
    expect(result.current.status).toBe('loading');
    await act(async () => first.resolve('stale answer for a'));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
    await act(async () => second.resolve('answer for b'));
    expect(result.current.data).toBe('answer for b');
  });

  it('aborts when the component unmounts and ignores the late answer', async () => {
    const d = deferred();
    /** @type {any} */
    let captured;
    const { unmount } = renderHook(
      () =>
        useApiQuery('k', (_c, signal) => {
          captured = signal;
          return d.promise;
        }),
      { wrapper },
    );
    unmount();
    expect(captured.aborted).toBe(true);
    await act(async () => d.resolve('late'));
  });

  it('does not treat a cancellation as an error', async () => {
    const run = vi.fn().mockRejectedValue(new ApiError('aborted', 'cancelled'));
    const { result } = renderHook(() => useApiQuery('k', run), { wrapper });
    await act(async () => undefined);
    expect(result.current.status).toBe('loading');
  });
});

describe('usePagedQuery', () => {
  const page = (rows, next) => ({
    data: rows,
    pagination: { limit: 2, has_more: next !== null, next_cursor: next },
    meta: {},
  });

  it('loads page 1, then appends the next page using the server cursor', async () => {
    const fetchPage = vi.fn(async (_c, cursor) =>
      cursor === null ? page([{ id: 'a' }, { id: 'b' }], 'cur-1') : page([{ id: 'c' }], null),
    );
    const { result } = renderHook(() => usePagedQuery('list', fetchPage), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.current.pagination?.has_more).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.pagination?.has_more).toBe(false);
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual([null, 'cur-1']);
    // No cursor left: loadMore does nothing.
    act(() => result.current.loadMore());
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('resets the list when the filter changes and never mixes the old list into the new one', async () => {
    const fetchFor = (label) => async () => page([{ id: `${label}-1` }], null);
    const { result, rerender } = renderHook(({ k }) => usePagedQuery(k, fetchFor(k)), {
      wrapper,
      initialProps: { k: 'one' },
    });
    await waitFor(() => expect(result.current.items.map((r) => r.id)).toEqual(['one-1']));
    rerender({ k: 'two' });
    expect(result.current.status).toBe('loading');
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.items.map((r) => r.id)).toEqual(['two-1']));
  });

  it('keeps the loaded rows and shows a retryable message when a later page fails', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a' }], 'cur'))
      .mockRejectedValueOnce(new ApiError('timeout', 'slow'));
    const { result } = renderHook(() => usePagedQuery('list', fetchPage), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.moreError).toMatch(/did not answer in time/i));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.pagination?.has_more).toBe(true);
  });

  it('an empty first page is ready with no items (an explicit empty result, not an error)', async () => {
    const { result } = renderHook(() => usePagedQuery('list', async () => page([], null)), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toEqual([]);
    expect(result.current.pagination?.has_more).toBe(false);
  });

  it('reports a failed first page as an error', async () => {
    const { result } = renderHook(
      () =>
        usePagedQuery('list', async () =>
          Promise.reject(new ApiError('http', 'x', { status: 500 })),
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
  });

  it('ignores a late first page for old filters, even if the request does not honour cancellation', async () => {
    const late = deferred();
    const fetchPage = vi.fn((k) =>
      k === 'old' ? late.promise : Promise.resolve(page([{ id: 'new-1' }], null)),
    );
    const { result, rerender } = renderHook(({ k }) => usePagedQuery(k, () => fetchPage(k)), {
      wrapper,
      initialProps: { k: 'old' },
    });
    rerender({ k: 'new' });
    await waitFor(() => expect(result.current.items.map((r) => r.id)).toEqual(['new-1']));
    await act(async () => late.resolve(page([{ id: 'old-1' }], 'old-cursor')));
    expect(result.current.items.map((r) => r.id)).toEqual(['new-1']);
    expect(result.current.pagination?.next_cursor).toBeNull();
  });

  it('drops the cursor and ignores a late "load more" answer when the filters change', async () => {
    const lateMore = deferred();
    const calls = [];
    const fetchFor = (k) => async (_c, cursor) => {
      calls.push([k, cursor]);
      if (k === 'old' && cursor) return lateMore.promise;
      return k === 'old' ? page([{ id: 'old-1' }], 'old-cursor') : page([{ id: 'new-1' }], null);
    };
    const { result, rerender } = renderHook(({ k }) => usePagedQuery(k, fetchFor(k)), {
      wrapper,
      initialProps: { k: 'old' },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    rerender({ k: 'new' });
    expect(result.current.items).toEqual([]);
    expect(result.current.pagination).toBeNull();
    await waitFor(() => expect(result.current.items.map((r) => r.id)).toEqual(['new-1']));
    await act(async () => lateMore.resolve(page([{ id: 'old-2' }], 'older-cursor')));
    expect(result.current.items.map((r) => r.id)).toEqual(['new-1']);
    expect(result.current.pagination?.next_cursor).toBeNull();
    // The new filters never received the old cursor.
    expect(calls.filter(([k]) => k === 'new')).toEqual([['new', null]]);
  });

  it('aborts the in-flight page when the filters change', async () => {
    /** @type {AbortSignal[]} */
    const signals = [];
    const fetchPage = vi.fn((_c, _cursor, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    const { rerender } = renderHook(({ k }) => usePagedQuery(k, fetchPage), {
      wrapper,
      initialProps: { k: 'a' },
    });
    rerender({ k: 'b' });
    expect(signals[0].aborted).toBe(true);
  });
});
