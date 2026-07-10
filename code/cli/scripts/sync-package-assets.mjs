#!/usr/bin/env node

// Stages repository-level license and README assets inside the CLI package before packing.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(packageRoot, '..', '..');
const enterprisePrivateCatalogModule = await import(new URL('../../enterprise/privateCatalog.js', import.meta.url));

const privateCatalogRequiresEnterpriseLicense = enterprisePrivateCatalogModule.requiresEnterprisePrivateCatalogLicense({
  visibility: 'private',
});

if (!privateCatalogRequiresEnterpriseLicense) {
  throw new Error('Private catalog support must remain inside the enterprise license boundary.');
}

if (enterprisePrivateCatalogModule.enterprisePrivateCatalogBoundary.strictPrivateRepositoryBlocking !== false) {
  throw new Error('Enterprise private catalog boundary must remain non-enforcing in package assets.');
}

const copies = [
  ['README.md', 'README.md', false],
  ['LICENSE.md', 'LICENSE.md', false],
  [join('code', 'enterprise'), join('code', 'enterprise'), true],
  [join('code', 'pi-extension', 'src'), join('code', 'pi-extension', 'src'), true],
  // The bundled Outfitter self-documentation skill and the docs its `file:` references
  // resolve to keep their repository-relative paths, so the packaged layout resolves the
  // skill exactly like the repository layout does.
  [join('.outfitter', 'skills'), join('.outfitter', 'skills'), true],
  [join('docs', 'documentation'), join('docs', 'documentation'), true],
  // Keep cross-references from the shipped documentation working in the package:
  // README.md links ../philosophy.md and state.md links ../architecture/state_writeback_strategy.md.
  [join('docs', 'philosophy.md'), join('docs', 'philosophy.md'), false],
  [
    join('docs', 'architecture', 'state_writeback_strategy.md'),
    join('docs', 'architecture', 'state_writeback_strategy.md'),
    false,
  ],
];

for (const [from, to, recursive] of copies) {
  const destination = join(packageRoot, to);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(repositoryRoot, from), destination, { recursive, force: true });
}

await writeFile(
  join(packageRoot, 'code', 'enterprise', 'private-catalog-boundary.json'),
  `${JSON.stringify(
    {
      ...enterprisePrivateCatalogModule.enterprisePrivateCatalogBoundary,
      privateCatalogRequiresEnterpriseLicense,
    },
    null,
    2,
  )}\n`,
);
