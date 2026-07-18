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
for expected_command in run list validate dump; do
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

log "All packaged smoke checks passed (cold ${cold_duration}ms, warm ${warm_duration}ms)"
