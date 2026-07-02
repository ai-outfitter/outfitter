// Generates native Pi skill definitions from Outfitter profiles.
import { join } from 'node:path';

import type { AgentLaunchProfileLayer } from '../AgentAdapter.js';
import { mergeAgentSpecificControls } from '../AdapterProfileControls.js';
import { createCompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import type { AppendSystemPromptEntry, PiProfileControls, Profile } from '../../profiles/Profile.js';

export const createPiGeneratedSkillFiles = (
  rootDirectory: string,
  generatedSkillProfiles: readonly AgentLaunchProfileLayer[],
): ReturnType<typeof createCompositeProfileFile>[] =>
  generatedSkillProfiles.map((profileLayer) =>
    createCompositeProfileFile({
      rootDirectory,
      relativePath: `skills/${profileLayer.profile.id}/SKILL.md`,
      content: createPiGeneratedSkillMarkdown(profileLayer.profile),
      sourceInputs: profileLayer.sourceInputs ?? [profileLayer.profilePath],
      strategy: 'transform',
    }),
  );

export const createPiGeneratedSkillSources = (
  rootDirectory: string,
  generatedSkillProfiles: readonly AgentLaunchProfileLayer[],
): readonly string[] =>
  generatedSkillProfiles.map((profileLayer) => join(rootDirectory, 'skills', profileLayer.profile.id));

const createPiGeneratedSkillMarkdown = (profile: Profile): string => {
  const controls = mergePiControls(profile.controls);
  const promptReferences = createPromptReferences(controls);
  const runtimeHints = createRuntimeHints(controls);

  return [
    '---',
    `name: ${JSON.stringify(profile.id)}`,
    `description: ${JSON.stringify(profile.description ?? `Adopt the ${profile.label ?? profile.id} Outfitter profile.`)}`,
    '---',
    '',
    `Use this skill when the user asks you to work as, review from, or apply the ${profile.label ?? profile.id} Outfitter profile.`,
    '',
    `Adopt the ${profile.label ?? profile.id} profile for the current task. Preserve the user's requested scope; do not restart the agent or shell out to Outfitter unless explicitly asked.`,
    '',
    ...(runtimeHints.length === 0 ? [] : ['Profile runtime preferences to honor when possible:', ...runtimeHints, '']),
    ...(promptReferences.length === 0
      ? []
      : [
          'Before doing substantive work, read and follow these Outfitter prompt files when they are present in the current project or profile source:',
          ...promptReferences.map((promptReference) => `- ${promptReference}`),
          '',
        ]),
    'Return concise results with changed files, verification evidence, and blockers.',
    '',
  ].join('\n');
};

const createRuntimeHints = (controls: PiProfileControls): readonly string[] => [
  ...(controls.provider === undefined ? [] : [`- Provider: ${controls.provider}`]),
  ...(controls.model === undefined ? [] : [`- Model: ${controls.model}`]),
  ...(controls.thinking === undefined ? [] : [`- Thinking: ${controls.thinking}`]),
  ...(controls.systemPrompt === undefined ? [] : [`- System prompt file: ${controls.systemPrompt}`]),
  ...(controls.promptTemplate === undefined ? [] : [`- Prompt template: ${controls.promptTemplate}`]),
];

const createPromptReferences = (controls: PiProfileControls): readonly string[] => [
  ...toPromptReferenceArray(controls.appendSystemPrompt),
  ...(controls.promptTemplate === undefined ? [] : [controls.promptTemplate]),
];

const toPromptReferenceArray = (value: PiProfileControls['appendSystemPrompt']): readonly string[] => {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]).map(formatPromptReference);
};

const formatPromptReference = (entry: AppendSystemPromptEntry): string => {
  if (typeof entry === 'string') {
    return entry;
  }

  if ('file' in entry) {
    return entry.file;
  }

  return entry.repo_file;
};

const mergePiControls = (controls: Profile['controls']): PiProfileControls =>
  mergeAgentSpecificControls<PiProfileControls>(controls, 'pi');
