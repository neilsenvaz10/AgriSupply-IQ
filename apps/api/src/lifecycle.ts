import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import type { AppDependencies } from './app.js';
import type { AppConfig } from './config/env.js';
import type { Logger } from './utils/logger.js';

export interface RunningServer {
  server: Server;
  /** The port actually bound (useful when `API_PORT=0` in tests). */
  port: number;
  /** Stops accepting connections, lets in-flight requests finish, then forcibly ends stragglers. */
  close(graceMs?: number): Promise<void>;
}

/** Binds the app to `config.host:config.port`. Rejects if the port cannot be bound. */
export function startServer(config: AppConfig, deps: AppDependencies = {}): Promise<RunningServer> {
  const app = createApp(config, deps);

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host);

    // Bound slow clients (slowloris) and runaway requests.
    server.requestTimeout = config.requestTimeoutMs + 5000;
    server.headersTimeout = Math.min(10_000, server.requestTimeout);
    server.keepAliveTimeout = 5000;

    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;

      let closing: Promise<void> | undefined;
      const close = (graceMs = 10_000): Promise<void> => {
        closing ??= new Promise<void>((done) => {
          const forceTimer = setTimeout(() => server.closeAllConnections(), graceMs);
          forceTimer.unref();
          server.close(() => {
            clearTimeout(forceTimer);
            done();
          });
          server.closeIdleConnections();
        });
        return closing;
      };

      resolve({ server, port: address.port, close });
    });
  });
}

/** Subset of `process` used for shutdown (replaceable in tests). */
export interface ProcessLike {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code?: number): void;
}

/**
 * Graceful shutdown on SIGINT / SIGTERM: stop accepting connections, drain, exit 0.
 * A second signal while draining exits immediately with code 1.
 * Returns a function that removes the handlers.
 */
export function registerShutdownHandlers(
  running: Pick<RunningServer, 'close'>,
  logger: Logger,
  proc: ProcessLike = process,
  graceMs = 10_000,
): () => void {
  let shuttingDown = false;

  const handle = (signal: 'SIGINT' | 'SIGTERM') => () => {
    if (shuttingDown) {
      logger.warn('second shutdown signal received, exiting immediately', { signal });
      proc.exit(1);
      return;
    }
    shuttingDown = true;
    logger.info('shutdown signal received, draining connections', { signal });
    // Re-arm so a second signal is observed.
    proc.once(signal, onSignals[signal]);
    running
      .close(graceMs)
      .then(() => {
        logger.info('server closed');
        proc.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('error during shutdown', {
          error: error instanceof Error ? error : 'unknown',
        });
        proc.exit(1);
      });
  };

  const onSignals = { SIGINT: handle('SIGINT'), SIGTERM: handle('SIGTERM') };
  proc.once('SIGINT', onSignals.SIGINT);
  proc.once('SIGTERM', onSignals.SIGTERM);

  return () => {
    proc.removeListener('SIGINT', onSignals.SIGINT);
    proc.removeListener('SIGTERM', onSignals.SIGTERM);
  };
}
