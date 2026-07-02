// Shared structural types for the Outfitter Pi extension modules.
import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Context shape used by Outfitter's interactive flows (commands and events share it). */
export type OutfitterContext = ExtensionContext | ExtensionCommandContext;

/** Option rendered by the described selector: a value, a label, and an optional description. */
export interface DescribedOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export type SelectDescribedOption = (
  ctx: OutfitterContext,
  titleLines: readonly string[],
  items: readonly DescribedOption[],
  initialValue: string | undefined,
) => Promise<string | undefined>;

/** Profile summary discovered from a local profile catalog. */
export interface ProfileChoice {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly template?: boolean;
}

/** Filesystem + path helpers loaded lazily inside onboarding flows. */
export interface OnboardingFs {
  readonly existsSync: (path: string) => boolean;
  readonly mkdirSync: (path: string, options: { readonly recursive: true }) => unknown;
  readonly readFileSync: (path: string, encoding: 'utf8') => string;
  readonly readdirSync: (path: string) => readonly string[];
  readonly statSync: (path: string) => { isDirectory(): boolean; isFile(): boolean };
  readonly writeFileSync: (path: string, content: string) => void;
  readonly dirname: (path: string) => string;
  readonly join: (...segments: readonly string[]) => string;
}

/** Settings/profile install locations derived from the extension config. */
export interface OutfitterPaths {
  readonly homeSettingsPath: string;
  readonly homeProfilesPath: string;
  readonly projectSettingsPath: string;
  readonly projectProfilesPath: string;
  readonly defaultProfilesPath?: string;
}

export interface InstallTarget {
  readonly id: 'home' | 'project';
  readonly settingsPath: string;
  readonly profilesPath: string;
}

/** Prompt surface handed to onboarding flows; wraps pi UI with Outfitter question phrasing. */
export interface QuestionUi {
  selectSetupMode(): Promise<'default' | 'create' | 'catalog' | undefined>;
  selectInstallTarget(paths: OutfitterPaths): Promise<InstallTarget | undefined>;
  selectProfile(
    profiles: readonly ProfileChoice[],
    currentDefault: string | undefined,
  ): Promise<ProfileChoice | undefined>;
  input(message: string, defaultValue: string): Promise<string | undefined>;
  confirmPrivateCatalog(repository: string): Promise<boolean>;
  notify(message: string, type?: 'info' | 'warning' | 'error'): void;
}

/** Enterprise private-catalog onboarding module loaded from the extension directory. */
export interface PrivateCatalogOnboardingModule {
  confirmPrivateCatalog(
    ctx: OutfitterContext,
    selectDescribedOption: SelectDescribedOption,
    repository: string,
  ): Promise<boolean>;
  readPrivateProfileCatalogsEnabled(fs: OnboardingFs, settingsPath: string): boolean;
  writePrivateProfileCatalogsEnabled(fs: OnboardingFs, settingsPath: string): void;
  classifyGitHubRepositoryVisibility(repository: string): Promise<'private' | 'public' | 'unknown'>;
}

// The private catalog module ships separately (copied by the CLI next to the built
// extension), so the specifier must stay a runtime value: TypeScript and esbuild
// must not try to resolve it at build time.
const privateCatalogOnboardingSpecifier = './pi-extension/privateCatalogOnboarding.js';

type OutfitterImportGlobal = typeof globalThis & {
  __outfitterImport?: (specifier: string) => Promise<unknown>;
};

// Mirrors the `__outfitterImport` hook the enterprise support files already honor:
// hosts that relocate the module graph (tests, packagers) can intercept the import.
const importRuntime = (specifier: string): Promise<unknown> => {
  const importOverride = (globalThis as OutfitterImportGlobal).__outfitterImport;
  /* v8 ignore next -- the direct import path only resolves inside a pi config directory at runtime. */
  return importOverride === undefined ? import(specifier) : importOverride(specifier);
};

export const loadPrivateCatalogOnboarding = (): Promise<PrivateCatalogOnboardingModule> =>
  importRuntime(privateCatalogOnboardingSpecifier) as Promise<PrivateCatalogOnboardingModule>;
