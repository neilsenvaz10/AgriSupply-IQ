import { MaterialIcon } from '../../components/ui/MaterialIcon';
import { readConfig } from '../../config/env';
import { useApiClient } from '../../services/api/context';
import { useApiHealth } from './useApiHealth';

function describeError(error, baseUrl, timeoutMs) {
  switch (error.kind) {
    case 'config':
      return {
        title: 'API address not configured',
        detail: 'Set VITE_API_BASE_URL to the address of the API gateway and rebuild.',
      };
    case 'timeout':
      return {
        title: 'No response',
        detail: `The API gateway at ${baseUrl ?? 'the configured address'} did not answer within ${timeoutMs} ms.`,
      };
    case 'http':
      return {
        title: `API returned an error (HTTP ${error.status ?? '?'})`,
        detail: 'The server was reached but reported a failure for the health check.',
      };
    case 'parse':
      return {
        title: 'Unexpected response',
        detail: error.message,
      };
    case 'aborted':
      return { title: 'Check cancelled', detail: 'The request was cancelled before it finished.' };
    case 'network':
    default:
      return {
        title: 'API unreachable',
        detail: `The browser could not connect to ${baseUrl ?? 'the API gateway'}. The service may not be running, or the request may have been blocked (for example by CORS).`,
      };
  }
}
/** Shows the real outcome of the API health check. Never displays a success that did not happen. */
export function ApiStatusCard() {
  const client = useApiClient();
  const { state, recheck } = useApiHealth();
  const config = readConfig();
  const pill =
    state.phase === 'ok'
      ? {
          label:
            state.response.status.toLowerCase() === 'ok'
              ? 'Connected'
              : `Reachable: ${state.response.status}`,
          icon: state.response.status.toLowerCase() === 'ok' ? 'check_circle' : 'warning',
          classes: 'bg-secondary-container text-on-secondary-container',
        }
      : state.phase === 'error'
        ? {
            label: 'Not connected',
            icon: 'error',
            classes: 'bg-error-container text-on-error-container',
          }
        : {
            label: 'Checking…',
            icon: 'hourglass_top',
            classes: 'bg-surface-container-high text-on-surface-variant',
          };
  return (
    <section
      aria-labelledby="api-status-heading"
      className="rounded-2xl bg-surface-container-lowest p-space-md shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="api-status-heading" className="font-headline-sm text-headline-sm font-bold">
          API gateway
        </h2>
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-label-sm text-label-sm font-bold ${pill.classes}`}
        >
          <MaterialIcon name={pill.icon} className="text-[18px]" />
          {pill.label}
        </span>
      </div>

      <dl className="mt-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-2">
        <div className="rounded-xl bg-surface-container-low p-space-sm">
          <dt className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
            Address
          </dt>
          <dd className="break-all font-label-md text-label-md font-semibold">
            {client.baseUrl ?? 'Not configured'}
          </dd>
          <dd className="font-label-xs text-label-xs text-on-surface-variant">
            {config.apiBaseUrlSource === 'env' && 'from VITE_API_BASE_URL'}
            {config.apiBaseUrlSource === 'dev-default' &&
              'development default (VITE_API_BASE_URL not set)'}
            {config.apiBaseUrlSource === 'missing' && 'VITE_API_BASE_URL is not set'}
            {config.apiBaseUrlSource === 'invalid' &&
              'VITE_API_BASE_URL is not a valid http(s) URL'}
          </dd>
        </div>
        <div className="rounded-xl bg-surface-container-low p-space-sm">
          <dt className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
            Timeout
          </dt>
          <dd className="font-label-md text-label-md font-semibold tabular-nums">
            {client.timeoutMs} ms
          </dd>
        </div>
      </dl>

      <div className="mt-space-md" aria-live="polite">
        {state.phase === 'loading' && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Contacting the API gateway…
          </p>
        )}

        {state.phase === 'ok' && (
          <div className="rounded-xl bg-surface-container-low p-space-sm">
            <p className="font-body-sm text-body-sm">
              The API gateway responded to <code className="font-mono">GET /health</code> in{' '}
              <span className="tabular-nums">{state.latencyMs}</span> ms.
            </p>
            <ul className="mt-space-xs font-label-sm text-label-sm text-on-surface-variant">
              <li>Reported status: {state.response.status}</li>
              {state.response.service !== undefined && <li>Service: {state.response.service}</li>}
              {state.response.version !== undefined && <li>Version: {state.response.version}</li>}
              {state.response.uptimeSeconds !== undefined && (
                <li>Uptime: {Math.round(state.response.uptimeSeconds)} s</li>
              )}
              <li>Checked at {state.checkedAt.toLocaleTimeString()}</li>
            </ul>
          </div>
        )}

        {state.phase === 'error' && (
          <div
            role="alert"
            className="rounded-xl bg-error-container/50 p-space-sm text-on-error-container"
          >
            {(() => {
              const info = describeError(state.error, client.baseUrl, client.timeoutMs);
              return (
                <>
                  <p className="font-label-md text-label-md font-bold">{info.title}</p>
                  <p className="mt-0.5 font-body-sm text-body-sm">{info.detail}</p>
                  <p className="mt-space-xs font-label-xs text-label-xs">
                    Error type: {state.error.kind} · Checked at{' '}
                    {state.checkedAt.toLocaleTimeString()}
                  </p>
                </>
              );
            })()}
          </div>
        )}
      </div>

      <div className="mt-space-md">
        <button
          type="button"
          onClick={recheck}
          disabled={state.phase === 'loading'}
          className="inline-flex min-h-[48px] items-center gap-space-xs rounded-xl bg-primary px-space-lg font-label-md text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MaterialIcon name="refresh" className="text-[20px]" />
          Check again
        </button>
      </div>
    </section>
  );
}
