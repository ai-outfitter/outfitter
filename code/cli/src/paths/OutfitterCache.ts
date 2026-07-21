// Resolves Outfitter's XDG cache directory. This is separate from the remote-source cache
// (`~/.agents/cache`, see resolver/Layer.ts) — it holds machine-local build artifacts such as
// installed pi extensions that are cheap to recreate and should not live in the .agents tree.
import { join } from 'node:path';

/**
 * Standard XDG cache root for Outfitter: `$XDG_CACHE_HOME/outfitter` when set, else
 * `<home>/.cache/outfitter`. `env` and `homeDirectory` are injected so the resolution is pure and
 * unit-testable.
 */
export const resolveOutfitterCacheDir = (
  env: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string => {
  const xdgCacheHome = env.XDG_CACHE_HOME;
  if (xdgCacheHome !== undefined && xdgCacheHome.trim() !== '') {
    return join(xdgCacheHome, 'outfitter');
  }
  return join(homeDirectory, '.cache', 'outfitter');
};
