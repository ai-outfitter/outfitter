// Renders Bridl-time templates in generated tack files.
import { Liquid } from 'liquidjs';

import type { Profile } from '../profiles/Profile.js';
import type { Settings } from '../settings/Settings.js';
import type { Tack } from './Tack.js';
import { createTack } from './Tack.js';
import type { TackFile } from './TackFile.js';

export interface TackTemplateContextInput {
  readonly settings: Settings;
  readonly profile: Profile;
  readonly agentId: string;
  readonly projectDirectory: string;
}

export interface TackTemplateRenderInput extends TackTemplateContextInput {
  readonly tack: Tack;
  readonly settingsPaths: readonly string[];
}

const bridlTemplateEngine = new Liquid({
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

export const createTackTemplateContext = (input: TackTemplateContextInput): Readonly<Record<string, unknown>> => ({
  bridl: {
    custom_settings: input.settings.customSettings ?? {},
    settings: createTemplateSettings(input.settings),
    profile: input.profile,
    agent: input.agentId,
    project: {
      root: input.projectDirectory,
    },
  },
});

export const renderTackTemplates = (input: TackTemplateRenderInput): Tack => {
  const context = createTackTemplateContext(input);

  return createTack(
    input.tack.rootDirectory,
    input.tack.files.map((file) => renderTackFile(file, context, input.settingsPaths)),
    input.tack.statePaths,
  );
};

const renderTackFile = (
  file: TackFile,
  context: Readonly<Record<string, unknown>>,
  settingsPaths: readonly string[],
): TackFile => {
  if (!containsBridlTemplate(file.content)) {
    return file;
  }

  try {
    return {
      ...file,
      content: renderTemplateContent(file.content, context),
      sourceInputs: [...file.sourceInputs, ...settingsPaths.filter((path) => !file.sourceInputs.includes(path))],
    };
  } catch (error) {
    throw new Error(`Cannot render Bridl template in tack file '${file.relativePath}': ${formatTemplateError(error)}`, {
      cause: error,
    });
  }
};

const renderTemplateContent = (content: string, context: Readonly<Record<string, unknown>>): string => {
  const renderedContent: unknown = bridlTemplateEngine.parseAndRenderSync(content, context);

  /* v8 ignore next -- LiquidJS renders string content to strings; this guards future API regressions. */
  if (typeof renderedContent !== 'string') {
    throw new Error('LiquidJS returned non-string template output.');
  }

  return renderedContent;
};

const containsBridlTemplate = (content: string): boolean => content.includes('[[=') || content.includes('[[%');

const createTemplateSettings = (settings: Settings): Readonly<Record<string, unknown>> => ({
  default_profile: settings.defaultProfile,
  profile_sources: settings.profileSources,
  remote_settings: settings.remoteSettings,
  cache_directory: settings.cacheDirectory,
  custom_settings: settings.customSettings ?? {},
});

const formatTemplateError = (error: unknown): string => String(error);
