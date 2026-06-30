#!/usr/bin/env node

// Defines the initial Outfitter executable entrypoint.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createOutfitterProgram } from './cli/OutfitterCli.js';

export const createProgram = createOutfitterProgram;

export const isDirectCliExecution = (moduleUrl: string, argvPath: string | undefined): boolean => {
  if (argvPath === undefined) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
};

/* v8 ignore next 3 -- direct bin execution is covered by local install smoke tests. */
if (isDirectCliExecution(import.meta.url, process.argv[1])) {
  await createProgram().parseAsync(process.argv);
}
