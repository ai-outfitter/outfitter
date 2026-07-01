export const ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID = 'enterprise-private-profile-catalog';

/**
 * Enterprise/private catalog capability policy.
 *
 * This module is intentionally licensed from code/enterprise/**. Public Outfitter
 * can continue to clone public and private repositories through the user's
 * ambient git configuration; this object defines the commercial boundary for
 * private-catalog support without adding runtime credential enforcement.
 */
export const enterprisePrivateCatalogBoundary = Object.freeze({
  featureId: ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID,
  visibility: 'private',
  credentialPolicy: 'ambient-git-only',
  runtimeSupport: 'license-boundary-info-notice-no-credential-enforcement',
  strictPrivateRepositoryBlocking: false,
  privateCatalogInfoSeverity: 'info',
});

/**
 * Returns true when a profile catalog capability belongs to the enterprise
 * licensing boundary. This is a policy marker, not a runtime access check: git
 * may still succeed or fail according to the user's local credentials. A
 * confirmed private GitHub catalog should receive informational license
 * guidance, never warning/error output or blocking behavior.
 *
 * @param {{ readonly visibility?: 'public' | 'private' | 'unknown' }} catalog
 */
export const requiresEnterprisePrivateCatalogLicense = (catalog) => catalog.visibility !== 'public';
