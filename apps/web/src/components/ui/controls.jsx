import { useId } from 'react';
import { MaterialIcon } from './MaterialIcon';

/** Stitch search field (leading icon, rounded, tonal). Controlled; the parent owns the value. */
export function SearchField({ label, value, onChange, placeholder, hint = '' }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-2xl bg-surface-container-lowest px-3 shadow-sm focus-within:outline focus-within:outline-2 focus-within:outline-secondary">
        <MaterialIcon name="search" className="text-[22px] text-on-surface-variant" />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          className="min-h-[48px] w-full bg-transparent font-body-md text-body-md text-on-surface outline-none placeholder:text-outline"
        />
      </div>
      {hint ? (
        <p id={hintId} className="px-1 font-label-xs text-label-xs text-on-surface-variant">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Segmented control (Stitch: horizon selector, strategy toggle, sort chips). Radio-group
 * semantics, arrow-key friendly through native radio inputs.
 */
export function SegmentedControl({ label, name, options, value, onChange, compact = false }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-container p-1">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={`relative flex min-h-[44px] flex-1 cursor-pointer flex-col items-center justify-center rounded-lg px-3 text-center font-label-md text-label-md transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-secondary ${
                checked
                  ? 'bg-primary-container font-bold text-on-primary shadow'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span>{option.label}</span>
              {option.caption && !compact ? (
                <span
                  className={`font-label-xs text-label-xs font-normal ${checked ? 'text-on-primary-container' : 'text-on-surface-variant'}`}
                >
                  {option.caption}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Selector for a registry-backed value (state, commodity, market). The nationwide registry is not
 * populated yet, so it is disabled and offers NO options: nothing here implies a pilot list is
 * the supported universe. When registry APIs exist, pass `options` and drop `unavailable`.
 */
/**
 * @param {{ label: string, placeholder: string, unavailable?: boolean,
 *   options?: Array<{ value: string, label: string }>, value?: string,
 *   onChange?: (value: string) => void }} props
 */
export function RegistrySelect({
  label,
  placeholder,
  unavailable = true,
  options = [],
  value = '',
  onChange = undefined,
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="font-label-xs text-label-xs font-bold uppercase tracking-wider text-on-surface-variant"
      >
        {label}
      </label>
      <select
        id={id}
        disabled={unavailable}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        aria-describedby={unavailable ? noteId : undefined}
        className="min-h-[48px] w-full rounded-xl bg-surface-container-lowest px-3 font-label-md text-label-md text-on-surface shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {unavailable ? (
        <span id={noteId} className="font-label-xs text-label-xs text-on-surface-variant">
          Not available until the registry is loaded.
        </span>
      ) : null}
    </div>
  );
}

/** Accessible disclosure (native details/summary, Stitch card styling). */
export function Disclosure({ title, icon, children, defaultOpen = false }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl bg-surface-container-low p-space-md open:bg-surface-container-low"
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 font-headline-sm text-headline-sm font-bold text-on-surface [&::-webkit-details-marker]:hidden">
        {icon ? <MaterialIcon name={icon} className="text-primary" /> : null}
        <span className="flex-1">{title}</span>
        <MaterialIcon name="expand_more" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-space-sm font-body-sm text-body-sm text-on-surface-variant">
        {children}
      </div>
    </details>
  );
}
