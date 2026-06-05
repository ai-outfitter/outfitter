#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chmod, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';

const VERSION = '0.7.7';
const REPO = 'TurtleTech-ehf/snapper';

const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = targets[`${process.platform}-${process.arch}`];

if (!target) {
  console.error(`Unsupported snapper-fmt platform: ${process.platform}-${process.arch}`);
  process.exit(1);
}

const cacheDir = join(projectRoot, 'node_modules', '.cache', 'snapper-fmt', VERSION, target);
const snapperPath = join(cacheDir, `snapper-fmt-${target}`, 'snapper');

const rawArgs = process.argv.slice(2);
const useGitMarkdownFiles = rawArgs.includes('--git-md');
const snapperArgs = rawArgs.filter((arg) => arg !== '--git-md');

if (useGitMarkdownFiles) {
  const result = spawnSync('git', ['ls-files', '-z', '*.md'], { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const files = result.stdout.split('\0').filter(Boolean);
  snapperArgs.push(...files);
}

await ensureSnapper();

const result = spawnSync(snapperPath, snapperArgs, { cwd: projectRoot, stdio: 'inherit' });
process.exit(result.status ?? 1);

async function ensureSnapper() {
  if (existsSync(snapperPath)) {
    return;
  }

  mkdirSync(cacheDir, { recursive: true });

  const archiveName = `snapper-fmt-${target}.tar.xz`;
  const baseUrl = `https://github.com/${REPO}/releases/download/v${VERSION}`;
  const archivePath = join(cacheDir, archiveName);
  const checksumPath = `${archivePath}.sha256`;

  await download(`${baseUrl}/${archiveName}`, archivePath);
  await download(`${baseUrl}/${archiveName}.sha256`, checksumPath);
  await verifyChecksum(archivePath, checksumPath);

  const tar = spawnSync('tar', ['-xJf', archivePath, '-C', cacheDir], { cwd: cacheDir, stdio: 'inherit' });
  if (tar.status !== 0) {
    process.exit(tar.status ?? 1);
  }

  await chmod(snapperPath, 0o755);
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });
}

async function download(url, destination) {
  await pipeline(await request(url), createWriteStream(destination));
}

function request(url, redirects = 0) {
  return new Promise((resolveStream, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'applepi-snapper-runner' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          if (redirects > 5 || !response.headers.location) {
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }
          resolveStream(request(new URL(response.headers.location, url).toString(), redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
          return;
        }

        resolveStream(response);
      })
      .on('error', reject);
  });
}

async function verifyChecksum(archivePath, checksumPath) {
  const expected = (await readFile(checksumPath, 'utf8')).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex');

  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${archivePath}: expected ${expected}, got ${actual}`);
  }
}
