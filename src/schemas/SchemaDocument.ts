// Defines named JSON Schema document metadata for ApplePi persisted formats.
export interface SchemaDocument {
  readonly id: string;
  readonly path: string;
}

export const settingsSchemaDocument: SchemaDocument = {
  id: 'settings',
  path: 'src/schemas/settings.schema.json',
};

export const profileSchemaDocument: SchemaDocument = {
  id: 'profile',
  path: 'src/schemas/profile.schema.json',
};

export const profileSourceSchemaDocument: SchemaDocument = {
  id: 'profile-source',
  path: 'src/schemas/profile-source.schema.json',
};
