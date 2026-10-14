import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiStatusCard } from '../features/status/ApiStatusCard';
import pkg from '../../package.json';

export function StatusPage() {
  useDocumentTitle('System status');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-extrabold tracking-tight text-primary md:font-headline-lg md:text-headline-lg">
          System status
        </h1>
        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
          Connection status of this web application. No market data is shown here.
        </p>
      </div>

      <section
        aria-labelledby="web-status-heading"
        className="rounded-2xl bg-surface-container-lowest p-space-md shadow-sm"
      >
        <h2 id="web-status-heading" className="font-headline-sm text-headline-sm font-bold">
          Web application
        </h2>
        <dl className="mt-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-3">
          <div className="rounded-xl bg-surface-container-low p-space-sm">
            <dt className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Name
            </dt>
            <dd className="font-label-md text-label-md font-semibold">FASALYTICS web</dd>
          </div>
          <div className="rounded-xl bg-surface-container-low p-space-sm">
            <dt className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Version
            </dt>
            <dd className="font-label-md text-label-md font-semibold tabular-nums">
              {pkg.version}
            </dd>
          </div>
          <div className="rounded-xl bg-surface-container-low p-space-sm">
            <dt className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Mode
            </dt>
            <dd className="font-label-md text-label-md font-semibold">{import.meta.env.MODE}</dd>
          </div>
        </dl>
      </section>

      <ApiStatusCard />
    </div>
  );
}
