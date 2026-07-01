const ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID = 'enterprise-private-profile-catalog';

const enterprisePrivateCatalogBoundary = Object.freeze({
  featureId: ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID,
  visibility: 'private',
  credentialPolicy: 'ambient-git-only',
  runtimeSupport: 'license-boundary-info-notice-no-credential-enforcement',
  strictPrivateRepositoryBlocking: false,
  privateCatalogInfoSeverity: 'info',
});

const requiresEnterprisePrivateCatalogLicense = (catalog) => catalog.visibility !== 'public';

const formatPrivateCatalogCliPrompt = (repository) =>
  [
    `Private GitHub profile catalog detected: ${repository}.`,
    '',
    'Private profile catalog support is covered by the Outfitter Enterprise license.',
    'Review code/enterprise/LICENSE or your enterprise agreement before enabling.',
    '',
    'Enable private profile catalogs in ~/.outfitter/settings.yml? [y/N] ',
  ].join('\n');

const formatPrivateCatalogSkippedMessage = (repository, interactive) =>
  interactive
    ? `info: Private profile catalog setup was skipped for ${repository}; no settings were changed.`
    : `info: Private GitHub profile catalog detected: ${repository}. Enable enterprise.private_profile_catalogs in ~/.outfitter/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.`;

const privateCatalogEnabledMessage = 'info: Enabled private profile catalogs in ~/.outfitter/settings.yml.';

const formatPrivateCatalogSkipResultMessage = (repository) =>
  `Private profile catalog setup was skipped for ${repository}; no settings were changed.`;

const privateCatalogPiPromptItems = Object.freeze([
  Object.freeze({
    value: 'enable',
    label: 'Enable and continue',
    description: 'Write enterprise.private_profile_catalogs: true to ~/.outfitter/settings.yml and save this catalog.',
  }),
  Object.freeze({
    value: 'cancel',
    label: 'Cancel private catalog setup',
    description: 'Leave settings unchanged and do not save this private catalog.',
  }),
]);

const formatPrivateCatalogPiPromptTitle = (repository) => [
  `Private GitHub profile catalog detected: ${repository}.`,
  '',
  'Private profile catalog support is covered by the Outfitter Enterprise license.',
  'Review code/enterprise/LICENSE or your enterprise agreement before enabling.',
  '',
  'Enable private profile catalogs in ~/.outfitter/settings.yml and use this catalog?',
];

module.exports = {
  ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID,
  enterprisePrivateCatalogBoundary,
  formatPrivateCatalogCliPrompt,
  formatPrivateCatalogPiPromptTitle,
  formatPrivateCatalogSkippedMessage,
  formatPrivateCatalogSkipResultMessage,
  privateCatalogEnabledMessage,
  privateCatalogPiPromptItems,
  requiresEnterprisePrivateCatalogLicense,
};
