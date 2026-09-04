#!/usr/bin/env bash
# Packaged end-to-end smoke test: packs the CLI workspace exactly as `npm publish`
# would, installs the tarball globally into a throwaway npm prefix, and exercises the
# shipped `outfitter` bin against a fixture HOME. This catches packaging regressions
# (missing bin wiring, unresolvable bundled pi, broken dist assets) that in-process
# tests can never see. Runs locally (`bash scripts/e2e-smoke.sh`) and in CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/outfitter-e2e-smoke.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

log() {
  printf '\n[e2e-smoke] %s\n' "$1"
}

fail() {
  printf '[e2e-smoke] FAIL: %s\n' "$1" >&2
  exit 1
}

# Millisecond timestamps without spawning a Node process, so measured durations
# do not include interpreter startup cost. EPOCHREALTIME is bash>=5; fall back to
# date +%s%3N (GNU) or python3 for portability.
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    echo $(( ${EPOCHREALTIME/./} / 1000 ))
  elif date +%s%3N 2>/dev/null | grep -qv N; then
    date +%s%3N
  else
    python3 -c 'import time; print(int(time.time()*1000))'
  fi
}

expected_version="$(node -p "require('$repo_root/code/cli/package.json').version")"

log "Packing @ai-outfitter/outfitter v$expected_version"
npm pack --workspace @ai-outfitter/outfitter --pack-destination "$work_dir" --prefix "$repo_root" >/dev/null
tarball="$(ls "$work_dir"/ai-outfitter-outfitter-*.tgz)"
log "Created tarball $(basename "$tarball")"

# Install the tarball globally into an isolated npm prefix, exactly like a user's
# `npm install -g @ai-outfitter/outfitter` (dependencies resolved from the registry).
install_prefix="$work_dir/npm-prefix"
mkdir -p "$install_prefix"
log 'Installing tarball into temp global prefix'
npm install --global --prefix "$install_prefix" "$tarball" >/dev/null

outfitter_bin="$install_prefix/bin/outfitter"
[ -x "$outfitter_bin" ] || fail "installed global bin not found at $outfitter_bin"

# Fixture HOME: a minimal .agents tree plus one agent so the resolver-backed
# commands work offline against the installed artifact (no network, no real \$HOME).
fixture_home="$work_dir/home"
mkdir -p "$fixture_home/.agents/agents/smoke"
cat >"$fixture_home/.agents/settings.yml" <<'SETTINGS'
default_agent: smoke
default_harness: pi
SETTINGS
cat >"$fixture_home/.agents/agents/smoke/agent.md" <<'AGENT'
---
name: smoke
description: Packaged smoke-test agent.
---

# Smoke

Verifies the packaged artifact resolves and composes.
AGENT

project_dir="$work_dir/project"
mkdir -p "$project_dir"

run_outfitter() {
  HOME="$fixture_home" "$outfitter_bin" "$@"
}

log 'Checking `outfitter --version` (cold start)'
cold_start=$(now_ms)
version_output="$(run_outfitter --version)"
cold_duration=$(( $(now_ms) - cold_start ))
[ "$version_output" = "$expected_version" ] || fail "--version printed '$version_output', expected '$expected_version'"
log "--version OK ($version_output, cold ${cold_duration}ms)"

warm_start=$(now_ms)
run_outfitter --version >/dev/null
warm_duration=$(( $(now_ms) - warm_start ))
log "--version warm rerun OK (${warm_duration}ms)"

log 'Checking `outfitter --help`'
help_output="$(run_outfitter --help)"
case "$help_output" in
  *'Usage: outfitter'*) ;;
  *) fail '--help output is missing the usage banner' ;;
esac
for expected_command in run setup list validate dump; do
  case "$help_output" in
    *"$expected_command"*) ;;
    *) fail "--help output is missing the '$expected_command' command" ;;
  esac
done
log '--help OK'

# `outfitter list agents` exercises the resolver over the fixture .agents tree
# inside the packed artifact (dist schemas, bundled parsing) fully offline.
log 'Checking `outfitter list agents` against the fixture HOME'
list_output="$(run_outfitter list agents 2>&1)" || fail "outfitter list exited non-zero: $list_output"
case "$list_output" in
  *'smoke'*) ;;
  *) fail "list agents did not include 'smoke': $list_output" ;;
esac
log 'list agents OK'

