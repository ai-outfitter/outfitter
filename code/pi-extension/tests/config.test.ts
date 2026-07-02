// Unit tests for the extension runtime config contract.
import { describe, expect, it } from 'vitest';

import { parseOutfitterExtensionConfig } from '../src/config.js';

const validConfig = {
  autoOpenOutfitter: true,
  defaultProfilesPath: '/cache/default-profiles',
  homeDirectory: '/home/user',
  projectDirectory: '/home/user/project',
  setupSourceUri: 'https://example.test/catalog.git',
  startupAsciiArt: false,
  defaultSettingsTemplate: 'default_profile: __OUTFITTER_PROFILE_ID__\n',
  asciiArt: 'ART',
};

describe('parseOutfitterExtensionConfig', () => {
  it('parses a complete config and allows optional fields to be omitted', () => {
    expect(parseOutfitterExtensionConfig(JSON.stringify(validConfig))).toEqual(validConfig);

    const withoutOptionals: Partial<typeof validConfig> = { ...validConfig };
    delete withoutOptionals.defaultProfilesPath;
    delete withoutOptionals.setupSourceUri;
    expect(parseOutfitterExtensionConfig(JSON.stringify(withoutOptionals))).toEqual(withoutOptionals);
  });

  it('rejects non-object payloads', () => {
    expect(() => parseOutfitterExtensionConfig('null')).toThrow('must be a JSON object');
    expect(() => parseOutfitterExtensionConfig('[]')).toThrow('must be a JSON object');
    expect(() => parseOutfitterExtensionConfig('"config"')).toThrow('must be a JSON object');
  });

  it('rejects missing or mistyped fields', () => {
    expect(() => parseOutfitterExtensionConfig(JSON.stringify({ ...validConfig, homeDirectory: 7 }))).toThrow(
      "field 'homeDirectory' must be a string",
    );
    expect(() => parseOutfitterExtensionConfig(JSON.stringify({ ...validConfig, autoOpenOutfitter: 'yes' }))).toThrow(
      "field 'autoOpenOutfitter' must be a boolean",
    );
    expect(() => parseOutfitterExtensionConfig(JSON.stringify({ ...validConfig, setupSourceUri: 5 }))).toThrow(
      "field 'setupSourceUri' must be a string when present",
    );
  });
});
