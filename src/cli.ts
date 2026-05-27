#!/usr/bin/env node

// Defines the initial Bridl Commander program shell and executable entrypoint.
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('bridl')
    .description('Profile-oriented wrapper for launching pi and future agent CLIs.')
    .version('0.1.0');

  return program;
}

/* v8 ignore next 3 -- direct bin execution is covered by future CLI integration tests. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createProgram().parseAsync(process.argv);
}
