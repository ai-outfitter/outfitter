#!/usr/bin/env bun

// Synchronizes package metadata to the GitHub release version before npm publishing.
// bun.lock is not edited here; the release workflow runs `bun install` afterwards
// so the lockfile picks up the new workspace versions.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  name?: string;
  version?: string;
  repository?: { url?: string };
  [key: string]: unknown;
}

const args = process.argv.slice(2);
const versionArg = args.find((arg) => !arg.startsWith('--'));
const rootArg = args.find((arg) => arg.startsWith('--root='));
const projectRoot = path.resolve(
  rootArg !== undefined ? rootArg.slice('--root='.length) : path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const version = normalizeVersion(versionArg ?? process.env.OUTFITTER_RELEASE_VERSION ?? process.env.GITHUB_REF_NAME);

if (version === undefined) {
  throw new Error('Usage: bun scripts/sync-release-version.ts <version|vversion> [--root=<path>]');
}

const rootPackageJsonPath = path.join(projectRoot, 'package.json');
const rootPackageJson = await readJson(rootPackageJsonPath);
const cliPackageJsonPath = await findCliPackageJsonPath(projectRoot, rootPackageJson);
const cliPackageJson =
  cliPackageJsonPath === rootPackageJsonPath ? rootPackageJson : await readJson(cliPackageJsonPath);

assertPackageName(cliPackageJson);
assertRepositoryUrl(cliPackageJson);

rootPackageJson.version = version;
cliPackageJson.version = version;

if (cliPackageJsonPath !== rootPackageJsonPath) {
  await writeJson(rootPackageJsonPath, rootPackageJson);
}
await writeJson(cliPackageJsonPath, cliPackageJson);

console.log(`Synchronized Outfitter release metadata to ${version}.`);

async function findCliPackageJsonPath(root: string, packageJson: PackageJson): Promise<string> {
  if (packageJson.name === '@ai-outfitter/outfitter') {
    return path.join(root, 'package.json');
  }

  const workspacePath = path.join(root, 'code', 'cli', 'package.json');

  try {
    const workspacePackageJson = await readJson(workspacePath);
    assertPackageName(workspacePackageJson);
    return workspacePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  assertPackageName(packageJson);
  return path.join(root, 'package.json');
}

function normalizeVersion(rawVersion: string | undefined): string | undefined {
  if (rawVersion === undefined || rawVersion === '') {
    return undefined;
  }

  const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

  if (!isSemanticVersion(version)) {
    throw new Error(`Invalid Outfitter release version: ${rawVersion}`);
  }

  return version;
}

function isSemanticVersion(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(
    version,
  );
}

function assertPackageName(packageJson: PackageJson): void {
  if (packageJson.name !== '@ai-outfitter/outfitter') {
    throw new Error(`Expected package name '@ai-outfitter/outfitter' but found '${packageJson.name ?? ''}'.`);
  }
}

function assertRepositoryUrl(packageJson: PackageJson): void {
  const repositoryUrl = packageJson.repository?.url;

  if (repositoryUrl !== 'https://github.com/ai-outfitter/outfitter.git') {
    throw new Error(
      `Expected repository.url 'https://github.com/ai-outfitter/outfitter.git' but found '${repositoryUrl ?? ''}'.`,
    );
  }
}

async function readJson(filePath: string): Promise<PackageJson> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as PackageJson;
}

async function writeJson(filePath: string, value: PackageJson): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
