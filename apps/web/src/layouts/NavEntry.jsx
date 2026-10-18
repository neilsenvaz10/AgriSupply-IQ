import { NavLink } from 'react-router-dom';
import { MaterialIcon } from '../components/ui/MaterialIcon';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary';

/**
 * One navigation entry (always a real link). Variants:
 *   rail  desktop sidebar        menu  mobile drawer        tab  bottom bar (Stitch pattern)
 * The Allocate tab is the raised circular centre action of the Stitch bottom bar.
 */
/**
 * @param {{ item: import('../app/navigation').NavItem, variant: string, onNavigate?: () => void }} props
 */
export function NavEntry({ item, variant, onNavigate = undefined }) {
  if (variant === 'tab') {
    const center = item.tab?.center === true;
    return (
      <NavLink
        to={item.path}
        onClick={onNavigate}
        className={({ isActive }) =>
          [
            'flex min-h-[56px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-colors',
            focusRing,
            center ? '' : 'rounded-xl',
            isActive ? 'font-bold text-primary' : 'text-on-surface-variant',
          ].join(' ')
        }
      >
        {({ isActive }) => (
          <>
            {center ? (
              <span
                className={`-mt-7 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 ring-surface ${
                  isActive ? 'bg-primary text-on-primary' : 'bg-primary-container text-on-primary'
                }`}
              >
                <MaterialIcon name={item.icon} className="text-[28px]" />
              </span>
            ) : (
              <MaterialIcon name={item.icon} className="text-[24px]" />
            )}
            <span className="text-center font-label-xs text-label-xs leading-tight">
              {item.tab?.label ?? item.label}
            </span>
          </>
        )}
      </NavLink>
    );
  }
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'flex min-h-[48px] w-full items-center gap-space-sm rounded-xl px-space-sm font-label-md text-label-md transition-colors',
          focusRing,
          isActive
            ? 'bg-primary-container text-on-primary'
            : 'text-on-surface-variant hover:bg-surface-container-high',
        ].join(' ')
      }
    >
      <MaterialIcon name={item.icon} className="text-[24px]" />
      <span className="flex-1">{item.label}</span>
      {item.preview ? (
        <span className="rounded-full bg-tertiary-fixed px-2 py-0.5 font-label-xs text-label-xs font-bold text-on-tertiary-fixed-variant">
          Preview
        </span>
      ) : null}
    </NavLink>
  );
}
