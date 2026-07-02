// Entry point for the bundled Outfitter Pi extension artifact.
//
// pi imports the bundled file (written by the Outfitter CLI into the pi config
// directory) as a regular ES module; runtime values arrive through the JSON
// config file referenced by OUTFITTER_PI_EXTENSION_CONFIG rather than through
// source interpolation.
import { readFileSync } from 'node:fs';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { parseOutfitterExtensionConfig } from './config.js';
import { createOutfitterExtension } from './extension.js';

export default function outfitter(pi: ExtensionAPI): void {
  const configPath = process.env.OUTFITTER_PI_EXTENSION_CONFIG;

  if (configPath === undefined || configPath === '') {
    throw new Error(
      'Outfitter Pi extension config path is missing. Launch pi through `outfitter` so OUTFITTER_PI_EXTENSION_CONFIG is set.',
    );
  }

  createOutfitterExtension(parseOutfitterExtensionConfig(readFileSync(configPath, 'utf8')))(pi);
}
