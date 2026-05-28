// Defines settings discovery inputs before YAML parsing is implemented.
export interface SettingsLocation {
  readonly scope: 'user' | 'project' | 'project-local';
  readonly path: string;
}

export interface SettingsLoadPlan {
  readonly locations: readonly SettingsLocation[];
}

export const createSettingsLoadPlan = (locations: readonly SettingsLocation[]): SettingsLoadPlan => ({
  locations,
});
