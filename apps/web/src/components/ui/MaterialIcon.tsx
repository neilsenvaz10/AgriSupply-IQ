interface MaterialIconProps {
  /** Material Symbols ligature name, e.g. "storefront". */
  name: string;
  className?: string;
}

/** Decorative icon. Always pair with visible or screen-reader text. */
export function MaterialIcon({ name, className = '' }: MaterialIconProps) {
  return (
    <span className={`material-symbols-outlined ${className}`.trim()} aria-hidden="true">
      {name}
    </span>
  );
}
