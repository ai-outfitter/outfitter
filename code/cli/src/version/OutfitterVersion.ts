// Reads the installed Outfitter package version for CLI output and runtime branding.
import { readFileSync } from 'node:fs';

export const readOutfitterVersion = (): string => {
  const packageJsonPath = new URL('../../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { readonly version: string };

  return packageJson.version;
};
