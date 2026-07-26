// Loads the enterprise-licensed private-catalog policy boundary for CLI source synchronization.
import { createRequire } from 'node:module';

import { resolveRepositoryCodeAsset } from '../paths/RepositoryAssets.js';
import type { RemoteSourceReference } from './SourceCache.js';
import { createRemoteRepositoryCachePath, formatRemoteSourceDisplay } from './SourceCache.js';

export interface GitHubRepositoryVisibilityClassifier {
  classify(repository: string): 'private' | 'public' | 'unknown';
}

export interface PrivateCatalogPrompt {
  readonly interactive: boolean;
  confirm(repository: string): boolean;
}

export interface PrivateCatalogSkippedResult {
  readonly uri: string;
  readonly cachePath: string;
  readonly status: 'skipped';
  readonly message: string;
}

export interface PrivateCatalogGateResult<T extends RemoteSourceReference> {
  readonly allowedSources: readonly T[];
  readonly skippedResults: readonly PrivateCatalogSkippedResult[];
  readonly messages: readonly string[];
}

export interface PrivateCatalogSourceGate {
  filter<T extends RemoteSourceReference>(sources: readonly T[], cacheDirectory?: string): PrivateCatalogGateResult<T>;
}

interface EnterpriseGateModule {
  createGitHubRepositoryVisibilityClassifier(): GitHubRepositoryVisibilityClassifier;
  createPrivateCatalogGate(input: {
    readonly homeDirectory: string;
    readonly classifier: GitHubRepositoryVisibilityClassifier;
    readonly prompt?: PrivateCatalogPrompt;
  }): unknown;
  gatePrivateCatalogSources<T extends RemoteSourceReference>(
    sources: readonly T[],
    gate: unknown,
    helpers: {
      readonly formatDisplayUri: (source: RemoteSourceReference) => string;
      readonly resolveCachePath: (source: RemoteSourceReference) => string;
    },
  ): PrivateCatalogGateResult<T>;
}

const loadEnterpriseGateModule = (): EnterpriseGateModule =>
  createRequire(import.meta.url)(
    resolveRepositoryCodeAsset('enterprise/cli/privateCatalogGate.cjs'),
  ) as EnterpriseGateModule;

export const createEnterprisePrivateCatalogGate = (input: {
  readonly homeDirectory: string;
  readonly classifier?: GitHubRepositoryVisibilityClassifier;
  readonly prompt?: PrivateCatalogPrompt;
}): PrivateCatalogSourceGate => {
  const enterprise = loadEnterpriseGateModule();
  const { homeDirectory } = input;
  const gate = enterprise.createPrivateCatalogGate({
    homeDirectory,
    classifier: input.classifier ?? enterprise.createGitHubRepositoryVisibilityClassifier(),
    prompt: input.prompt,
  });

  return {
    filter<T extends RemoteSourceReference>(
      sources: readonly T[],
      cacheDirectory?: string,
    ): PrivateCatalogGateResult<T> {
      return enterprise.gatePrivateCatalogSources(sources, gate, {
        formatDisplayUri: formatRemoteSourceDisplay,
        resolveCachePath: (source) => createRemoteRepositoryCachePath(homeDirectory, source, cacheDirectory),
      });
    },
  };
};
