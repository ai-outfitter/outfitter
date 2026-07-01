// Resolves the home directory without crashing when the OS cannot report one.
import { homedir } from 'node:os';

// `os.homedir()` throws a SystemError on POSIX when HOME is unset and the
// current UID has no passwd entry (for example containers running arbitrary
// UIDs). Fall back to $HOME, then the current working directory, so adapters
// degrade the way the previous `process.env.HOME ?? '.'` behavior did.
export const safeHomedir = (nativeHomedir: () => string = homedir): string => {
  try {
    return nativeHomedir();
  } catch {
    return process.env.HOME ?? '.';
  }
};
