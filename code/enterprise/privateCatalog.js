import privateCatalogPolicy from './shared/privateCatalogPolicy.cjs';

export const ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID = privateCatalogPolicy.ENTERPRISE_PRIVATE_CATALOG_FEATURE_ID;

/**
 * Enterprise/private catalog capability policy.
 *
 * This module is intentionally licensed from code/enterprise/**. Public Outfitter
 * can continue to clone public and private repositories through the user's
 * ambient git configuration; this object defines the commercial boundary for
 * private-catalog support without adding runtime credential enforcement.
 */
export const enterprisePrivateCatalogBoundary = privateCatalogPolicy.enterprisePrivateCatalogBoundary;

/**
 * Returns true when a profile catalog capability belongs to the enterprise
 * licensing boundary. This is a policy marker, not a runtime access check: git
 * may still succeed or fail according to the user's local credentials. A
 * confirmed private GitHub catalog should receive informational license
 * guidance, never warning/error output or blocking behavior.
 *
 * @param {{ readonly visibility?: 'public' | 'private' | 'unknown' }} catalog
 */
export const requiresEnterprisePrivateCatalogLicense = privateCatalogPolicy.requiresEnterprisePrivateCatalogLicense;
