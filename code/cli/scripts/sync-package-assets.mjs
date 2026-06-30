#!/usr/bin/env node

// Stages repository-level license and README assets inside the CLI package before packing.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(packageRoot, '..', '..');

const copies = [
  ['README.md', 'README.md'],
  ['LICENSE.md', 'LICENSE.md'],
  [join('code', 'enterprise', 'LICENSE'), join('code', 'enterprise', 'LICENSE')],
  [join('code', 'enterprise', 'README.md'), join('code', 'enterprise', 'README.md')],
];

for (const [from, to] of copies) {
  const destination = join(packageRoot, to);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(repositoryRoot, from), destination);
}
