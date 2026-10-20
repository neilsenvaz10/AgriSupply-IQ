/**
 * Narrowing helpers for tests: a missing element or call fails the test with a clear message
 * instead of being silently ignored, and the type checker sees a non-null value.
 */

/**
 * @template T
 * @param {T | null | undefined} value
 * @param {string} [what]
 * @returns {T}
 */
export function must(value, what = 'value') {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

/**
 * The nearest ancestor matching `selector`, or a failure.
 *
 * @param {HTMLElement} element
 * @param {string} selector
 * @returns {HTMLElement}
 */
export function up(element, selector) {
  return must(element.closest(selector), `an ancestor matching ${selector}`);
}
