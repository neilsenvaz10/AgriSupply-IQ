import { NavLink } from 'react-router-dom';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import type { NavItem } from '../app/navigation';

interface NavEntryProps {
  item: NavItem;
  /** `rail` = desktop sidebar row, `tab` = mobile bottom-bar tab. */
  variant: 'rail' | 'tab';
}

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary';

/**
 * One navigation entry. Available features are real links; planned features are rendered as
 * disabled controls with an explicit "Planned" label so nothing implies they work.
 */
export function NavEntry({ item, variant }: NavEntryProps) {
  const isRail = variant === 'rail';
  const layout = isRail
    ? 'flex min-h-[48px] w-full items-center gap-space-sm rounded-xl px-space-sm'
    : 'flex min-h-[56px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1';

  if (item.availability === 'available') {
    return (
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          [
            layout,
            focusRing,
            'font-label-md text-label-md transition-colors',
            isActive
              ? 'bg-primary-container text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          ].join(' ')
        }
      >
        <MaterialIcon name={item.icon} className="text-[24px]" />
        <span className={isRail ? '' : 'text-center text-label-xs leading-tight'}>
          {item.label}
        </span>
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={`${item.label}: planned, not yet available`}
      className={[layout, 'cursor-not-allowed text-outline opacity-70'].join(' ')}
    >
      <MaterialIcon name={item.icon} className="text-[24px]" />
      <span
        className={
          isRail
            ? 'flex-1 text-left font-label-md text-label-md'
            : 'text-center text-label-xs leading-tight'
        }
      >
        {item.label}
      </span>
      {isRail ? (
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-label-xs text-label-xs text-on-surface-variant">
          Planned
        </span>
      ) : null}
      <span className="sr-only">Planned, not yet available</span>
    </button>
  );
}
