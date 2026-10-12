import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = '24.21.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_PACKAGES = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'typebox', 'js-tiktoken'];
// Pinned from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
// Both the downloaded official manifest and archive must agree with these hashes.
const TARGETS = {
  'aarch64-apple-darwin': { artifact: 'darwin-arm64.tar.gz', sha: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057' },
  'x86_64-apple-darwin': { artifact: 'darwin-x64.tar.gz', sha: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097' },
  'x86_64-unknown-linux-gnu': { artifact: 'linux-x64.tar.gz', sha: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff' },
  'aarch64-unknown-linux-gnu': { artifact: 'linux-arm64.tar.gz', sha: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5' },
  'x86_64-pc-windows-msvc': { artifact: 'win-x64/node.exe', sha: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32' },
  'aarch64-pc-windows-msvc': { artifact: 'win-arm64/node.exe', sha: 'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7' },
};

const exists = async (file) => access(file).then(() => true, () => false);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function hostTarget() {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : '';
  const platform = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' }[process.platform];
  if (!arch || !platform) throw new Error(`Unsupported build host: ${process.platform}/${process.arch}`);
  return `${arch}-${platform}`;
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes;
}

export async function prepareNode(target, cacheDir) {
  const info = TARGETS[target];
  if (!info) throw new Error(`Unsupported sidecar target: ${target}`);
  await mkdir(cacheDir, { recursive: true });
  const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}/`;
  const sumsPath = path.join(cacheDir, `node-v${NODE_VERSION}-SHASUMS256.txt`);
  const sums = await exists(sumsPath) ? await readFile(sumsPath) : await download(`${baseUrl}SHASUMS256.txt`, sumsPath);
  const artifactName = info.artifact.endsWith('.exe') ? info.artifact : `node-v${NODE_VERSION}-${info.artifact}`;
  const expectedLine = sums.toString('utf8').split(/\r?\n/).find((line) => line.endsWith(`  ${artifactName}`));
  if (!expectedLine || expectedLine.slice(0, 64) !== info.sha) {
    throw new Error('Official Node.js checksum manifest does not match the pinned distribution');
  }
  const archive = path.join(cacheDir, artifactName.replaceAll('/', '-'));
  let bytes = await exists(archive) ? await readFile(archive) : await download(`${baseUrl}${artifactName}`, archive);
  if (sha256(bytes) !== info.sha) {
    await rm(archive, { force: true });
    throw new Error(`Node.js checksum verification failed: ${artifactName}. Run preparation again to redownload`);
  }
  bytes = undefined;
  const binaryDir = path.join(ROOT, 'src-tauri/binaries');
  await mkdir(binaryDir, { recursive: true });
  const destination = path.join(binaryDir, `node-${target}${info.artifact.endsWith('.exe') ? '.exe' : ''}`);
  if (info.artifact.endsWith('.exe')) {
    await copyFile(archive, destination);
  } else {
    const extractDir = path.join(cacheDir, `extract-${target}`);
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    const folder = `node-v${NODE_VERSION}-${info.artifact.replace('.tar.gz', '')}`;
    execFileSync('tar', ['-xzf', archive, '-C', extractDir, `${folder}/bin/node`], { stdio: 'pipe' });
    await copyFile(path.join(extractDir, folder, 'bin/node'), destination);
    await chmod(destination, 0o755);
    await rm(extractDir, { recursive: true, force: true });
  }
  return destination;
}

async function resolvePackage(name, from) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, 'node_modules', name);
    if (await exists(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Missing installed runtime dependency: ${name}`);
    directory = parent;
  }
}

export async function prepareResources() {
  const resources = path.join(ROOT, 'src-tauri/resources');
  const compiled = path.join(ROOT, 'dist-runtime');
  if (!await exists(path.join(compiled, 'runtime/index.js'))) {
    throw new Error('Compiled runtime is missing. Run npm run build:runtime first');
  }
  const rootPackage = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  await rm(resources, { recursive: true, force: true });
  await mkdir(resources, { recursive: true });
  await cp(compiled, resources, { recursive: true });
  // Resolve and copy the installed, lockfile-verified dependency closure rather
  // than rebundling Pi or downloading a second, differently resolved tree.
  const copied = new Set();
  async function copyPackage(name, from, optional = false) {
    let source;
    try { source = await resolvePackage(name, from); } catch (error) {
      if (optional) return;
      throw error;
    }
    if (copied.has(source)) return;
    const relative = path.relative(ROOT, source).replaceAll(path.sep, '/');
    if (!relative.startsWith('node_modules/')) throw new Error(`Dependency is outside the project: ${name}`);
    const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    if (!lock.packages?.[relative] || lock.packages[relative].version !== metadata.version) {
      throw new Error(`Installed package does not match package-lock.json: ${name}. Run npm ci`);
    }
    copied.add(source);
    const destination = path.join(resources, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: (file) => file === source || !path.relative(source, file).split(path.sep).includes('node_modules'),
    });
    const optionalNames = new Set(Object.keys(metadata.optionalDependencies ?? {}));
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      await copyPackage(dependency, source, optionalNames.has(dependency));
    }
    for (const dependency of optionalNames) await copyPackage(dependency, source, true);
  }
  const dependencies = {};
  for (const name of RUNTIME_PACKAGES) {
    const version = rootPackage.dependencies?.[name];
    if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
      throw new Error(`Runtime dependency must use an exact version: ${name}`);
    }
    dependencies[name] = version;
    await copyPackage(name, ROOT);
  }
  await writeFile(path.join(resources, 'package.json'), `${JSON.stringify({
    name: 'm1tera-agent-runtime', private: true, version: rootPackage.version, type: 'module', dependencies,
  }, null, 2)}\n`);
  await writeFile(path.join(resources, 'distribution.json'), `${JSON.stringify({
    nodeVersion: NODE_VERSION,
    dependencies,
    packageLockSha256: sha256(await readFile(path.join(ROOT, 'package-lock.json'))),
    packageCount: copied.size,
  }, null, 2)}\n`);
  return resources;
}

async function main() {
  const args = process.argv.slice(2);
  let target = process.env.TAURI_ENV_TARGET_TRIPLE || hostTarget();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) target = args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const cacheDir = process.env.M1TERA_NODE_CACHE || path.join(os.tmpdir(), 'm1tera-node-distributions');
  const resources = await prepareResources();
  const node = await prepareNode(target, cacheDir);
  if (target === hostTarget()) {
    const version = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
    if (version !== `v${NODE_VERSION}`) throw new Error(`Bundled Node.js has an unexpected version: ${version}`);
    execFileSync(node, ['--input-type=module', '-e', "await import('@earendil-works/pi-agent-core'); await import('@earendil-works/pi-ai'); await import('@earendil-works/pi-ai/providers/openai'); await import('@earendil-works/pi-ai/oauth'); await import('js-tiktoken');"], { cwd: resources, stdio: 'pipe' });
  }
  console.log(`Prepared Node ${NODE_VERSION} for ${target}; runtime packages copied from package-lock.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Sidecar preparation failed');
    process.exitCode = 1;
  });
}
