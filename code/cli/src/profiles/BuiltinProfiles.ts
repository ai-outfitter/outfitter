// Provides the built-in fallback profiles bundled inside the npm package. They keep first-run
// onboarding working offline (degraded mode) when the remote default profile catalog cannot sync.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const builtinStarterProfileId = 'starter';

interface BuiltinProfileFile {
  readonly relativePath: string;
  readonly content: string;
}

// Sane engineering defaults with no remote extensions, so the profile works with no network.
const builtinProfileFiles: readonly BuiltinProfileFile[] = [
  {
    relativePath: join(builtinStarterProfileId, 'profile.yml'),
    content: [
      `id: ${builtinStarterProfileId}`,
      'label: Starter',
      'description: >-',
      '  Built-in Outfitter starter profile with sane engineering defaults and no remote',
      '  extensions. Used when the default profile catalog cannot be synced; run',
      '  `outfitter sync` to upgrade to the full catalog once the source is reachable.',
      'controls: {}',
      '',
    ].join('\n'),
  },
];

export const createBuiltinProfilesCachePath = (homeDirectory: string): string =>
  join(homeDirectory, '.outfitter', 'cache', 'builtin-profiles');

// Writes the bundled profiles into the target directory without overwriting existing files and
// returns the number of files written.
export const materializeBuiltinProfiles = (targetDirectory: string): number => {
  let writtenFiles = 0;

  for (const file of builtinProfileFiles) {
    const targetPath = join(targetDirectory, file.relativePath);

    if (existsSync(targetPath)) {
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
    writtenFiles += 1;
  }

  return writtenFiles;
};
