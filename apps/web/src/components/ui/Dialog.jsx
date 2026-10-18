import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal panel: role="dialog" + aria-modal, labelled by its title, focus moves inside on
 * open and returns to the opener on close, Escape and the backdrop close it, and Tab stays inside.
 *
 * `placement="left"` renders a side drawer (mobile menu); `"bottom"` a sheet (filters on mobile);
 * `"center"` a centred panel.
 */
export function Dialog({ open, onClose, title, children, placement = 'center', id = 'dialog' }) {
  const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const openerRef = useRef(/** @type {HTMLElement | null} */ (null));
  const titleId = `${id}-title`;

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = /** @type {HTMLElement | null} */ (document.activeElement);
    const panel = panelRef.current;
    const first = /** @type {HTMLElement | null | undefined} */ (panel?.querySelector(FOCUSABLE));
    (first ?? panel)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [open]);

  if (!open) return null;

  /** @param {import('react').KeyboardEvent<HTMLDivElement>} event */
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = /** @type {HTMLElement[]} */ ([
      ...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? []),
    ]);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const placementClasses = {
    left: 'left-0 top-0 h-full w-[min(20rem,88vw)] rounded-r-2xl',
    bottom:
      'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl md:inset-x-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-[24rem] md:rounded-l-2xl md:rounded-tr-none',
    center: 'left-1/2 top-1/2 w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl',
  }[placement];

  return createPortal(
    <div className="fixed inset-0 z-[70]" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-on-surface/40"
        aria-hidden="true"
        data-testid="dialog-backdrop"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute overflow-y-auto bg-surface p-space-md shadow-xl ${placementClasses}`}
      >
        <div className="mb-space-md flex items-center justify-between gap-space-sm">
          <h2
            id={titleId}
            className="font-headline-sm text-headline-sm font-extrabold text-primary"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-on-surface"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
