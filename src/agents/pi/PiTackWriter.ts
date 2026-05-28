// Defines pi-specific tack path metadata before full tack writing is implemented.
export interface PiTackPaths {
  readonly agentDirectory: string;
}

export const createPiTackPaths = (agentDirectory: string): PiTackPaths => ({
  agentDirectory,
});
