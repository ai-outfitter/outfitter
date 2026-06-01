#!/usr/bin/env node

// Synchronizes package metadata to the GitHub release version before npm publishing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const versionArg = args.find((arg) => !arg.startsWith('--'));
const rootArg = args.find((arg) => arg.startsWith('--root='));
const projectRoot = path.resolve(
  rootArg ? rootArg.slice('--root='.length) : path.dirname(dirnameFromImportMeta(import.meta.url)),
);
const version = normalizeVersion(versionArg ?? process.env.BRIDL_RELEASE_VERSION ?? process.env.GITHUB_REF_NAME);

if (version === undefined) {
  throw new Error('Usage: node scripts/sync-release-version.mjs <version|vversion> [--root=<path>]');
}

await updateJson('package.json', (packageJson) => {
  assertPackageName(packageJson);
  packageJson.version = version;
});

await updateJson('package-lock.json', (lockfile) => {
  assertPackageName(lockfile);
  lockfile.version = version;

  if (lockfile.packages?.[''] === undefined) {
    throw new Error("Expected package-lock.json to include packages[''] root package metadata.");
  }

  assertPackageName(lockfile.packages['']);
  lockfile.packages[''].version = version;
});

console.log(`Synchronized Bridl release metadata to ${version}.`);

function dirnameFromImportMeta(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

function normalizeVersion(rawVersion) {
  if (rawVersion === undefined || rawVersion === '') {
    return undefined;
  }

  const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

  if (!isSemanticVersion(version)) {
    throw new Error(`Invalid Bridl release version: ${rawVersion}`);
  }

  return version;
}

function isSemanticVersion(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(
    version,
  );
}

function assertPackageName(packageJson) {
  if (packageJson.name !== 'bridl') {
    throw new Error(`Expected package name 'bridl' but found '${packageJson.name}'.`);
  }
}

async function updateJson(relativePath, update) {
  const filePath = path.join(projectRoot, relativePath);
  const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  update(value);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
