import { Component } from 'react';
import { useRouteError } from 'react-router-dom';
import { EmptyState } from './primitives';

/** @param {{ onRetry?: () => void }} props */
function Fallback({ onRetry = undefined }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <EmptyState
        role="alert"
        icon="error"
        title="Something went wrong on this page"
        message="The rest of the application is still available. You can try again or open another page from the menu."
      >
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] rounded-xl bg-primary px-space-lg font-label-md text-label-md font-bold text-on-primary"
          >
            Try again
          </button>
        ) : null}
      </EmptyState>
    </div>
  );
}

/** Page-level boundary: a rendering error in one screen never takes down the shell. */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <Fallback onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

/** Route-level `errorElement` (loader/render errors surfaced by React Router). */
export function RouteError() {
  useRouteError();
  return <Fallback />;
}
