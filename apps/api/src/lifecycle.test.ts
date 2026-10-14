import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerShutdownHandlers, startServer } from './lifecycle.js';
import type { ProcessLike } from './lifecycle.js';
import { testConfig } from './test/helpers.js';
import { silentLogger } from './utils/logger.js';

describe('startServer', () => {
  it('serves real HTTP on an ephemeral port and then closes cleanly', async () => {
    const running = await startServer(testConfig({ port: 0 }));
    expect(running.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'fasalytics-api' });

    await running.close(1000);
    await expect(fetch(`http://127.0.0.1:${running.port}/health`)).rejects.toThrow();
  });

  it('rejects when the port is already in use', async () => {
    const first = await startServer(testConfig({ port: 0 }));
    try {
      await expect(startServer(testConfig({ port: first.port }))).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await first.close(1000);
    }
  });

  it('starts without PostgreSQL or the intelligence service being available', async () => {
    const running = await startServer(
      testConfig({
        databaseUrl: 'postgres://u:p@127.0.0.1:1/none',
        mlServiceUrl: 'http://127.0.0.1:1',
      }),
    );
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/health/dependencies`);
      const body = (await res.json()) as {
        dependencies: {
          postgres: { status: string };
          intelligence_service: { status: string; reason?: string };
        };
      };
      expect(res.status).toBe(200);
      expect(body.dependencies.postgres.status).toBe('not_checked');
      expect(body.dependencies.intelligence_service).toMatchObject({
        status: 'unreachable',
        reason: 'connection_failed',
      });
    } finally {
      await running.close(1000);
    }
  });
});

describe('registerShutdownHandlers', () => {
  function fakeProcess() {
    const emitter = new EventEmitter();
    const exit = vi.fn();
    const proc: ProcessLike = {
      once: (event, listener) => emitter.once(event, listener),
      removeListener: (event, listener) => emitter.removeListener(event, listener),
      exit,
    };
    return { emitter, exit, proc };
  }

  it('drains and exits 0 on SIGTERM', async () => {
    const { emitter, exit, proc } = fakeProcess();
    const close = vi.fn(() => Promise.resolve());
    registerShutdownHandlers({ close }, silentLogger, proc);

    emitter.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drains and exits 0 on SIGINT', async () => {
    const { emitter, exit, proc } = fakeProcess();
    registerShutdownHandlers({ close: () => Promise.resolve() }, silentLogger, proc);

    emitter.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('exits 1 immediately on a second signal while draining', async () => {
    const { emitter, exit, proc } = fakeProcess();
    registerShutdownHandlers(
      { close: () => new Promise<void>(() => undefined) },
      silentLogger,
      proc,
    );

    emitter.emit('SIGTERM');
    emitter.emit('SIGTERM');

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 if closing fails', async () => {
    const { emitter, exit, proc } = fakeProcess();
    registerShutdownHandlers(
      { close: () => Promise.reject(new Error('boom')) },
      silentLogger,
      proc,
    );

    emitter.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('can be unregistered', () => {
    const { emitter, exit, proc } = fakeProcess();
    const unregister = registerShutdownHandlers(
      { close: () => Promise.resolve() },
      silentLogger,
      proc,
    );
    unregister();
    emitter.emit('SIGTERM');
    expect(exit).not.toHaveBeenCalled();
  });
});
