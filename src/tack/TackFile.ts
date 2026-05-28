// Defines a logical file generated into a temporary Bridl tack directory.
export interface TackFile {
  readonly relativePath: string;
  readonly content: string;
}

export const createTackFile = (relativePath: string, content: string): TackFile => ({
  relativePath,
  content,
});
