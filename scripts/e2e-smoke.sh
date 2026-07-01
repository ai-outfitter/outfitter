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

# Fixture HOME: minimal Outfitter settings plus one local profile so every command
# below works offline against the installed artifact (no network, no real \$HOME).
fixture_home="$work_dir/home"
mkdir -p "$fixture_home/.outfitter/profiles/smoke"
cat >"$fixture_home/.outfitter/settings.yml" <<'SETTINGS'
default_profile: smoke
default_agent: pi
cache_directory: ./cache
profile_sources:
  - path: ./profiles
SETTINGS
cat >"$fixture_home/.outfitter/profiles/smoke/profile.yml" <<'PROFILE'
id: smoke
label: Packaged Smoke Profile
controls:
  environment:
    OUTFITTER_SMOKE: 'enabled'
PROFILE

project_dir="$work_dir/project"
mkdir -p "$project_dir"

run_outfitter() {
  HOME="$fixture_home" "$outfitter_bin" "$@"
}

log 'Checking `outfitter --version` (cold start)'
cold_start=$(node -p 'Date.now()')
version_output="$(run_outfitter --version)"
cold_duration=$(( $(node -p 'Date.now()') - cold_start ))
[ "$version_output" = "$expected_version" ] || fail "--version printed '$version_output', expected '$expected_version'"
log "--version OK ($version_output, cold ${cold_duration}ms)"

warm_start=$(node -p 'Date.now()')
run_outfitter --version >/dev/null
warm_duration=$(( $(node -p 'Date.now()') - warm_start ))
log "--version warm rerun OK (${warm_duration}ms)"

log 'Checking `outfitter --help`'
help_output="$(run_outfitter --help)"
case "$help_output" in
  *'Usage: outfitter'*) ;;
  *) fail '--help output is missing the usage banner' ;;
esac
for expected_command in run setup sync profile; do
  case "$help_output" in
    *"$expected_command"*) ;;
    *) fail "--help output is missing the '$expected_command' command" ;;
  esac
done
log '--help OK'

log 'Checking `outfitter profile list` against the fixture HOME'
profile_list_output="$(cd "$project_dir" && run_outfitter profile list)"
[ "$profile_list_output" = 'smoke' ] || fail "profile list printed '$profile_list_output', expected 'smoke'"
log 'profile list OK'

# Non-interactive `outfitter run`: pass `--version` through to the agent so the
# bundled pi resolves, launches, prints its version, and exits without a TTY. This
# exercises profile resolution, composite profile assembly, and bundled-pi bin
# resolution (AgentLaunch) inside the packed artifact.
log 'Checking non-interactive `outfitter run -p smoke -- --version` (bundled pi)'
run_output="$( (cd "$project_dir" && run_outfitter run -p smoke -- --version) 2>&1 )" ||
  fail "outfitter run exited non-zero: $run_output"
case "$run_output" in
  *'launching'*'pi'*) ;;
  *) fail "outfitter run output did not report a pi launch: $run_output" ;;
esac
log 'outfitter run OK'

log "All packaged smoke checks passed (cold ${cold_duration}ms, warm ${warm_duration}ms)"
