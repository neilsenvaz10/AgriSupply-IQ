/** One log line per finished request: method, path (no query string), status, duration. */
export function requestLogger(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      logger.info('request', {
        requestId: res.locals['requestId'],
        method: req.method,
        // originalUrl keeps the full mounted path; the query string is dropped (may hold PII).
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  };
}
