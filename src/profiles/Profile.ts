// Defines profile shapes and control fragments used during profile resolution.
import type { StatePersistenceStrategy } from '../tack/StatePersistence.js';

export type StatePersistenceOverrides = Readonly<Record<string, StatePersistenceStrategy>>;

interface BaseProfileControls {
  readonly [controlName: string]: unknown;
  readonly model?: string;
  readonly provider?: string;
  readonly thinking?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly args?: readonly string[];
  readonly sessionDirectory?: string;
  readonly extensions?: readonly string[];
  readonly skills?: readonly string[];
  readonly promptTemplate?: string;
  readonly systemPrompt?: string;
  readonly appendSystemPrompt?: string;
}

export type PiProfileControls = BaseProfileControls;

export interface ProfileControls extends BaseProfileControls {
  readonly pi?: PiProfileControls;
}

export interface Profile {
  readonly id: string;
  readonly label?: string;
  readonly inherits: readonly string[];
  readonly controls: ProfileControls;
  readonly statePersistence?: StatePersistenceOverrides;
}

export const createEmptyProfile = (id: string): Profile => ({
  id,
  inherits: [],
  controls: {},
  statePersistence: {},
});
