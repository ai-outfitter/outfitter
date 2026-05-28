#!/usr/bin/env node

// Defines the initial Bridl executable entrypoint.
import { pathToFileURL } from 'node:url';

import { createBridlProgram } from './cli/BridlCli.js';

export const createProgram = createBridlProgram;

/* v8 ignore next 3 -- direct bin execution is covered by future CLI integration tests. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createProgram().parseAsync(process.argv);
}
