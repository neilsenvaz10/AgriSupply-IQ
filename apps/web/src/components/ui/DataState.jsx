import { EmptyState, SkeletonCard } from './primitives';

/**
 * Renders the standard data state (see services/agri/index.js):
 *   ready        -> children(data)
 *   loading      -> skeleton
 *   error        -> error message with a retry button when the data source offers one
 *   unavailable  -> `empty` (or a default empty state carrying the state's own reason)
 */
/**
 * @param {{ state: import('../../services/agri').DataState, empty?: import('react').ReactNode, skeleton?: import('react').ReactNode, icon?: string, children: (data: any) => import('react').ReactNode }} props
 */
export function DataState({
  state,
  empty = undefined,
  skeleton = undefined,
  icon = 'inbox',
  children,
}) {
  switch (state.status) {
    case 'ready':
      return children(state.data);
    case 'loading':
      return (
        <div role="status" aria-busy="true" aria-label="Loading">
          {skeleton ?? <SkeletonCard />}
        </div>
      );
    case 'error':
      return (
        <EmptyState
          role="alert"
          icon="error"
          title="Could not load this data"
          message={state.reason}
        >
          {state.retry ? (
            <button
              type="button"
              onClick={state.retry}
              className="min-h-[44px] rounded-xl bg-primary px-space-lg font-label-md text-label-md font-bold text-on-primary"
            >
              Try again
            </button>
          ) : null}
        </EmptyState>
      );
    default:
      return empty ?? <EmptyState icon={icon} message={state.reason} />;
  }
}
