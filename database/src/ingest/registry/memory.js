import { randomUUID } from 'node:crypto';
import { Resolver } from '../resolver.js';

/**
 * A resolver whose geography comes from a reference set held in memory. Used by dry runs, so the
 * full parsing, validation and identity rules can run (and be profiled) without any database.
 *
 * @param {import('./lgd.js').ReferenceSet} reference
 * @param {Map<string, any>} decisions Decisions already filtered for the dataset's source.
 */
export function resolverFromReference(reference, decisions) {
  const stateIds = new Map();
  const states = reference.states.map((s) => {
    const id = randomUUID();
    stateIds.set(s.code, id);
    return { id, name: s.name, lgd: s.code, kind: s.kind };
  });
  const districts = reference.districts.map((d) => ({
    id: randomUUID(),
    stateId: stateIds.get(d.stateCode),
    name: d.name,
    lgd: d.code,
  }));
  return new Resolver({ sourceId: 'dry-run', runId: null, states, districts, decisions });
}
