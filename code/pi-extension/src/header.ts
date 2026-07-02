// Renders the Outfitter startup header shown above pi's chat area.
import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';

import type { OutfitterExtensionConfig } from './config.js';

const OUTFITTER_ASCII_GRADIENT: readonly ThemeColor[] = ['success', 'accent', 'text', 'muted', 'dim'];

export const createStartupHeaderLines = (
  config: OutfitterExtensionConfig,
  theme: Theme,
  firstRun: boolean,
): string[] => {
  const brandLine = theme.bold(theme.fg('accent', 'Outfitter')) + theme.fg('dim', ' + pi');
  const commandHelp = theme.fg('muted', '/ commands · ! bash · shift+tab mode · ctrl+shift+t thinking · ctrl+o more');
  const lines: string[] = [];

  if (config.startupAsciiArt) {
    lines.push(
      ...config.asciiArt.split('\n').map((line, index) => theme.fg(OUTFITTER_ASCII_GRADIENT[index] ?? 'accent', line)),
      '',
    );
  }

  lines.push(brandLine, commandHelp);

  if (firstRun) {
    lines.push(
      '',
      theme.fg('dim', 'Outfitter turns Pi into a configured working environment:'),
      theme.fg('dim', '• profiles define model, tools, prompts, skills, and extensions'),
      theme.fg('dim', '• settings can live in your home folder or this project'),
      theme.fg('dim', '• catalogs let teams share setups through GitHub'),
    );
    return lines;
  }

  lines.push(
    '',
    theme.fg(
      'dim',
      'Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.',
    ),
  );
  return lines;
};
