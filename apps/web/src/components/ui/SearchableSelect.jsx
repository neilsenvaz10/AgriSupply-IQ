import { useId, useMemo, useRef, useState } from 'react';
import { MaterialIcon } from './MaterialIcon';

/**
 * Searchable single-select (ARIA 1.2 combobox with a listbox popup), for long registries such as
 * the commodity catalogue. Same tokens and control shape as `RegistrySelect`; no dependency.
 *
 * Behaviour:
 *  - type to filter by label (case-insensitive; labels starting with the text come first);
 *  - ArrowDown / ArrowUp / Home / End move the highlighted option, Enter chooses it, Escape closes
 *    the list (a second Escape clears the typed text), Tab leaves the control;
 *  - a Clear button removes the selection; an empty search shows an explicit "no match" message;
 *  - each option can carry a second line (`description`), used for coverage information;
 *  - at most `maxOptions` matches are rendered and the control says when more exist.
 *
 * @typedef {{ value: string, label: string, description?: string }} SearchableOption
 *
 * @param {{ label: string, placeholder?: string, options: SearchableOption[], value?: string,
 *   onChange: (value: string) => void, emptyMessage?: string, hint?: string, maxOptions?: number,
 *   disabled?: boolean, disabledNote?: string }} props
 */
export function SearchableSelect({
  label,
  placeholder = 'Search…',
  options,
  value = '',
  onChange,
  emptyMessage = 'No match.',
  hint = '',
  maxOptions = 50,
  disabled = false,
  disabledNote = '',
}) {
  const id = useId();
  const listId = `${id}-list`;
  const noteId = `${id}-note`;
  const statusId = `${id}-status`;
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef(/** @type {HTMLDivElement | null} */ (null));

  const selected = options.find((o) => o.value === value) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !typing) return options;
    const hits = options.filter((o) => o.label.toLowerCase().includes(q));
    // Labels that start with the text first; the original order otherwise (stable).
    return [...hits].sort(
      (a, b) =>
        Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)),
    );
  }, [options, query, typing]);
  const shown = matches.slice(0, maxOptions);
  const last = shown.length - 1;
  const activeIndex = Math.min(active, Math.max(last, 0));

  const close = () => {
    setOpen(false);
    setTyping(false);
    setQuery('');
  };
  const choose = (/** @type {SearchableOption} */ option) => {
    onChange(option.value);
    close();
  };
  const openList = () => {
    if (disabled || open) return;
    setOpen(true);
    const at = options.findIndex((o) => o.value === value);
    setActive(typing || at < 0 ? 0 : Math.min(at, maxOptions - 1));
  };

  /** @param {import('react').KeyboardEvent<HTMLInputElement>} event */
  const onKeyDown = (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive(Math.min(activeIndex + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActive(Math.max(activeIndex - 1, 0));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(last);
        }
        break;
      case 'Enter':
        if (open && shown[activeIndex]) {
          event.preventDefault();
          choose(shown[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          if (typing && query) {
            setQuery('');
            setTyping(false);
          } else close();
        }
        break;
      default:
        break;
    }
  };

  const text = typing ? query : (selected?.label ?? '');
  const status = !open
    ? ''
    : matches.length === 0
      ? emptyMessage
      : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}${
          matches.length > shown.length ? `, showing the first ${shown.length}` : ''
        }`;

  return (
    <div
      ref={root}
      className="relative flex min-w-0 flex-col gap-1"
      onBlur={(event) => {
        if (!root.current?.contains(/** @type {Node | null} */ (event.relatedTarget))) close();
      }}
    >
      <label
        htmlFor={id}
        className="font-label-xs text-label-xs font-bold uppercase tracking-wider text-on-surface-variant"
      >
        {label}
      </label>
      <div
        className={`flex items-center gap-1 rounded-xl bg-surface-container-lowest px-3 shadow-sm focus-within:outline focus-within:outline-2 focus-within:outline-secondary ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        <MaterialIcon name="search" className="text-[20px] text-on-surface-variant" />
        <input
          id={id}
          role="combobox"
          type="text"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && shown[activeIndex] ? `${id}-opt-${activeIndex}` : undefined
          }
          aria-describedby={[hint ? noteId : null, statusId].filter(Boolean).join(' ')}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setQuery(event.target.value);
            setTyping(true);
            setOpen(true);
            setActive(0);
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
          className="min-h-[48px] w-full min-w-0 bg-transparent font-label-md text-label-md text-on-surface outline-none placeholder:text-outline"
        />
        {value || (typing && query) ? (
          <button
            type="button"
            onClick={() => {
              onChange('');
              close();
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
          >
            <MaterialIcon name="close" className="text-[20px]" />
            <span className="sr-only">Clear {label}</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl bg-surface-container-lowest p-1 shadow-xl"
        >
          {shown.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
              className={`flex min-h-[44px] cursor-pointer flex-col justify-center rounded-lg px-3 py-1.5 font-label-md text-label-md ${
                index === activeIndex ? 'bg-primary-container text-on-primary' : 'text-on-surface'
              }`}
            >
              <span className={option.value === value ? 'font-bold' : ''}>{option.label}</span>
              {option.description ? (
                <span
                  className={`font-label-xs text-label-xs ${
                    index === activeIndex ? 'text-on-primary-container' : 'text-on-surface-variant'
                  }`}
                >
                  {option.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && matches.length === 0 ? (
        <p
          role="note"
          className="rounded-xl bg-surface-container-low p-space-sm font-label-xs text-label-xs text-on-surface-variant"
        >
          {emptyMessage}
        </p>
      ) : null}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
      {hint ? (
        <span id={noteId} className="font-label-xs text-label-xs text-on-surface-variant">
          {hint}
        </span>
      ) : null}
      {disabled && disabledNote ? (
        <span className="font-label-xs text-label-xs text-on-surface-variant">{disabledNote}</span>
      ) : null}
    </div>
  );
}
