// Defines the internal profile fragment shape used during profile resolution.
export interface ProfileControls {
  readonly model?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface Profile {
  readonly id: string;
  readonly label?: string;
  readonly inherits: readonly string[];
  readonly controls: ProfileControls;
}

export const createEmptyProfile = (id: string): Profile => ({
  id,
  inherits: [],
  controls: {},
});
