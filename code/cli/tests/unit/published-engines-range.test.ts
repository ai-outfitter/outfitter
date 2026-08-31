// Guards the published `engines.node` range across every manifest. npm resolves a bare
// `npm install -g @ai-outfitter/outfitter` as a version range and silently prefers the newest release
// whose engines the running Node satisfies, so an unsatisfiable upper bound does not warn — it hands
// the user an older major. The tested runtime belongs in `.node-version`, never in `engines`.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ManifestEngines {
  engines?: { node?: string };
}

const readJson = (relativePath: string): ManifestEngines =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as ManifestEngines;

const manifests = [
  ['code/cli/package.json', '../../package.json'],
  ['package.json', '../../../../package.json'],
] as const;

describe('published engines range', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each(manifests)('declares an unbounded node range in %s', (_label, relativePath) => {
    const nodeRange = readJson(relativePath).engines?.node;

    expect(nodeRange).toBe('>=22.19.0');
    // `<`/`<=` bounds and the `x.y.z`-pinning `~`/`^` shorthands all cap the range.
    expect(nodeRange).not.toMatch(/[<~^]/u);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps the pinned development runtime at or above the published floor', () => {
    const order = (version: string): number[] => version.split('.').map(Number);
    const pinned = order(readFileSync(new URL('../../../../.node-version', import.meta.url), 'utf8').trim());
    const floor = order('22.19.0');

    // The CI pin may lead the floor, but it must never fall below what consumers may install on.
    const compared = pinned.findIndex((part, index) => part !== floor[index]);

    expect(compared === -1 || pinned[compared] > floor[compared]).toBe(true);
  });
});
