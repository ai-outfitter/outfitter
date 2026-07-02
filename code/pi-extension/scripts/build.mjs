#!/usr/bin/env node

// Bundles the Outfitter Pi extension into a single ESM artifact the CLI ships and
// injects into pi via `--extension`. The bundle must stay a single readable file:
// the CLI writes exactly one extension file into the user's pi config directory,
// and the CLI test suite inspects that file's content.
//
// `@earendil-works/pi-tui` stays external because pi provides it at runtime; the
// type-check step in `npm run build` is what pins Outfitter to pi's real API.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [join(packageRoot, 'src', 'index.ts')],
  outfile: join(packageRoot, 'dist', 'outfitter-extension.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  charset: 'utf8',
  minify: false,
  external: ['@earendil-works/pi-tui'],
  legalComments: 'none',
});

console.log('Built dist/outfitter-extension.js');
