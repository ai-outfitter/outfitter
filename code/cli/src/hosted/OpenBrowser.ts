import { execFile } from 'node:child_process';

/** Start the OS URL handler without a shell; an unavailable desktop is recoverable. */
export const openBrowser = (
  url: string,
  platform: NodeJS.Platform = process.platform,
  launch: typeof execFile = execFile,
): Promise<boolean> => {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    launch(command, args, { timeout: 5000, windowsHide: true }, (error) => resolve(!error));
  });
};
