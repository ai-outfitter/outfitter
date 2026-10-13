import { spawn } from 'node:child_process';

/** Start the OS URL handler without a shell or waiting for the browser to close. */
export const openBrowser = (
  url: string,
  platform: NodeJS.Platform = process.platform,
  launch: typeof spawn = spawn,
): Promise<boolean> => {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    const child = launch(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    // Some URL handlers remain alive for the entire browser session. Observe
    // immediate launch failures, then leave that session running independently.
    const timer = setTimeout(() => resolve(true), 1000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.unref();
  });
};
