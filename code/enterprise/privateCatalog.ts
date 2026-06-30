export type EnterpriseCatalogVisibility = 'private';

export type EnterprisePrivateCatalogCredentialPolicy = 'ambient-git-only';

export type EnterprisePrivateCatalogRuntimeSupport = 'boundary-only-no-runtime-behavior';

export interface EnterprisePrivateCatalogBoundary {
  readonly visibility: EnterpriseCatalogVisibility;
  readonly credentialPolicy: EnterprisePrivateCatalogCredentialPolicy;
  readonly runtimeSupport: EnterprisePrivateCatalogRuntimeSupport;
  readonly strictPrivateRepositoryBlocking: false;
}

export const enterprisePrivateCatalogBoundary: EnterprisePrivateCatalogBoundary = {
  visibility: 'private',
  credentialPolicy: 'ambient-git-only',
  runtimeSupport: 'boundary-only-no-runtime-behavior',
  strictPrivateRepositoryBlocking: false,
};
