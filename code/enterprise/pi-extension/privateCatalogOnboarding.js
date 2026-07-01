import privateCatalogPolicy from '../shared/privateCatalogPolicy.cjs';

const { formatPrivateCatalogPiPromptTitle, privateCatalogPiPromptItems } = privateCatalogPolicy;

const importRuntime = (specifier) =>
  typeof globalThis.__outfitterImport === 'function' ? globalThis.__outfitterImport(specifier) : import(specifier);

export const confirmPrivateCatalog = async (ctx, selectDescribedOption, repository) => {
  const title = formatPrivateCatalogPiPromptTitle(repository);
  const selected =
    typeof ctx.ui.custom === 'function'
      ? await selectDescribedOption(ctx, title, privateCatalogPiPromptItems, 'enable')
      : await ctx.ui.select(
          title.join('\n'),
          privateCatalogPiPromptItems.map((item) => item.label),
        );
  return selected === 'enable' || selected === 'Enable and continue';
};

export const readPrivateProfileCatalogsEnabled = (fs, settingsPath) => {
  if (!fs.existsSync(settingsPath)) return false;
  const content = fs.readFileSync(settingsPath, 'utf8');
  return /^enterprise:\s*(?:\n\s+[A-Za-z0-9_-]+:\s*[^\n]*)*\n\s+private_profile_catalogs:\s*true\s*$/mu.test(content);
};

export const writePrivateProfileCatalogsEnabled = (fs, settingsPath) => {
  fs.mkdirSync(fs.dirname(settingsPath), { recursive: true });
  const content = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  if (/^\s*private_profile_catalogs:\s*(?:true|false)\s*$/mu.test(content)) {
    fs.writeFileSync(
      settingsPath,
      content.replace(/^\s*private_profile_catalogs:\s*(?:true|false)\s*$/gmu, '  private_profile_catalogs: true'),
    );
    return;
  }
  if (/^enterprise:\s*$/mu.test(content)) {
    fs.writeFileSync(
      settingsPath,
      content.replace(/^enterprise:\s*$/mu, 'enterprise:\n  private_profile_catalogs: true'),
    );
    return;
  }
  fs.writeFileSync(settingsPath, content.replace(/\s*$/u, '\n') + 'enterprise:\n  private_profile_catalogs: true\n');
};

export const classifyGitHubRepositoryVisibility = async (repository) => {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return 'unknown';
  try {
    const { request } = await importRuntime('node:https');
    return await new Promise((resolve) => {
      const req = request(
        {
          hostname: 'api.github.com',
          path: '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-outfitter-pi' },
          timeout: 2000,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            if (response.statusCode !== 200) {
              resolve('unknown');
              return;
            }
            try {
              const document = JSON.parse(body);
              resolve(document.private === true ? 'private' : document.private === false ? 'public' : 'unknown');
            } catch {
              resolve('unknown');
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve('unknown');
      });
      req.on('error', () => resolve('unknown'));
      req.end();
    });
  } catch {
    return 'unknown';
  }
};
