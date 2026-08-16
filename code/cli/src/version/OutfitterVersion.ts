// Reads the installed Outfitter package version for CLI output and runtime branding.
import { readFileSync } from 'node:fs';

let cachedVersion: string | undefined;

export const readOutfitterVersion = (): string => {
  if (cachedVersion === undefined) {
    const packageJsonPath = new URL('../../package.json', import.meta.url);
    cachedVersion = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { readonly version: string }).version;
  }

  return cachedVersion;
};
