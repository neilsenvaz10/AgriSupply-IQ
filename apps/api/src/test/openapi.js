import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A small JSON-Schema-subset validator for docs/api/express.openapi.json (type incl. type arrays
 * such as ["string","null"], enum, required, properties, additionalProperties, items, pattern,
 * minimum, $ref). No extra dependency; shared by the contract and market tests.
 */

export const document = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../docs/api/express.openapi.json', import.meta.url)),
    'utf8',
  ),
);

/** @param {string} ref */
export function resolve(ref) {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node, key) => node[key], document);
}

/**
 * @param {any} schema
 * @param {unknown} value
 * @param {string} where
 * @returns {string[]} violations
 */
export function validate(schema, value, where = '$') {
  if (Array.isArray(schema.type)) {
    if (value === null && schema.type.includes('null')) return [];
    const concrete = schema.type.find((/** @type {string} */ t) => t !== 'null');
    return validate({ ...schema, type: concrete }, value, where);
  }
  if (schema.$ref) return validate(resolve(schema.$ref), value, where);
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: not in enum`);
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [...errors, `${where}: expected object`];
      }
      const record = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${where}.${key}: missing`);
      }
      for (const [key, v] of Object.entries(record)) {
        const sub = schema.properties?.[key];
        if (sub) errors.push(...validate(sub, v, `${where}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${where}.${key}: not allowed`);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [...errors, `${where}: expected array`];
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${where}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [...errors, `${where}: expected string`];
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        errors.push(`${where}: pattern`);
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value)))
        errors.push(`${where}: date-time`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) return [...errors, `${where}: expected integer`];
      if (schema.minimum !== undefined && /** @type {number} */ (value) < schema.minimum)
        errors.push(`${where}: minimum`);
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value))
        errors.push(`${where}: expected number`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${where}: expected boolean`);
      break;
    default:
      break;
  }
  return errors;
}
