/**
 * Personal logins of human reviewers and approvers (Milestone 2.4, Stage 3c). NOT run by the product, and NOT run
 * until the authorization gate for real logins has been passed (docs/geography/STAGE_3C_OPERATOR_RUNBOOK.md).
 *
 *   node scripts/review-logins.js provision --person <id> --kind reviewer|approver --valid-days <1-90> --credential-file <path>
 *   node scripts/review-logins.js revoke --person <id> --kind reviewer|approver
 *   node scripts/review-logins.js revoke-all           (emergency: every review login at once)
 *   node scripts/review-logins.js list
 *
 * An ADMINISTRATOR runs it with DATABASE_ADMIN_URL in the environment; it reads no .env file. The password is
 * written only to the credential file (outside Git, owner-only) and never printed. The person receives the file
 * by a channel outside this repository and the administrator deletes the original.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  listReviewLogins,
  loginName,
  provisionReviewLogin,
  revokeAllReviewLogins,
  revokeReviewLogin,
} from '../src/identity/logins.js';
import { restrictToOwner } from '../src/reference/devLoad/secureFile.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [action, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    person: { type: 'string' },
    kind: { type: 'string' },
    'valid-days': { type: 'string', default: '30' },
    'credential-file': { type: 'string' },
  },
});

try {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const kind = /** @type {'reviewer' | 'approver'} */ (values.kind);
    if (action === 'provision') {
      if (!values.person || !values.kind) throw new Error('--person and --kind are required');
      const file = values['credential-file'];
      if (!file) throw new Error('--credential-file is required');
      const rel = relative(REPO_ROOT, resolve(file));
      if (!rel.startsWith('..') && !isAbsolute(rel))
        throw new Error('the credential file must be outside the Git working tree');
      const days = Number(values['valid-days']);
      const { role, password } = await provisionReviewLogin(client, {
        person: values.person,
        kind,
        validUntil: new Date(Date.now() + days * 86_400_000),
      });
      const loginUrl = new URL(url);
      loginUrl.username = role;
      loginUrl.password = password;
      mkdirSync(dirname(resolve(file)), { recursive: true });
      writeFileSync(file, `DATABASE_REVIEW_URL=${loginUrl.toString()}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      restrictToOwner(file);
      console.log(
        `login ${role} created (${kind}), valid ${days} days; credential written to ${file}`,
      );
    } else if (action === 'revoke') {
      if (!values.person || !values.kind) throw new Error('--person and --kind are required');
      const result = await revokeReviewLogin(client, loginName(values.person, kind));
      console.log(result.dropped ? 'login revoked and dropped' : 'no such login');
    } else if (action === 'revoke-all') {
      const done = await revokeAllReviewLogins(client);
      console.log(`${done.length} review login(s) revoked: ${done.join(', ') || 'none'}`);
    } else if (action === 'list') {
      for (const r of await listReviewLogins(client))
        console.log(
          `${r.role}  group=${r.group}  login=${r.can_login}  valid_until=${r.valid_until}  limit=${r.connection_limit}`,
        );
    } else {
      console.error('usage: review-logins.js <provision|revoke|revoke-all|list> [options]');
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
