// Renders ApplePi-time templates in generated compositeProfile files.
import { Liquid } from 'liquidjs';

import type { Profile } from '../profiles/Profile.js';
import type { Settings } from '../settings/Settings.js';
import type { CompositeProfile } from './CompositeProfile.js';
import { createCompositeProfile } from './CompositeProfile.js';
import type { CompositeProfileFile } from './CompositeProfileFile.js';

export interface CompositeProfileTemplateContextInput {
  readonly settings: Settings;
  readonly profile: Profile;
  readonly agentId: string;
  readonly projectDirectory: string;
}

export interface CompositeProfileTemplateRenderInput extends CompositeProfileTemplateContextInput {
  readonly compositeProfile: CompositeProfile;
  readonly settingsPaths: readonly string[];
}

const applepiTemplateEngine = new Liquid({
  outputDelimiterLeft: '[[=',
  outputDelimiterRight: ']]',
  tagDelimiterLeft: '[[%',
  tagDelimiterRight: '%]]',
  strictFilters: true,
  strictVariables: true,
  lenientIf: true,
  ownPropertyOnly: true,
  jekyllInclude: false,
  dynamicPartials: false,
});

export const createCompositeProfileTemplateContext = (
  input: CompositeProfileTemplateContextInput,
): Readonly<Record<string, unknown>> => ({
  applepi: {
    custom_settings: input.settings.customSettings ?? {},
    settings: createTemplateSettings(input.settings),
    profile: input.profile,
    agent: input.agentId,
    project: {
      root: input.projectDirectory,
    },
  },
});

export const renderCompositeProfileTemplates = (input: CompositeProfileTemplateRenderInput): CompositeProfile => {
  const context = createCompositeProfileTemplateContext(input);

  return createCompositeProfile(
    input.compositeProfile.rootDirectory,
    input.compositeProfile.files.map((file) => renderCompositeProfileFile(file, context, input.settingsPaths)),
    input.compositeProfile.statePaths,
  );
};

const renderCompositeProfileFile = (
  file: CompositeProfileFile,
  context: Readonly<Record<string, unknown>>,
  settingsPaths: readonly string[],
): CompositeProfileFile => {
  if (!containsApplePiTemplate(file.content)) {
    return file;
  }

  try {
    return {
      ...file,
      content: renderTemplateContent(file.content, context),
      sourceInputs: [...file.sourceInputs, ...settingsPaths.filter((path) => !file.sourceInputs.includes(path))],
    };
  } catch (error) {
    throw new Error(
      `Cannot render ApplePi template in compositeProfile file '${file.relativePath}': ${formatTemplateError(error)}`,
      {
        cause: error,
      },
    );
  }
};

const renderTemplateContent = (content: string, context: Readonly<Record<string, unknown>>): string => {
  const renderedContent: unknown = applepiTemplateEngine.parseAndRenderSync(content, context);

  /* v8 ignore next -- LiquidJS renders string content to strings; this guards future API regressions. */
  if (typeof renderedContent !== 'string') {
    throw new Error('LiquidJS returned non-string template output.');
  }

  return renderedContent;
};

const containsApplePiTemplate = (content: string): boolean => content.includes('[[=') || content.includes('[[%');

const createTemplateSettings = (settings: Settings): Readonly<Record<string, unknown>> => ({
  default_profile: settings.defaultProfile,
  profile_sources: settings.profileSources,
  remote_settings: settings.remoteSettings,
  cache_directory: settings.cacheDirectory,
  custom_settings: settings.customSettings ?? {},
});

const formatTemplateError = (error: unknown): string => String(error);
