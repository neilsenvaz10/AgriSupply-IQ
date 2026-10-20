/**
 * Provisions or revokes the dedicated, short-lived login of the controlled development LGD reference load.
 *
 *   node scripts/ref-loader-role.js provision --credential-file <path outside Git> [--valid-hours 12]
 *   node scripts/ref-loader-role.js revoke
 *
 * An ADMINISTRATOR runs it with DATABASE_ADMIN_URL (a superuser connection) set explicitly in the environment:
 * it reads no .env file. The generated password is written to the credential file (outside Git, created with
 * owner-only permissions, refused if it exists) and never printed. The login can log in only until its
 * VALID UNTIL. `revoke` drops it; run it after every load, successful or not.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { restrictToOwner } from '../src/reference/devLoad/secureFile.js';
import {
  DEFAULT_LOADER_ROLE,
  provisionLoaderRole,
  revokeLoaderRole,
} from '../src/reference/devLoad/loaderRole.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [action, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'credential-file': { type: 'string' },
    'valid-hours': { type: 'string', default: '12' },
    role: { type: 'string', default: DEFAULT_LOADER_ROLE },
  },
});

try {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set');
  const u = new URL(url);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    if (action === 'provision') {
      const file = values['credential-file'];
      if (!file) throw new Error('--credential-file is required');
      const rel = relative(REPO_ROOT, resolve(file));
      if (!rel.startsWith('..') && !isAbsolute(rel))
        throw new Error('the credential file must be outside the Git working tree');
      const hours = Number(values['valid-hours']);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24)
        throw new Error('--valid-hours must be between 0 and 24');
      const { role, password } = await provisionLoaderRole(client, {
        role: values.role,
        validUntil: new Date(Date.now() + hours * 3_600_000),
      });
      const loaderUrl = new URL(url);
      loaderUrl.username = role;
      loaderUrl.password = password;
      mkdirSync(dirname(resolve(file)), { recursive: true });
      writeFileSync(file, `DATABASE_REF_LOADER_URL=${loaderUrl.toString()}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      restrictToOwner(file);
      console.log(
        `loader login ${role} created on ${u.hostname}:${u.port || 5432}, valid ${hours} h; credential written to ${file}`,
      );
    } else if (action === 'revoke') {
      const result = await revokeLoaderRole(client, { role: values.role });
      console.log(
        result.dropped
          ? `loader login ${values.role} revoked and dropped`
          : `loader login ${values.role} did not exist`,
      );
    } else {
      console.error('usage: ref-loader-role.js <provision|revoke> [options]');
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
