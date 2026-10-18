import { Link } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';

/**
 * Small presentational building blocks shared by the converted Stitch screens. They carry the
 * Stitch card/chip/pill styling and contain no data of their own.
 */

/** Marks a screen whose layout is implemented but whose data/service is not connected yet. */
export function PreviewBadge({ children = 'UI preview' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-fixed px-2.5 py-1 font-label-xs text-label-xs font-bold uppercase tracking-wide text-on-tertiary-fixed-variant">
      <MaterialIcon name="construction" className="text-[14px]" />
      {children}
    </span>
  );
}

/** Page title block (Stitch: icon + headline + sub-line, optional badge and trailing action). */
/**
 * @param {{ icon?: string, title: string, subtitle?: string, badge?: import('react').ReactNode, action?: import('react').ReactNode, headingId?: string }} props
 */
export function PageHeader({
  icon = '',
  title,
  subtitle = '',
  badge = undefined,
  action = undefined,
  headingId = 'page-title',
}) {
  return (
    <header className="flex flex-col gap-space-xs">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex min-w-0 items-center gap-space-sm">
          {icon ? (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container"
              aria-hidden="true"
            >
              <MaterialIcon name={icon} className="text-[22px]" />
            </span>
          ) : null}
          <h1
            id={headingId}
            className="font-headline-lg-mobile text-headline-lg-mobile font-extrabold tracking-tight text-primary md:font-headline-display md:text-headline-lg"
          >
            {title}
          </h1>
        </div>
        {action}
      </div>
      {subtitle ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{subtitle}</p>
      ) : null}
      {badge ? <div className="mt-1 flex flex-wrap items-center gap-space-xs">{badge}</div> : null}
    </header>
  );
}

/** Breadcrumb trail; the last item is the current page. */
export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1">
              {last || !item.to ? (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'font-bold text-on-surface' : ''}
                >
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="font-semibold text-primary hover:underline">
                  {item.label}
                </Link>
              )}
              {last ? null : <MaterialIcon name="chevron_right" className="text-[14px]" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Truthful empty state: says what is missing, never fills the gap with sample data. */
/**
 * @param {{ icon?: string, title?: string, message: string, children?: import('react').ReactNode, role?: string }} props
 */
export function EmptyState({
  icon = 'inbox',
  title = '',
  message,
  children = undefined,
  role = 'status',
}) {
  return (
    <div
      role={role}
      className="flex flex-col items-center gap-space-sm rounded-2xl bg-surface-container-low p-space-lg text-center"
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant"
        aria-hidden="true"
      >
        <MaterialIcon name={icon} className="text-[26px]" />
      </span>
      {title ? (
        <p className="font-headline-sm text-headline-sm font-bold text-on-surface">{title}</p>
      ) : null}
      <p className="max-w-prose font-body-sm text-body-sm text-on-surface-variant">{message}</p>
      {children}
    </div>
  );
}

/** Neutral information strip (Stitch alert-banner shape, without any invented alert). */
export function InfoBanner({ icon = 'info', children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface-container-high p-3.5 text-on-surface">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-on-surface-variant"
        aria-hidden="true"
      >
        <MaterialIcon name={icon} className="text-[20px]" />
      </span>
      <p className="min-w-0 pt-1 font-body-sm text-body-sm leading-snug">{children}</p>
    </div>
  );
}

/** Stitch card surface. */
/** @param {any} props */
export function Card({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag
      className={`rounded-2xl bg-surface-container-lowest p-4 shadow-md ${className}`.trim()}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Skeleton line/block. Decorative: hidden from assistive technology. */
export function Skeleton({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-lg bg-surface-container-high ${className}`.trim()}
    />
  );
}

/** Structural placeholder for a data card (no numbers). */
export function SkeletonCard({ lines = 3 }) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

const BUTTON_STYLES = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-secondary-fixed text-on-secondary-fixed',
  tonal: 'bg-surface-container-high text-on-surface',
};
const BASE_BUTTON =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-space-lg font-label-md text-label-md font-bold';

/**
 * A control whose backend action does not exist yet: truly disabled, with the reason shown as
 * visible text and exposed to assistive technology. It never pretends to succeed.
 */
export function UnavailableAction({
  icon = '',
  children,
  reason,
  variant = 'primary',
  className = '',
  fullWidth = true,
}) {
  const reasonId = `reason-${String(children)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''} ${className}`.trim()}>
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-describedby={reasonId}
        className={`${BASE_BUTTON} ${BUTTON_STYLES[variant]} cursor-not-allowed opacity-50`}
      >
        {icon ? <MaterialIcon name={icon} className="text-[18px]" /> : null}
        <span>{children}</span>
      </button>
      <span
        id={reasonId}
        className="text-center font-label-xs text-label-xs text-on-surface-variant"
      >
        {reason}
      </span>
    </div>
  );
}

/** A real navigation action styled as a button. */
export function LinkButton({ to, icon = '', children, variant = 'primary', className = '' }) {
  return (
    <Link to={to} className={`${BASE_BUTTON} ${BUTTON_STYLES[variant]} ${className}`.trim()}>
      <span>{children}</span>
      {icon ? <MaterialIcon name={icon} className="text-[18px]" /> : null}
    </Link>
  );
}
