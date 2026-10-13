import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMutation } from '../src/hooks/useMutation';
import { useResource } from '../src/hooks/useResource';
import { ApiError } from '../src/services/api/errors';

afterEach(() => vi.useRealTimers());

describe('useResource', () => {
  it('aborts the request when unmounted', async () => {
    let seen: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useResource('k', (signal) => {
        seen = signal;
        return new Promise(() => undefined);
      }),
    );
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it('stops polling at a terminal state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi.fn().mockResolvedValueOnce({ done: false }).mockResolvedValue({ done: true });
    const { result } = renderHook(() => useResource('k', fetcher, { pollWhile: (d: { done: boolean }) => !d.done, pollIntervalMs: 100 }));
    await waitFor(() => expect(result.current.data).toEqual({ done: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => expect(result.current.data).toEqual({ done: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.polling).toBe('idle');
  });

  it('stops polling after the time limit and can resume', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi.fn().mockResolvedValue({ done: false });
    const { result } = renderHook(() =>
      useResource('k', fetcher, { pollWhile: (d: { done: boolean }) => !d.done, pollIntervalMs: 100, maxPollDurationMs: 250 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.polling).toBe('stopped');
    const calls = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher.mock.calls.length).toBe(calls);
    act(() => result.current.resumePolling());
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(calls));
  });

  it('pauses polling while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const fetcher = vi.fn().mockResolvedValue({ done: false });
    const { result } = renderHook(() => useResource('k', fetcher, { pollWhile: () => true, pollIntervalMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.polling).toBe('paused');
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('keeps stale data and reports the refresh error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(new ApiError({ kind: 'network' }));
    const { result } = renderHook(() => useResource('k', fetcher));
    await waitFor(() => expect(result.current.data).toBe('first'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshError?.kind).toBe('network'));
    expect(result.current.data).toBe('first');
    expect(result.current.status).toBe('success');
  });

  it('does not show data from a previous key', async () => {
    const fetcher = vi.fn((signal: AbortSignal) => {
      void signal;
      return Promise.resolve('a');
    });
    const { result, rerender } = renderHook(({ k }) => useResource(k, k === 'a' ? fetcher : () => new Promise<string>(() => undefined)), {
      initialProps: { k: 'a' },
    });
    await waitFor(() => expect(result.current.data).toBe('a'));
    rerender({ k: 'b' });
    expect(result.current.data).toBeUndefined();
    expect(result.current.status).toBe('loading');
  });
});

describe('useMutation', () => {
  it('ignores a second call while the first is pending', async () => {
    let resolve: (v: string) => void = () => undefined;
    const fn = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const { result } = renderHook(() => useMutation(fn));
    let first: Promise<unknown> = Promise.resolve();
    let second: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      first = result.current.run();
      second = await result.current.run();
    });
    expect(second).toEqual({ ok: false, error: null });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve('done');
      await first;
    });
    expect(result.current.succeeded).toBe(true);
  });

  it('returns errors rather than throwing and never retries', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError({ kind: 'timeout', method: 'POST' }));
    const { result } = renderHook(() => useMutation(fn));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.error?.kind).toBe('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
