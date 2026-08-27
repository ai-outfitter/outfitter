// Retains the declaring layer for extension paths while preserving loadout's parent-first de-duplication.
import type { ComposedExtensionSelection } from './Composition.js';

export interface ExtensionDeclaration {
  readonly specifiers: readonly string[];
  readonly declaringRoot: string;
}

export const composeExtensionSelections = (
  declarations: readonly ExtensionDeclaration[],
): readonly ComposedExtensionSelection[] => {
  const selections: ComposedExtensionSelection[] = [];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    for (const specifier of declaration.specifiers) {
      if (seen.has(specifier)) continue;
      seen.add(specifier);
      selections.push({ specifier, declaringRoot: declaration.declaringRoot });
    }
  }
  return selections;
};
