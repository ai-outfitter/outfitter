#!/usr/bin/env node
// Files docs/plans/issues/*.md as GitHub issues via `gh`.
// Dry-run by default; pass --file to create. --only 01,03 files a subset.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSUES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'plans', 'issues');
const args = process.argv.slice(2);
const doFile = args.includes('--file');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1]).split(',') : null;

function parse(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`No frontmatter in ${path}`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    meta[key] = value.startsWith('[')
      ? value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: raw.slice(m[0].length).trim() };
}

const files = readdirSync(ISSUES_DIR)
  .filter((f) => /^\d{2}-.*\.md$/.test(f))
  .sort()
  .filter((f) => !only || only.includes(f.slice(0, 2)));

const allLabels = new Set();
const parsed = files.map((f) => {
  const { meta, body } = parse(join(ISSUES_DIR, f));
  (meta.labels ?? []).forEach((l) => allLabels.add(l));
  return { file: f, meta, body };
});

if (!doFile) {
  for (const { file, meta } of parsed) {
    console.log(`[dry-run] ${file}: "${meta.title}" labels=${(meta.labels ?? []).join(',')}`);
  }
  console.log(`\n${parsed.length} issue(s). Run with --file to create them via gh.`);
  process.exit(0);
}

for (const label of allLabels) {
  try {
    execFileSync('gh', ['label', 'create', label, '--force'], { stdio: 'pipe' });
  } catch (error) {
    console.warn(`label ${label}: ${error.message}`);
  }
}

for (const { file, meta, body } of parsed) {
  const out = execFileSync(
    'gh',
    ['issue', 'create', '--title', meta.title, '--body', body, ...(meta.labels ?? []).flatMap((l) => ['--label', l])],
    { encoding: 'utf8' },
  );
  console.log(`${file} -> ${out.trim()}`);
}
