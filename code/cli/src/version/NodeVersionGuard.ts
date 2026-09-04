// Refuses to run on a Node release below the published `engines.node` floor.
//
// npm treats an engines mismatch as a warning, so `npm install -g` and `npx` succeed on
// old Node. Outfitter's own commands then work, and the process only crashes deep inside
// the bundled pi once `run` or `setup` spawns it (issue #368). This guard turns that stack
// trace into a one-line message before any command, including the telemetry notice, runs.
import { readFileSync } from 'node:fs';

export interface NodeVersionCheck {
  readonly required: string;
  readonly current: string;
  readonly satisfied: boolean;
}

// Always yields three parts so comparisons never index past the end.
const parseVersion = (version: string): readonly [number, number, number] => {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/u, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
};

// `engines.node` is required by OFTR-001.1 to be an unbounded `>=x.y.z` range, so only
// that shape is supported. Anything else is treated as satisfied rather than blocking.
const parseMinimum = (range: string): readonly [number, number, number] | undefined => {
  const match = /^>=\s*v?(\d+\.\d+\.\d+)$/u.exec(range.trim());
  return match === null ? undefined : parseVersion(match[1]);
};

export const readRequiredNodeRange = (): string => {
  const packageJsonPath = new URL('../../package.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    readonly engines: { readonly node: string };
  };
  return manifest.engines.node;
};

export const checkNodeVersion = (current: string, required: string): NodeVersionCheck => {
  const minimum = parseMinimum(required);
  if (minimum === undefined) return { required, current, satisfied: true };

  const actual = parseVersion(current);
  const first = minimum.findIndex((part, index) => part !== actual[index]);
  const satisfied = first === -1 || actual[first] > minimum[first];
  return { required, current, satisfied };
};

export const formatNodeVersionError = (check: NodeVersionCheck): string =>
  [
    `Outfitter requires Node ${check.required} but found v${check.current}.`,
    'Upgrade Node (for example with `nvm install --lts`) and run the command again.',
  ].join('\n');

/**
 * Prints the upgrade message and returns false when the running Node is below the
 * published floor. Callers must not import or spawn pi before this returns true.
 */
export const enforceNodeVersion = (
  current: string = process.versions.node,
  required: string = readRequiredNodeRange(),
  writeError: (message: string) => void = console.error,
): boolean => {
  const check = checkNodeVersion(current, required);
  if (!check.satisfied) writeError(formatNodeVersionError(check));
  return check.satisfied;
};
