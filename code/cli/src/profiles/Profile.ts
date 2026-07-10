// Defines profile shapes and control fragments used during profile resolution.
import type { StatePersistenceStrategy } from '../compositeProfile/StatePersistence.js';

export type StatePersistenceOverrides = Readonly<Record<string, StatePersistenceStrategy>>;
export interface PromptFileInclude {
  readonly file: string;
}
export interface PromptRepoFileInclude {
  readonly repo_file: string;
}
export type AppendSystemPromptEntry = string | PromptFileInclude | PromptRepoFileInclude;
export type AppendSystemPromptControl = AppendSystemPromptEntry | readonly AppendSystemPromptEntry[];

export interface SkillFileReference {
  readonly file: string;
}
export interface SkillRepoFileReference {
  readonly repo_file: string;
}
export type SkillReference = SkillFileReference | SkillRepoFileReference;

/** Expanded `controls.skills` entry appending profile-owned references to a selected skill. */
export interface SkillSelection {
  readonly id: string;
  readonly references?: readonly SkillReference[];
}
export type SkillControlEntry = string | SkillSelection;

export interface DeepWorkProfileControls {
  readonly jobs?: readonly string[];
}

interface BaseProfileControls {
  readonly [controlName: string]: unknown;
  readonly model?: string;
  readonly provider?: string;
  readonly thinking?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly args?: readonly string[];
  readonly sessionDirectory?: string;
  readonly extensions?: readonly string[];
  readonly skills?: readonly SkillControlEntry[];
  readonly promptTemplate?: string;
  readonly systemPrompt?: string;
  readonly appendSystemPrompt?: AppendSystemPromptControl;
  readonly deepwork?: DeepWorkProfileControls;
}

export type AgentSpecificProfileControls = BaseProfileControls;
export type PiProfileControls = AgentSpecificProfileControls;
export type ClaudeProfileControls = AgentSpecificProfileControls;

export interface ProfileControls extends BaseProfileControls {
  readonly pi?: PiProfileControls;
  readonly claude?: ClaudeProfileControls;
}

export interface Profile {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly template?: boolean;
  readonly inherits: readonly string[];
  readonly controls: ProfileControls;
  readonly statePersistence?: StatePersistenceOverrides;
  readonly profileExport?: boolean;
}

export const createEmptyProfile = (id: string): Profile => ({
  id,
  inherits: [],
  controls: {},
  statePersistence: {},
});
