import { execFileSync } from 'node:child_process';
import { chmodSync, statSync } from 'node:fs';

/**
 * Owner-only protection of the files of a controlled development load (authorizations, loader credentials,
 * evidence, reports). On POSIX that is mode 600. On Windows the POSIX mode bits mean nothing and a new file
 * inherits the ACL of its folder (often `BUILTIN\Users` with modify rights), so the inherited entries are removed
 * and only the current user is granted access with `icacls`.
 */

/** Principals that must never appear on an authorization or a credential file. */
const BROAD =
  /(^|\s)(Everyone|BUILTIN\\Users|NT AUTHORITY\\Authenticated Users|[A-Za-z0-9 _-]+\\Domain Users):/i;

/**
 * The lines of `icacls <file>` output that grant access to a broad group.
 * @param {string} output
 * @returns {string[]}
 */
export function broadAclEntries(output) {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => BROAD.test(l));
}

/**
 * @param {string} path
 * @param {NodeJS.Platform} [platform]
 */
export function restrictToOwner(path, platform = process.platform) {
  if (platform === 'win32') {
    const user = process.env.USERNAME ?? '';
    if (!user) throw new Error('USERNAME is not set: cannot restrict the file to its owner');
    const domain = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : '';
    // remove the inherited entries, then every broad group by SID (Everyone, Users, Authenticated Users), then
    // grant the current user alone
    execFileSync(
      'icacls',
      [path, '/inheritance:r', '/remove:g', '*S-1-1-0', '*S-1-5-32-545', '*S-1-5-11'],
      { stdio: 'ignore' },
    );
    execFileSync('icacls', [path, '/grant:r', `${domain}${user}:(F)`], { stdio: 'ignore' });
  } else {
    chmodSync(path, 0o600);
  }
}

/**
 * Why the file is not owner-only, or null.
 * @param {string} path
 * @param {NodeJS.Platform} [platform]
 * @returns {string | null}
 */
export function ownerOnlyProblem(path, platform = process.platform) {
  if (platform === 'win32') {
    const output = execFileSync('icacls', [path], { encoding: 'utf8' });
    const broad = broadAclEntries(output);
    return broad.length > 0
      ? `its ACL grants access to ${broad.map((l) => l.replace(/^.*?(\S+:\S*)$/, '$1')).join(', ')}: run restrictToOwner (icacls /inheritance:r)`
      : null;
  }
  const bits = statSync(path).mode & 0o777;
  return (bits & 0o077) !== 0
    ? `mode ${bits.toString(8)} gives access to group or other: use chmod 600`
    : null;
}
