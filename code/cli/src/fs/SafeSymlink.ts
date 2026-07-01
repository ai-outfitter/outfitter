// Creates symlinks with a Windows-only fallback for environments that deny symlink creation.
import { copyFileSync, cpSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SafeSymlinkInput {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly directory: boolean;
  readonly label: string;
}

export interface SafeSymlinkDependencies {
  readonly symlink?: typeof symlinkSync;
  readonly warn?: (message: string) => void;
  readonly platform?: NodeJS.Platform;
}

// Windows without Developer Mode rejects symlink creation with EPERM. Directories fall
// back to junctions, which need no privilege but require an absolute target; files (and
// directories whose junction also fails) fall back to a one-way copy with a warning
// because agent writes to the copy cannot persist back to the source. On POSIX platforms
// a permission error is a real filesystem problem, so it is rethrown instead of being
// silently downgraded to a copy.
export const createSafeSymlink = (input: SafeSymlinkInput, dependencies: SafeSymlinkDependencies = {}): void => {
  const symlink = dependencies.symlink ?? symlinkSync;
  /* v8 ignore next -- the process platform default is direct runtime behavior; tests inject a platform. */
  const platform = dependencies.platform ?? process.platform;

  try {
    symlink(input.sourcePath, input.outputPath, input.directory ? 'dir' : 'file');
  } catch (error) {
    if (platform !== 'win32' || !isSymlinkPermissionError(error)) {
      throw error;
    }

    createWindowsSafeSymlinkFallback(symlink, input, dependencies.warn);
  }
};

const createWindowsSafeSymlinkFallback = (
  symlink: typeof symlinkSync,
  input: SafeSymlinkInput,
  warn: ((message: string) => void) | undefined,
): void => {
  if (input.directory) {
    try {
      symlink(resolve(input.sourcePath), input.outputPath, 'junction');
      return;
    } catch (error) {
      if (!isSymlinkPermissionError(error)) {
        throw error;
      }
    }
  }

  copySafeSymlinkFallback(input, warn);
};

const copySafeSymlinkFallback = (input: SafeSymlinkInput, warn: ((message: string) => void) | undefined): void => {
  if (input.directory) {
    cpSync(input.sourcePath, input.outputPath, { recursive: true });
  } else {
    copyFileSync(input.sourcePath, input.outputPath);
  }

  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a warn writer. */
  (warn ?? console.error)(
    `${input.label} could not be symlinked (symlinks are unavailable on this platform); ` +
      `copied '${input.sourcePath}' instead, so writes to it will not persist back.`,
  );
};

const isSymlinkPermissionError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES');
