/**
 * Package entry for dsh-image-scout.
 *
 * The bundle itself is declarative: `cordis.patch.yml` registers a
 * skill-filesystem provider whose root is this package's `skills/` directory.
 * This module only exposes the package identity and a resolver for tooling and
 * tests, so the installed layout can be inspected without hard-coding paths.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Name reported to the host. Must match the bundle id in cordis.patch.yml. */
export const name = 'image-scout';

export const PACKAGE_NAME = 'dsh-image-scout';

/**
 * Locate the bundled `skills/` directory from the profile's base URL.
 * @param {string} profileBaseUrl - Resolved base URL of the active DSH profile.
 * @returns {string} Absolute path to the bundled skills directory.
 */
export function resolveImageScoutSkillRoot(profileBaseUrl) {
  if (!profileBaseUrl) {
    throw new Error('dsh-image-scout: missing DSH profile baseUrl for package resolution');
  }
  let manifestPath;
  try {
    manifestPath = createRequire(profileBaseUrl).resolve(`${PACKAGE_NAME}/package.json`);
  } catch (error) {
    throw new Error(`dsh-image-scout: cannot resolve ${PACKAGE_NAME}/package.json from the DSH profile`, {
      cause: error,
    });
  }
  return join(dirname(manifestPath), 'skills');
}
