/** Decorative icon. Always pair with visible or screen-reader text. */
export function MaterialIcon({ name, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`.trim()} aria-hidden="true">
      {name}
    </span>
  );
}
