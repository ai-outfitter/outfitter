// Prepares opt-in generated system prompt snapshots next to the selected profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { mergeAgentSpecificControls } from '../agents/AdapterProfileControls.js';
import type { AgentLaunchProfileLayer } from '../agents/AgentAdapter.js';
import type { Profile, ProfileControls } from '../profiles/Profile.js';
import { resolveAppendSystemPromptControl } from '../profiles/PromptIncludes.js';
import type { LoadedProfile } from '../profiles/ProfileLoader.js';
import type { Settings } from '../settings/Settings.js';

// The export is written for whichever adapter is launching. Only 'pi' and
// 'claude' have distinct prompt-composition semantics today; any other id
// (or an omitted one) falls back to the Pi rendering.
type ExportAgentKey = 'pi' | 'claude';

const toExportAgentKey = (agentId: string | undefined): ExportAgentKey => (agentId === 'claude' ? 'claude' : 'pi');

export interface SystemPromptExportInput {
  readonly profile: Profile;
  readonly settings: Settings;
  readonly profileLayers: readonly LoadedProfile[];
  readonly cacheDirectory: string;
  // Adapter selected for this launch. Determines how the snapshot is rendered
  // and labelled; defaults to Pi when omitted.
  readonly agentId?: string;
  // Project directory the launch runs in, used to resolve `repo_file:` prompt
  // includes exactly as the launch itself resolves them.
  readonly projectDirectory?: string;
  readonly warn: (message: string) => void;
}

export interface SystemPromptExportResult {
  readonly outputPath?: string;
}

/* v8 ignore start -- rare skip/error branches are defensive around external profile ownership; main export behavior is unit covered. */
export const exportSystemPromptIfEnabled = (input: SystemPromptExportInput): SystemPromptExportResult => {
  if (!isSystemPromptExportEnabled(input.profile, input.settings)) {
    return {};
  }

  const owner = findSelectedProfileOwner(input.profile, input.profileLayers);

  if (owner === undefined) {
    input.warn(`System prompt export skipped for profile '${input.profile.id}' because no source profile was found.`);
    return {};
  }

  if (isCacheBackedProfile(owner, input.cacheDirectory)) {
    input.warn(
      `System prompt export skipped for profile '${input.profile.id}' because its source is cache-backed. ` +
        'Copy or symlink the profile into a local profile source to export generated prompts.',
    );
    return {};
  }

  const outputPath = resolveSystemPromptExportPath(input.profile, owner);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    renderGeneratedSystemPrompt({
      profile: input.profile,
      agentKey: toExportAgentKey(input.agentId),
      profileLayers: input.profileLayers,
      projectDirectory: input.projectDirectory,
    }),
  );

  return { outputPath };
};

/* v8 ignore stop */
/* v8 ignore next -- fallback precedence is schema-level behavior; enabled/disabled outcomes are covered. */
export const isSystemPromptExportEnabled = (profile: Profile, settings: Settings): boolean =>
  profile.profileExport ?? settings.profileExport ?? false;

export interface RenderGeneratedSystemPromptInput {
  readonly profile: Profile;
  readonly agentKey?: ExportAgentKey;
  readonly profileLayers?: readonly LoadedProfile[];
  readonly projectDirectory?: string;
}

export const renderGeneratedSystemPrompt = (input: RenderGeneratedSystemPromptInput): string => {
  const agentKey = input.agentKey ?? 'pi';
  const controls = mergeAgentSpecificControls<ProfileControls>(input.profile.controls, agentKey);
  const appendPrompts = resolveEffectiveAppendPrompts(input, agentKey, controls);
  const heading = renderPromptBody(input.profile, controls, appendPrompts, agentKey);

  return [...exportHeader(agentKey), ...heading].join('\n');
};

