const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');

const { parse, stringify } = require('yaml');

const isPrivateProfileCatalogsEnabled = (settingsPath) => {
  if (!existsSync(settingsPath)) {
    return false;
  }

  try {
    const parsed = parse(readFileSync(settingsPath, 'utf8'));
    return readPrivateProfileCatalogsSetting(parsed) === true;
  } catch {
    return false;
  }
};

const enablePrivateProfileCatalogs = (settingsPath) => {
  const document = readSettingsRecord(settingsPath);
  const enterprise = readMutableRecord(document.enterprise);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    stringify({
      ...document,
      enterprise: {
        ...enterprise,
        private_profile_catalogs: true,
      },
    }),
  );
};

const readPrivateProfileCatalogsSetting = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value.enterprise?.private_profile_catalogs;
};

const readSettingsRecord = (settingsPath) => {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const parsed = parse(readFileSync(settingsPath, 'utf8'));
  return readMutableRecord(parsed);
};

const readMutableRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};

module.exports = {
  enablePrivateProfileCatalogs,
  isPrivateProfileCatalogsEnabled,
};
