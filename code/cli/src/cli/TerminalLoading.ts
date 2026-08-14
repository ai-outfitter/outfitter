// One delayed terminal status for startup work. Fast cached runs write nothing; long work replaces
// profile-extension subprocess chatter with a stable loading indicator.
export type LoadingStarter = (label: string) => () => void;

/* v8 ignore start -- real terminal animation; command tests inject a loading boundary. */
export const startTerminalLoading: LoadingStarter = (label) => {
  if (process.stderr.isTTY !== true) return () => undefined;

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let rendered = false;
  let interval: NodeJS.Timeout | undefined;
  const render = (): void => {
    rendered = true;
    process.stderr.write(`\r${frames[frame++ % frames.length]} ${label}`);
  };
  const delay = setTimeout(() => {
    render();
    interval = setInterval(render, 80);
    interval.unref();
  }, 120);
  delay.unref();

  return () => {
    clearTimeout(delay);
    if (interval !== undefined) clearInterval(interval);
    if (rendered) process.stderr.write('\r\u001b[2K');
  };
};
/* v8 ignore stop */
