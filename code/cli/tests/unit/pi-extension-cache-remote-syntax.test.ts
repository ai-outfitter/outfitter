// Tests remote Pi extension source syntax without network access.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryRoots: string[] = [];
const spawnSync = vi.fn();

vi.mock('cross-spawn', () => ({ default: { sync: spawnSync } }));

afterEach(() => {
  spawnSync.mockReset();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi extension cache remote syntax', () => {
  it('normalizes github shorthand sources before cloning', async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    const { materializePiExtensionSources } = await import('../../src/agents/pi/PiExtensionCache.js');

    const [extensionPath] = materializePiExtensionSources(['github:ai-outfitter/deepwork'], {
      cacheDirectory: createTemporaryRoot(),
    })!;

    expect(extensionPath).toContain(join('extensions', 'git'));
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', '--', 'https://github.com/ai-outfitter/deepwork.git', extensionPath],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('normalizes git github shorthand sources before cloning', async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    const { materializePiExtensionSources } = await import('../../src/agents/pi/PiExtensionCache.js');

    materializePiExtensionSources(['git:github.com/ai-outfitter/deepwork'], { cacheDirectory: createTemporaryRoot() });

    expect(spawnSync.mock.calls[0]?.[1]).toContain('https://github.com/ai-outfitter/deepwork.git');
  });

  it('uses explicit URL sources and falls back when shallow branch clone fails', async () => {
    spawnSync
      .mockReturnValueOnce({ status: 1, stdout: 'missing branch', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });
    const { materializePiExtensionSources } = await import('../../src/agents/pi/PiExtensionCache.js');

    materializePiExtensionSources(['https://example.test/repo.git#feature'], { cacheDirectory: createTemporaryRoot() });

    expect(spawnSync.mock.calls[0]?.[1]).toContain('https://example.test/repo.git');
    expect(spawnSync.mock.calls[1]?.[1]).toContain('clone');
    expect(spawnSync.mock.calls[2]?.[1]).toContain('checkout');
  });

  it('leaves unrecognized sources unchanged', async () => {
    const { materializePiExtensionSources } = await import('../../src/agents/pi/PiExtensionCache.js');

    expect(materializePiExtensionSources(['named-extension'], { cacheDirectory: createTemporaryRoot() })).toEqual([
      'named-extension',
    ]);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-extension-cache-syntax-'));
  temporaryRoots.push(root);
  return root;
};
