import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadAndParseConfig } from '@cloudflare/config';
import { getWorkerAssetsDir, getWorkerBundleDir, readBuildOutput, writeAssets, writeContainerConfig, writeRootConfig, writeWorkerConfig } from '@cloudflare/build-output-utils';

const project = dirname(fileURLToPath(import.meta.url)), workspace = resolve(project, '../..');
const context = { isPreview: false, mode: 'production' };
const loaded = await loadAndParseConfig(join(project, 'cloudflare.config.ts'), context);
if (!loaded.result.success) throw new Error(loaded.result.error.message);
const config = loaded.result.data;
if (!config.worker) throw new Error('The deployment needs a Worker.');
const frontend = join(workspace, 'dist'); await stat(join(frontend, 'index.html'));
const output = resolve(project, '.cloudflare/output/v0');
if (!output.startsWith(project + sep) || relative(project, output) !== join('.cloudflare', 'output', 'v0')) throw new Error('Unexpected deployment output path.');
await rm(output, { recursive: true, force: true });
const backend = await build({ entryPoints: [join(project, 'container-entry.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', minify: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, external: ['bufferutil', 'utf-8-validate'] });
const backendBytes = backend.outputFiles[0].contents;
const version = createHash('sha256').update(backendBytes).digest('hex');
const bundle = getWorkerBundleDir(project), assets = getWorkerAssetsDir(project);
await mkdir(bundle, { recursive: true });
await writeAssets({ root: project, sourceDirectory: frontend });
await mkdir(join(assets, '__server'), { recursive: true }); await writeFile(join(assets, '__server/game-server.mjs'), backendBytes);
await build({ entryPoints: [join(project, 'worker.ts')], outfile: join(bundle, 'worker.mjs'), bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', minify: true,
  external: ['cloudflare:workers'], define: { __GAME_BACKEND_VERSION__: JSON.stringify(version) } });
await writeWorkerConfig({ root: project, config: config.worker, manifest: { type: 'complete', mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm' } } } });
for (const container of config.containers ?? []) await writeContainerConfig({ root: project, config: container, directoryName: container.name });
await writeRootConfig(project, config.settings, context);
await readBuildOutput(project);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.txt': 'text/plain', '.md': 'text/plain', '.mp3': 'audio/mpeg' };
const manifest = {}, files = [];
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await inventory(path); continue; }
    if (!entry.isFile()) throw new Error('Deployment assets must be ordinary files.');
    const bytes = await readFile(path), extension = extname(path).slice(1);
    const hash = createHash('sha256').update(bytes.toString('base64') + extension).digest('hex').slice(0, 32);
    const assetPath = '/' + relative(assets, path).split(sep).join('/');
    manifest[assetPath] = { hash, size: bytes.length };
    files.push({ path: assetPath, file: path, hash, size: bytes.length, contentType: mime[extname(path)] || 'application/octet-stream' });
  }
}
await inventory(assets);
const name = config.worker.name;
const textBindings = Object.entries(config.worker.env ?? {}).filter(([, binding]) => binding.type === 'text')
  .map(([name, binding]) => ({ name, type: 'plain_text', text: binding.value }));
const metadata = {
  main_module: 'worker.mjs', compatibility_date: config.worker.compatibilityDate, compatibility_flags: config.worker.compatibilityFlags,
  bindings: [{ name: 'ASSETS', type: 'assets' }, { name: 'RUNTIME', type: 'durable_object_namespace', class_name: 'RestaurantRuntime' }, ...textBindings],
  exports: { RestaurantRuntime: { type: 'durable-object', storage: 'sqlite', container: `${name}-runtime` }, BudgetBridge: { type: 'worker' } },
  containers: [{ name: `${name}-runtime`, class_name: 'RestaurantRuntime' }],
  keep_bindings: ['secret_text'],
  code_update_strategy: { mode: 'immediate' },
  assets: { jwt: 'REPLACE_WITH_ASSET_COMPLETION_JWT', config: { run_worker_first: true, html_handling: 'none', not_found_handling: 'none' } },
  observability: { enabled: true },
};
const artifact = { workerName: name, backendVersion: version, workerFile: join(bundle, 'worker.mjs'), metadata,
  containerApplication: { name: `${name}-runtime`, scheduling_policy: 'durable_object', durable_objects: { namespace_id: 'REPLACE_WITH_CREATED_NAMESPACE_ID' } }, manifest, files };
await writeFile(join(project, '.cloudflare/deploy-artifact.json'), JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({ worker: name, backendBytes: backendBytes.length, assets: files.length, assetBytes: files.reduce((sum, file) => sum + file.size, 0), artifact: join(project, '.cloudflare/deploy-artifact.json') }));
