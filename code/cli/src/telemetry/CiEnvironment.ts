import { id, isCI } from 'ci-info';

export interface DetectedCi {
  readonly isCI: boolean;
  readonly vendorId: string | null;
}

export const normalizeCiVendorId = (vendorId: string | null): string | null =>
  vendorId === null ? null : vendorId.toLowerCase();

export const detectCi = (): DetectedCi => ({ isCI, vendorId: normalizeCiVendorId(id) });
