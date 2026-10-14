import { createApp } from './app.js';

/**
 * @typedef {object} RunningServer
 * @property {import('node:http').Server} server
 * @property {number} port The port actually bound (useful when `API_PORT=0` in tests).
 * @property {(graceMs?: number) => Promise<void>} close Stops accepting connections, lets
 *   in-flight requests finish, then forcibly ends stragglers after `graceMs`.
 */

/**
 * Subset of `process` used for shutdown (replaceable in tests).
 *
 * @typedef {object} ProcessLike
 * @property {(event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown} once
 * @property {(event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown} removeListener
 * @property {(code?: number) => void} exit
 */

/**
 * Binds the app to `config.host:config.port`. Rejects if the port cannot be bound.
 *
 * @param {import('./config/env.js').AppConfig} config
 * @param {import('./app.js').AppDependencies} [deps]
 * @returns {Promise<RunningServer>}
 */
export function startServer(config, deps = {}) {
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
      const address = server.address();
      let closing;
      const close = (graceMs = 10_000) => {
        closing ??= new Promise((done) => {
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
/**
 * Graceful shutdown on SIGINT / SIGTERM: stop accepting connections, drain, exit 0.
 * A second signal while draining exits immediately with code 1.
 * Returns a function that removes the handlers.
 *
 * @param {Pick<RunningServer, 'close'>} running
 * @param {import('./utils/logger.js').Logger} logger
 * @param {ProcessLike} [proc]
 * @param {number} [graceMs]
 * @returns {() => void} Unregister function.
 */
export function registerShutdownHandlers(running, logger, proc = process, graceMs = 10_000) {
  let shuttingDown = false;
  const handle = (signal) => () => {
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
      .catch((error) => {
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
