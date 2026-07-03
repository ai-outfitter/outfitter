import { spawn } from 'node:child_process';

export interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ExecRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly shell?: boolean;
  readonly env?: Readonly<Record<string, string>>;
}

export const exec = (request: ExecRequest): Promise<ExecResult> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(request.command, [...(request.args ?? [])], {
      cwd: request.cwd,
      shell: request.shell ?? false,
      env: { ...process.env, ...request.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr, timedOut });
    });
  });
