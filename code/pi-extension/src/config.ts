// Runtime configuration handed from the Outfitter CLI to the Pi extension.
//
// The CLI writes this configuration as JSON next to the injected extension file
// and points `OUTFITTER_PI_EXTENSION_CONFIG` at it (see
// `code/cli/src/cli/commands/PiLoginLaunch.ts`, which owns the producing side of
// this contract). Values arrive through that JSON file instead of being
// interpolated into the extension source.

export interface OutfitterExtensionConfig {
  /** Whether this launch should auto-open native /outfitter onboarding after startup. */
  readonly autoOpenOutfitter: boolean;
  /** Local cache path of the default Outfitter profile catalog, when synced. */
  readonly defaultProfilesPath?: string;
  /** Absolute user home directory used for ~/.outfitter settings paths. */
  readonly homeDirectory: string;
  /** Absolute project directory used for project .outfitter settings paths. */
  readonly projectDirectory: string;
  /** Explicit setup-source URI provided to `outfitter setup <source>`, if any. */
  readonly setupSourceUri?: string;
  /** Whether the startup header renders the Outfitter ASCII art. */
  readonly startupAsciiArt: boolean;
  /** Settings template with the `__OUTFITTER_PROFILE_ID__` placeholder for the default catalog flow. */
  readonly defaultSettingsTemplate: string;
  /** Pre-rendered Outfitter ASCII art lines joined with newlines. */
  readonly asciiArt: string;
}

const requiredStringKeys = ['homeDirectory', 'projectDirectory', 'defaultSettingsTemplate', 'asciiArt'] as const;
const requiredBooleanKeys = ['autoOpenOutfitter', 'startupAsciiArt'] as const;
const optionalStringKeys = ['defaultProfilesPath', 'setupSourceUri'] as const;

const assertRequiredConfigFields = (record: Readonly<Record<string, unknown>>): void => {
  for (const key of requiredStringKeys) {
    if (typeof record[key] !== 'string') {
      throw new Error(`Outfitter Pi extension config field '${key}' must be a string.`);
    }
  }

  for (const key of requiredBooleanKeys) {
    if (typeof record[key] !== 'boolean') {
      throw new Error(`Outfitter Pi extension config field '${key}' must be a boolean.`);
    }
  }
};

const assertOptionalConfigFields = (record: Readonly<Record<string, unknown>>): void => {
  for (const key of optionalStringKeys) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      throw new Error(`Outfitter Pi extension config field '${key}' must be a string when present.`);
    }
  }
};

export const parseOutfitterExtensionConfig = (content: string): OutfitterExtensionConfig => {
  const parsed: unknown = JSON.parse(content);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Outfitter Pi extension config must be a JSON object.');
  }

  const record = parsed as Readonly<Record<string, unknown>>;
  assertRequiredConfigFields(record);
  assertOptionalConfigFields(record);

  return record as unknown as OutfitterExtensionConfig;
};
