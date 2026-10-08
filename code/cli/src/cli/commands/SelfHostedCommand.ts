// Registers the bounded, non-installing self-hosted host-planning command group.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import {
  applySelfHostedConfig,
  createEndpointHandoff,
  createSetupPlan,
  detectHost,
  doctorHost,
  loadSelfHostedConfig,
} from '../../self-hosted/SelfHostedSetup.js';
import type {
  OptionalService,
  ReadOnlyProbe,
  SelfHostedConfig,
  SupportedTarget,
} from '../../self-hosted/SelfHostedSetup.js';
import { markCommandReadOnly } from './CommandObject.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';

export interface SelfHostedCommandDependencies {
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly probe?: ReadOnlyProbe;
  readonly writeLine?: (message: string) => void;
}

/* v8 ignore next 4 -- the real subprocess boundary is exercised by manual CLI smoke tests. */
const defaultProbe: ReadOnlyProbe = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', shell: false, timeout: 10_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
};

const targetOption = (): Option =>
  new Option('--target <target>', 'Host route.').choices(['dgx-spark', 'apple-silicon']).makeOptionMandatory();
const modeOption = (): Option =>
  new Option('--mode <mode>', 'Setup scope.')
    .choices(['inference-only', 'inference-and-services'])
    .default('inference-only');

const asServices = (values: readonly string[] | undefined): readonly OptionalService[] =>
  (values ?? []) as readonly OptionalService[];

export const createSelfHostedCommand = (dependencies: SelfHostedCommandDependencies = {}): CommandObject => ({
  name: 'self-hosted',
  description: 'Detect and plan a self-hosted inference endpoint without installing services.',
  register(program: Command): void {
    const root = new Command('self-hosted').description(
      'Detect and plan a self-hosted inference endpoint without installing services.',
    );
    /* v8 ignore next -- unit tests inject output; this is the direct CLI sink. */
    const write = dependencies.writeLine ?? console.log;
    /* v8 ignore next -- unit tests inject probes; direct CLI uses the subprocess boundary. */
    const probe = dependencies.probe ?? defaultProbe;
    const detection = () =>
      detectHost({
        /* v8 ignore next -- unit tests inject the host; direct CLI uses the process host. */
        platform: dependencies.platform ?? process.platform,
        /* v8 ignore next -- unit tests inject the host; direct CLI uses the process host. */
        architecture: dependencies.architecture ?? process.arch,
        probe,
      });

    root.addCommand(
      markCommandReadOnly(
        new Command('detect')
          .description('Read-only host detection.')
          .option('--json', 'Emit JSON.')
          .action(() => {
            write(JSON.stringify(detection(), null, 2));
          }),
      ),
    );
    root.addCommand(
      markCommandReadOnly(
        new Command('doctor')
          .description('Run read-only prerequisite checks.')
          .option('--json', 'Emit JSON.')
          .action(() => {
            write(JSON.stringify(doctorHost(detection(), probe), null, 2));
          }),
      ),
    );
    root.addCommand(
      markCommandReadOnly(
        new Command('plan')
          .description('Print a safe dry-run plan; never writes or installs.')
          .addOption(targetOption())
          .addOption(modeOption())
          .addOption(
            new Option('--service <service...>', 'Optional services to report as unavailable.').choices([
              'forgejo',
              'stalwart',
              'identity',
              'password-manager',
            ]),
          )
          .action((options: { target: SupportedTarget; mode: SelfHostedConfig['mode']; service?: string[] }) => {
            write(JSON.stringify(createSetupPlan(options.target, options.mode, asServices(options.service)), null, 2));
          }),
      ),
    );
    root.addCommand(
      new Command('apply')
        .description('Persist reviewed config; does not install services.')
        .requiredOption('--config <path>', 'Reviewed self-hosted YAML config.')
        .option('--out <directory>', 'Persistence directory.')
        .action((options: { config: string; out?: string }) => {
          const config = loadSelfHostedConfig(options.config);
          const outputDirectory =
            options.out ?? join(resolveHomeDirectory(dependencies.homeDirectory), '.outfitter', 'self-hosted');
          const result = applySelfHostedConfig({ config, outputDirectory });
          write(JSON.stringify({ applied: true, installed: false, configPath: result.configPath }, null, 2));
        }),
    );
    root.addCommand(
      markCommandReadOnly(
        new Command('handoff')
          .description('Emit a key-free inference endpoint descriptor from validated config.')
          .requiredOption('--config <path>', 'Self-hosted YAML config.')
          .action((options: { config: string }) => {
            write(JSON.stringify(createEndpointHandoff(loadSelfHostedConfig(options.config)), null, 2));
          }),
      ),
    );
    program.addCommand(root);
  },
});
