// Provides shared branded intro text for interactive setup flows.

const welcomeIntroLines = [
  String.raw`  ____        _    __ _ _   _            `,
  String.raw` / __ \      | |  / _(_) | | |           `,
  String.raw`| |  | |_   _| |_| |_ _| |_| |_ ___ _ __ `,
  String.raw`| |  | | | | | __|  _| | __| __/ _ \ '__|`,
  String.raw`| |__| | |_| | |_| | | | |_| ||  __/ |   `,
  String.raw` \____/ \__,_|\__|_| |_|\__|\__\___|_|   `,
  '',
  'Welcome to Outfitter.',
  'Pi is a fully extensible agentic coding harness.',
  'Outfitter configures Pi with profiles and extensions - turning it into a complete agentic development environment.',
] as const;

export const writeWelcomeIntro = (output: Pick<NodeJS.WritableStream, 'write'>): void => {
  output.write(`\n${welcomeIntroLines.join('\n')}\n`);
};
