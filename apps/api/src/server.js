import { ConfigError, loadConfig } from './config/env.js';
import { loadEnvFiles } from './config/loadEnvFiles.js';
import { registerShutdownHandlers, startServer } from './lifecycle.js';
import { createLogger } from './utils/logger.js';
import { SERVICE_NAME, SERVICE_VERSION } from './version.js';

/** Process entry point. Everything testable lives in app.js / lifecycle.js. */
async function main() {
  const loadedFiles = loadEnvFiles();
  /** @type {import('./config/env.js').AppConfig} */
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const bootLogger = createLogger('error');
    if (error instanceof ConfigError) {
      bootLogger.error('invalid configuration, refusing to start', { issues: error.issues });
    } else {
      bootLogger.error('failed to read configuration', {
        error: error instanceof Error ? error : 'unknown',
      });
    }
    process.exitCode = 1;
    return;
  }
  const logger = createLogger(config.logLevel);
  try {
    const running = await startServer(config, { logger });
    registerShutdownHandlers(running, logger);
    logger.info('server listening', {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      env: config.nodeEnv,
      host: config.host,
      port: running.port,
      // File names only; never contents.
      envFiles: loadedFiles,
      corsOrigins: config.corsOrigins,
      postgresConfigured: config.databaseUrl !== null,
      intelligenceServiceConfigured: config.mlServiceUrl !== null,
    });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    logger.error(
      code === 'EADDRINUSE'
        ? `port ${config.port} is already in use on ${config.host}`
        : 'failed to start server',
      { code, error: error instanceof Error ? error : 'unknown' },
    );
    process.exitCode = 1;
  }
}
void main();
