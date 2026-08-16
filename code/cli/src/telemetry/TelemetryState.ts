import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveOutfitterStateDir } from '../paths/OutfitterCache.js';

export interface TelemetryState {
  readonly installation_id: string;
  readonly notice_shown: boolean;
}

export interface TelemetryStateStore {
  readOrCreate(): TelemetryState;
  recordNoticeShown(state: TelemetryState): TelemetryState;
  delete(): void;
}

export const resolveTelemetryStatePath = (
  homeDirectory: string,
  env: Readonly<Record<string, string | undefined>>,
): string => join(resolveOutfitterStateDir(env, homeDirectory), 'telemetry.json');

const isTelemetryState = (value: unknown): value is TelemetryState => {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<TelemetryState>;
  return typeof candidate.installation_id === 'string' && typeof candidate.notice_shown === 'boolean';
};

export const createTelemetryStateStore = (path: string, createId: () => string = randomUUID): TelemetryStateStore => {
  const write = (state: TelemetryState): void => {
    const directory = dirname(path);
    const temporaryPath = join(directory, `.telemetry-${randomUUID()}.tmp`);
    mkdirSync(directory, { recursive: true });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  };

  return {
    readOrCreate(): TelemetryState {
      if (existsSync(path)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
          if (isTelemetryState(parsed)) return parsed;
        } catch {
          // A partial or corrupt state file is replaced with a fresh pseudonymous identifier.
        }
      }
      const state = { installation_id: createId(), notice_shown: false };
      write(state);
      return state;
    },
    recordNoticeShown(state: TelemetryState): TelemetryState {
      const updated = { ...state, notice_shown: true };
      write(updated);
      return updated;
    },
    delete(): void {
      rmSync(path, { force: true });
    },
  };
};
