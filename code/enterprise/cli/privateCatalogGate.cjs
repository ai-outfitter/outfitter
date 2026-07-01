const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const {
  formatPrivateCatalogCliPrompt,
  formatPrivateCatalogSkippedMessage,
  formatPrivateCatalogSkipResultMessage,
  privateCatalogEnabledMessage,
} = require('../shared/privateCatalogPolicy.cjs');
const { enablePrivateProfileCatalogs, isPrivateProfileCatalogsEnabled } = require('./privateCatalogSettings.cjs');

const createPrivateCatalogGate = ({ homeDirectory, classifier, prompt }) => {
  const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');

  return {
    classifier,
    enabled: isPrivateProfileCatalogsEnabled(settingsPath),
    homeDirectory,
    prompt: prompt ?? createTtyPrivateCatalogPrompt(),
    promptedRepositories: new Set(),
    settingsPath,
    skippedRepositories: new Set(),
  };
};

const gatePrivateCatalogSources = (sources, gate, helpers) => {
  const allowedSources = [];
  const skippedResults = [];
  const messages = [];

  for (const source of sources) {
    const repository = source.github;
    if (repository === undefined || gate.enabled || gate.classifier.classify(repository) !== 'private') {
      allowedSources.push(source);
      continue;
    }

    if (!gate.promptedRepositories.has(repository) && gate.prompt.interactive && gate.prompt.confirm(repository)) {
      enablePrivateProfileCatalogs(gate.settingsPath);
      gate.enabled = true;
      messages.push(privateCatalogEnabledMessage);
      allowedSources.push(source);
      continue;
    }

    gate.promptedRepositories.add(repository);
    if (!gate.skippedRepositories.has(repository)) {
      messages.push(formatPrivateCatalogSkippedMessage(repository, gate.prompt.interactive));
      gate.skippedRepositories.add(repository);
    }
    skippedResults.push({
      uri: helpers.formatDisplayUri(source),
      cachePath: helpers.createRemoteRepositoryCachePath(dirname(dirname(gate.settingsPath)), source),
      status: 'skipped',
      message: formatPrivateCatalogSkipResultMessage(repository),
    });
  }

  return { allowedSources, skippedResults, messages };
};

const createTtyPrivateCatalogPrompt = () => ({
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  confirm(repository) {
    const prompt = formatPrivateCatalogCliPrompt(repository);
    const result = spawnSync(
      'sh',
      [
        '-c',
        'printf "%s" "$OUTFITTER_PRIVATE_CATALOG_PROMPT" > /dev/tty && IFS= read -r answer < /dev/tty && case "$answer" in y|Y|yes|YES) exit 0 ;; *) exit 1 ;; esac',
      ],
      { env: { ...process.env, OUTFITTER_PRIVATE_CATALOG_PROMPT: prompt }, stdio: 'inherit' },
    );
    return result.status === 0;
  },
});

const createGitHubRepositoryVisibilityClassifier = () => ({
  classify(repository) {
    if (process.env.VITEST !== undefined) {
      return 'unknown';
    }

    const [owner, repo] = repository.split('/');

    if (!owner || !repo) {
      return 'unknown';
    }

    const script = `
      import https from 'node:https';
      const [owner, repo] = process.argv.slice(1);
      const request = https.get({
        hostname: 'api.github.com',
        path: '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ai-outfitter-cli' },
        timeout: 2000,
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            console.log('unknown');
            return;
          }
          try {
            const document = JSON.parse(body);
            console.log(document.private === true ? 'private' : document.private === false ? 'public' : 'unknown');
          } catch {
            console.log('unknown');
          }
        });
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => console.log('unknown'));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script, owner, repo], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 3000,
    });
    const visibility = result.stdout.trim();

    return visibility === 'private' || visibility === 'public' ? visibility : 'unknown';
  },
});

module.exports = {
  createGitHubRepositoryVisibilityClassifier,
  createPrivateCatalogGate,
  createTtyPrivateCatalogPrompt,
  gatePrivateCatalogSources,
};