# `outfitter validate` exercises the full resolve → validate path on the artifact.
log 'Checking `outfitter validate`'
validate_output="$(run_outfitter validate 2>&1)" || fail "outfitter validate reported problems: $validate_output"
case "$validate_output" in
  *'No issues found'*) ;;
  *) fail "validate did not pass cleanly: $validate_output" ;;
esac
log 'validate OK'

# Replace the bundled Pi entrypoint inside the throwaway install with a process-boundary capture.
# Outfitter still resolves and launches its bundled dependency through the published CLI path; the
# capture avoids opening a TUI while preserving the projected environment and arguments for checks.
pi_manifest="$(find "$install_prefix/lib/node_modules" -path '*/@earendil-works/pi-coding-agent/package.json' -print -quit)"
[ -n "$pi_manifest" ] || fail 'bundled Pi manifest was not installed'
pi_package_root="$(dirname "$pi_manifest")"
pi_bin_relative="$(node -p "require('$pi_manifest').bin.pi")"
pi_bin="$pi_package_root/$pi_bin_relative"

# Launch the real bundled pi through the installed `outfitter run` once before
# stubbing it. `--version` passes through to pi, which prints and exits without a
# TUI.
#
# Why `outfitter --version` above is not enough: outfitter's own CLI never imports
# pi or its dependencies. Pi only loads when outfitter spawns it as a child
# process from `run` or `setup`, so `--version`, `--help`, `list`, and `validate`
# all succeed on a Node that pi cannot run on (issue #368: pi's undici crashes on
# Node < 22.10 while every outfitter-only command works). The stubbed `run` below
# replaces pi's bin, so it never loads pi either. This step is the only place in
# the script, and in CI, where outfitter's launch path into the real pi is
# exercised; keep it even once a Node-version guard exists, because the guard
# checks a version number and a pi upgrade can still break on a supported Node.
log 'Checking installed `outfitter run` launches the bundled pi'
expected_pi_version="$(node -p "require('$pi_manifest').version")"
pi_output="$(cd "$project_dir" && run_outfitter run -- --version 2>&1)" \
  || fail "outfitter run failed to launch the bundled pi: $pi_output"
case "$pi_output" in
  *"$expected_pi_version"*) ;;
  *) fail "outfitter run did not print pi $expected_pi_version: $pi_output" ;;
esac
log "outfitter run launched pi OK ($expected_pi_version)"

capture_dir="$work_dir/run-capture"
mkdir -p "$capture_dir"
cat >"$pi_bin" <<'FAKE_PI'
#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const captureDirectory = process.env.OUTFITTER_E2E_CAPTURE_DIR;
const runtimeDirectory = process.env.PI_CODING_AGENT_DIR;
if (!captureDirectory || !runtimeDirectory) process.exit(91);
mkdirSync(captureDirectory, { recursive: true });
copyFileSync(join(runtimeDirectory, 'settings.json'), join(captureDirectory, 'settings.json'));
copyFileSync(
  join(runtimeDirectory, '.outfitter', 'outfitter-runtime-extension.js'),
  join(captureDirectory, 'outfitter-runtime-extension.js'),
);
writeFileSync(join(captureDirectory, 'args.json'), JSON.stringify(process.argv.slice(2)));
FAKE_PI
chmod +x "$pi_bin"

log 'Checking installed `outfitter run` quiet-startup projection'
run_output="$({
  cd "$project_dir"
  OUTFITTER_E2E_CAPTURE_DIR="$capture_dir" run_outfitter run
} 2>&1)" || fail "outfitter run exited non-zero: $run_output"
[ -z "$run_output" ] || fail "outfitter run printed unexpected startup output: $run_output"
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const capture = process.argv[1];
  const settings = JSON.parse(fs.readFileSync(path.join(capture, "settings.json"), "utf8"));
  if (settings.quietStartup !== true) throw new Error("quietStartup was not projected");
  const extension = fs.readFileSync(path.join(capture, "outfitter-runtime-extension.js"), "utf8");
  if (!extension.includes(`const OUTFITTER_ACTIVE_PROFILE = {"id":"smoke"`)) {
    throw new Error("runtime extension was not stamped with the selected profile");
  }
  const args = JSON.parse(fs.readFileSync(path.join(capture, "args.json"), "utf8"));
  if (!args.includes("--extension")) throw new Error("runtime extension was not passed to Pi");
' "$capture_dir" || fail 'installed run did not project quiet settings and the runtime extension'
log 'installed run quiet-startup projection OK'

log "All packaged smoke checks passed (cold ${cold_duration}ms, warm ${warm_duration}ms)"
