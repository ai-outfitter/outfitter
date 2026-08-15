import { createRequire } from 'node:module';

import { id as ciInfoId, isCI as ciInfoIsCI } from 'ci-info';

import type { TelemetryEnvironment } from './TelemetryConsent.js';

interface CiVendor {
  readonly constant: string;
  readonly env: string | readonly string[] | CiEnvironmentCheck;
}

type CiEnvironmentCheck =
  | { readonly env: string; readonly includes: string }
  | { readonly any: readonly string[] }
  | Readonly<Record<string, string>>;

export interface DetectedCi {
  readonly isCI: boolean;
  readonly vendorId: string | null;
}

const require = createRequire(import.meta.url);
const vendors = require('ci-info/vendors.json') as readonly CiVendor[];
const GENERIC_CI_VARIABLES = [
  'BUILD_ID',
  'BUILD_NUMBER',
  'CI',
  'CI_APP_ID',
  'CI_BUILD_ID',
  'CI_BUILD_NUMBER',
  'CI_NAME',
  'CONTINUOUS_INTEGRATION',
  'RUN_ID',
] as const;

const checkEnvironment = (check: string | CiEnvironmentCheck, env: TelemetryEnvironment): boolean => {
  if (typeof check === 'string') return Boolean(env[check]);
  if ('env' in check) return Boolean(env[check.env]?.includes(check.includes));
  const anyNames = (check as { readonly any?: readonly string[] }).any;
  if (anyNames !== undefined) return anyNames.some((name) => Boolean(env[name]));
  return Object.entries(check).every(([name, value]) => env[name] === value);
};

const normalizeVendorId = (vendorId: string | null): string | null => vendorId?.toLowerCase() ?? null;

export const detectCi = (env: TelemetryEnvironment): DetectedCi => {
  // ci-info intentionally evaluates process.env once. Use its exports for the production environment,
  // while the equivalent table-driven path keeps tests deterministic with injected environments.
  if (env === process.env) return { isCI: ciInfoIsCI, vendorId: normalizeVendorId(ciInfoId) };
  if (env.CI === 'false') return { isCI: false, vendorId: null };

  let vendorId: string | null = null;
  for (const vendor of vendors) {
    const checks = Array.isArray(vendor.env) ? (vendor.env as readonly (string | CiEnvironmentCheck)[]) : [vendor.env];
    if (checks.every((check) => checkEnvironment(check, env))) vendorId = vendor.constant.toLowerCase();
  }

  return {
    isCI: vendorId !== null || GENERIC_CI_VARIABLES.some((name) => Boolean(env[name])),
    vendorId,
  };
};