// Resolve the effective append prompts exactly as the launch does: reusing the
// launch-time resolver means typed `{ file: … }` / `{ repo_file: … }` includes
// are read into their contents and adapter overrides are honored, rather than
// being silently dropped.
const resolveEffectiveAppendPrompts = (
  input: RenderGeneratedSystemPromptInput,
  agentKey: ExportAgentKey,
  controls: ProfileControls,
): readonly string[] =>
  resolveAppendSystemPromptControl({
    fallback: controls.appendSystemPrompt,
    profileLayers: toLaunchProfileLayers(input.profileLayers ?? []),
    agentKey,
    projectDirectory: input.projectDirectory,
  }).prompts;

const renderPromptBody = (
  profile: Profile,
  controls: ProfileControls,
  appendPrompts: readonly string[],
  agentKey: ExportAgentKey,
): readonly string[] => [
  agentKey === 'claude' ? '# Generated Claude system prompt' : '# Generated Pi prompt fallback',
  '',
  `Profile: ${profile.id}`,
  `Prompt source: ${agentKey === 'claude' ? 'Claude' : 'Pi'} launch controls`,
  '',
  '## system_prompt',
  '',
  controls.systemPrompt ?? '(none)',
  '',
  ...appendPrompts.flatMap((prompt, index) => [`## append_system_prompt[${index}]`, '', prompt, '']),
  ...(appendPrompts.length === 0 ? ['## append_system_prompt', '', '(none)', ''] : []),
];

// Pi keeps its historical "fallback" heading because the Pi launch extension
// overwrites this file at session start with the true runtime prompt. Claude
// Code exposes no runtime read-back, so its snapshot is the authoritative record
// of the prompt inputs Outfitter supplies via flags — labelled accordingly.
const exportHeader = (agentKey: ExportAgentKey): readonly string[] =>
  agentKey === 'claude'
    ? [
        '<!-- Generated by Outfitter from the composed profile controls handed to Claude Code ' +
          '(--system-prompt / --append-system-prompt). Claude Code has no runtime prompt read-back, so this reflects ' +
          "the prompt inputs Outfitter supplies, not Claude's full base prompt. Safe to review or git-ignore. Do not edit by hand. -->",
      ]
    : [
        '<!-- Generated by Outfitter before Pi runtime capture. The Pi launch extension overwrites this with ctx.getSystemPrompt(). -->',
      ];

const toLaunchProfileLayers = (profileLayers: readonly LoadedProfile[]): readonly AgentLaunchProfileLayer[] =>
  profileLayers.map((layer) => ({
    profile: layer.profile,
    profilePath: layer.profilePath,
    sourceRootPath: layer.sourceRootPath,
    resourceRootPath: layer.resourceRootPath,
    layout: layer.layout,
  }));

const findSelectedProfileOwner = (
  profile: Profile,
  profileLayers: readonly LoadedProfile[],
): LoadedProfile | undefined => profileLayers.filter((layer) => layer.profile.id === profile.id).at(-1);

const resolveSystemPromptExportPath = (profile: Profile, owner: LoadedProfile): string => {
  const root = owner.resourceRootPath ?? dirname(owner.profilePath);
  const outputPath =
    owner.layout === 'flat-file'
      ? join(root, `${profile.id}.generated-system-prompt.md`)
      : join(root, 'generated-system-prompt.md');

  return assertInsideRoot(root, outputPath);
};

/* v8 ignore start -- path escape protection is defensive; normal generated output path behavior is unit covered. */
const assertInsideRoot = (root: string, path: string): string => {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (relativePath === '' || !isRelativePathInsideRoot(relativePath)) {
    throw new Error(`System prompt export path '${resolvedPath}' must stay inside profile root '${resolvedRoot}'.`);
  }

  return resolvedPath;
};

const isRelativePathInsideRoot = (relativePath: string): boolean =>
  relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);

/* v8 ignore stop */
const isCacheBackedProfile = (owner: LoadedProfile, cacheDirectory: string): boolean => {
  /* v8 ignore next -- remote-source ownership is a defensive skip path for generated prompt export. */
  if (owner.source.uri !== undefined || owner.source.github !== undefined) {
    return true;
  }

  const relativePath = relative(resolve(cacheDirectory), resolve(owner.profilePath));
  return relativePath !== '' && isRelativePathInsideRoot(relativePath);
};
