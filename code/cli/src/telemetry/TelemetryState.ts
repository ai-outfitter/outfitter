import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  };

  return {
    readOrCreate(): TelemetryState {
      if (existsSync(path)) {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (isTelemetryState(parsed)) return parsed;
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
