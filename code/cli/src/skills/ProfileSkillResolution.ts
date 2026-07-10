// Resolves a profile's selected skill IDs into generated skill sources before adapter launch.
import { join } from 'node:path';

import type { LoadedProfile } from '../profiles/ProfileLoader.js';
import type { Profile, ProfileControls, SkillControlEntry } from '../profiles/Profile.js';
import { inferProfileIncludeSourceRoot } from '../profiles/PromptIncludes.js';
import { skillControlEntryIdentity } from '../agents/LaunchResources.js';
import { discoverSkillCatalog, type SkillCatalog } from './SkillCatalog.js';
import { resolveSkillEntries, type SkillEntryInput, type SkillResolutionDiagnostic } from './SkillResolution.js';

export interface ProfileSkillResolutionInput {
  readonly profile: Profile;
  readonly profileLayers: readonly LoadedProfile[];
  /** Materialized configured profile-source paths, in configured order. */
  readonly sourcePaths: readonly string[];
  readonly projectDirectory: string;
  /** Composite profile root; generated skills are written beneath `outfitter/skills/`. */
  readonly outputDirectory?: string;
}

export interface ProfileSkillResolutionResult {
  readonly profile: Profile;
  readonly diagnostics: readonly SkillResolutionDiagnostic[];
}

/**
 * Resolves catalog skill IDs in `controls.skills` (generic and adapter-scoped) to
 * generated skill directories, so adapters keep receiving plain path sources.
 */
export const resolveProfileSkillControls = (input: ProfileSkillResolutionInput): ProfileSkillResolutionResult => {
  const catalog = discoverSkillCatalog({
    projectDirectory: input.projectDirectory,
    profileLayers: input.profileLayers,
    sourcePaths: input.sourcePaths,
  });
  const diagnostics: SkillResolutionDiagnostic[] = [];
  const outputDirectory =
    input.outputDirectory === undefined ? undefined : join(input.outputDirectory, 'outfitter', 'skills');
  const resolveEntries = (entries: readonly SkillControlEntry[]): readonly SkillControlEntry[] => {
    const resolution = resolveSkillEntries({
      entries: entries.map((entry) => toSkillEntryInput(entry, input.profileLayers)),
      catalog,
      projectDirectory: input.projectDirectory,
      outputDirectory,
    });
    diagnostics.push(...resolution.diagnostics);

    return resolution.sources;
  };

  const controls = resolveSkillControls(input.profile.controls, resolveEntries);
  diagnostics.push(...createShadowedSkillDiagnostics(catalog, input.profile.controls));

  return { profile: { ...input.profile, controls }, diagnostics };
};

const resolveSkillControls = (
  controls: ProfileControls,
  resolveEntries: (entries: readonly SkillControlEntry[]) => readonly SkillControlEntry[],
): ProfileControls => ({
  ...controls,
  ...(controls.skills === undefined ? {} : { skills: resolveEntries(controls.skills) }),
  ...(controls.pi?.skills === undefined ? {} : { pi: { ...controls.pi, skills: resolveEntries(controls.pi.skills) } }),
  ...(controls.claude?.skills === undefined
    ? {}
    : { claude: { ...controls.claude, skills: resolveEntries(controls.claude.skills) } }),
});

/** Profile-added `file` references resolve from the repository containing the declaring profile. */
const toSkillEntryInput = (entry: SkillControlEntry, profileLayers: readonly LoadedProfile[]): SkillEntryInput => {
  if (typeof entry === 'string') {
    return { entry };
  }

  const identity = skillControlEntryIdentity(entry);
  const declaringLayer = [...profileLayers]
    .reverse()
    .find((layer) =>
      readLayerSkillEntries(layer.profile.controls).some(
        (layerEntry) => typeof layerEntry !== 'string' && skillControlEntryIdentity(layerEntry) === identity,
      ),
    );

  return {
    entry,
    profileReferenceRoot:
      declaringLayer === undefined
        ? undefined
        : inferProfileIncludeSourceRoot({
            sourceRootPath: declaringLayer.sourceRootPath,
            profilePath: declaringLayer.profilePath,
          }),
  };
};

const readLayerSkillEntries = (controls: ProfileControls): readonly SkillControlEntry[] => [
  ...(controls.skills ?? []),
  ...(controls.pi?.skills ?? []),
  ...(controls.claude?.skills ?? []),
];

/** Reports shadowing only for IDs the profile actually selects. */
const createShadowedSkillDiagnostics = (
  catalog: SkillCatalog,
  controls: ProfileControls,
): readonly SkillResolutionDiagnostic[] => {
  const selectedIds = new Set(
    readLayerSkillEntries(controls).map((entry) => (typeof entry === 'string' ? entry : entry.id)),
  );

  return catalog.shadowed
    .filter((shadow) => selectedIds.has(shadow.selected.id))
    .map((shadow) => ({
      severity: 'warning',
      path: shadow.shadowedDirectory,
      message:
        `Skill ID '${shadow.selected.id}' is supplied by ${shadow.selected.origin} ('${shadow.selected.directory}') ` +
        `and shadows '${shadow.shadowedDirectory}'.`,
    }));
};
