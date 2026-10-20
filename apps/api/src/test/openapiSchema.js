import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { document } from './openapi.js';

/**
 * Schema validation of API responses against docs/api/express.openapi.json with Ajv (JSON Schema
 * 2020-12, the dialect OpenAPI 3.1 uses). Unlike the small validator in ./openapi.js it understands
 * the whole vocabulary the document uses: type arrays, enum, const, required, additionalProperties,
 * items, pattern, format (date-time), minimum, maximum, oneOf and $ref.
 *
 * It needs no database and no network, so it can run in CI. A contract change that makes a captured
 * real response invalid fails here.
 */

// The packages are CommonJS; their default export is the class / function itself.
const Ajv2020 = /** @type {any} */ (Ajv2020Module);
const addFormats = /** @type {any} */ (addFormatsModule);

const BASE = 'https://fasalytics.invalid/openapi';

/**
 * Builds a validator over a set of component schemas.
 *
 * @param {Record<string, any>} [schemas] defaults to the document's components
 */
export function createSchemaValidator(schemas = document.components.schemas) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Re-point "#/components/schemas/X" references at the $defs of one schema resource.
  const defs = JSON.parse(JSON.stringify(schemas).replaceAll('#/components/schemas/', '#/$defs/'));
  ajv.addSchema({ $id: BASE, $defs: defs });
  /** @param {string} name */
  const compile = (name) => ajv.compile({ $ref: `${BASE}#/$defs/${name}` });
  /**
   * @param {string} schemaName a key of components.schemas
   * @param {unknown} value
   * @returns {{ valid: boolean, errors: string[] }}
   */
  const check = (schemaName, value) => {
    const validate = compile(schemaName);
    const valid = validate(value);
    return {
      valid: Boolean(valid),
      errors: (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`),
    };
  };
  return { check };
}

/**
 * The operation (path template and response schema name) documented for a request.
 *
 * @param {string} method
 * @param {string} pathname e.g. /api/v1/markets/0000...
 * @param {number} status
 * @returns {{ template: string, schemaRef: string | null } | null}
 */
export function documentedResponse(method, pathname, status) {
  const paths = Object.keys(document.paths);
  const literal = paths.find((p) => p === pathname);
  const templated = paths.find(
    (p) => p.includes('{') && new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname),
  );
  const template = literal ?? templated;
  if (!template) return null;
  const operation = document.paths[template][method.toLowerCase()];
  const response = operation?.responses?.[String(status)];
  const ref = response?.content?.['application/json']?.schema?.$ref;
  return { template, schemaRef: typeof ref === 'string' ? (ref.split('/').at(-1) ?? null) : null };
}
