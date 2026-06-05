// Provides a Vitest console guard so accidental test output fails instead of cluttering CI logs.
export type TestConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';

export interface TestConsoleMessage {
  readonly method: TestConsoleMethod;
  readonly text: string;
  readonly args: readonly unknown[];
}

export type TestConsolePredicate = (message: TestConsoleMessage) => boolean;

const guardedMethods: readonly TestConsoleMethod[] = ['debug', 'error', 'info', 'log', 'warn'];
const originalConsoleMethods = new Map<TestConsoleMethod, (...args: unknown[]) => void>();
let allowedPredicates: TestConsolePredicate[] = [];
let installed = false;

export const installTestConsoleGuard = (): void => {
  if (installed) {
    return;
  }

  for (const method of guardedMethods) {
    originalConsoleMethods.set(method, console[method].bind(console));
    console[method] = ((...args: unknown[]) => {
      const message = { method, text: formatConsoleArguments(args), args };

      if (allowedPredicates.some((predicate) => predicate(message))) {
        return;
      }

      throw new Error(`Unexpected console.${method} output during test: ${message.text}`);
    }) as Console[typeof method];
  }

  installed = true;
};

export const allowTestConsoleOutput = (predicate: TestConsolePredicate): void => {
  allowedPredicates.push(predicate);
};

export const resetAllowedTestConsoleOutput = (): void => {
  allowedPredicates = [];
};

export const uninstallTestConsoleGuard = (): void => {
  if (!installed) {
    return;
  }

  for (const [method, originalMethod] of originalConsoleMethods) {
    console[method] = originalMethod as Console[typeof method];
  }

  originalConsoleMethods.clear();
  resetAllowedTestConsoleOutput();
  installed = false;
};

const formatConsoleArguments = (args: readonly unknown[]): string =>
  args.map((argument) => formatConsoleArgument(argument)).join(' ');

const formatConsoleArgument = (argument: unknown): string => {
  if (typeof argument === 'string') {
    return argument;
  }

  if (argument instanceof Error) {
    return argument.stack ?? argument.message;
  }

  return stringifyBestEffort(argument);
};

const stringifyBestEffort = (argument: unknown): string => {
  try {
    return JSON.stringify(argument) ?? stringifyWithStringConstructor(argument);
  } catch {
    return stringifyWithStringConstructor(argument);
  }
};

const stringifyWithStringConstructor = (argument: unknown): string => {
  try {
    return String(argument);
  } catch {
    return '<unformattable console argument>';
  }
};
