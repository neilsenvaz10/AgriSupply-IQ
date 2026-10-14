import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-sm rounded-2xl bg-surface-container-lowest p-space-md shadow-sm">
      <h1 className="font-headline-md text-headline-md font-extrabold text-primary">
        Page not found
      </h1>
      <p className="font-body-md text-body-md text-on-surface-variant">
        This page does not exist, or the feature has not been built yet.
      </p>
      <p>
        <Link
          to="/status"
          className="inline-flex min-h-[48px] items-center rounded-xl bg-primary px-space-lg font-label-md text-label-md font-bold text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          Go to system status
        </Link>
      </p>
    </div>
  );
}
