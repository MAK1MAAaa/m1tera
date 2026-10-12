import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const EXPECTED_COMMIT = 'abe508e1b89912adde45528136c3221eb69acdd7';
const REPOSITORY = 'https://github.com/earendil-works/pi';
const packageNames = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai'];
const project = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const commit = execFileSync('git', ['-C', 'third_party/pi', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== EXPECTED_COMMIT) throw new Error('Pi submodule differs from the reviewed release commit');
if (execFileSync('git', ['-C', 'third_party/pi', 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Pi upstream source must remain unmodified');
const online = process.argv.includes('--online');
const packages = [];
for (const name of packageNames) {
  const directory = name.endsWith('pi-agent-core') ? 'agent' : 'ai';
  const source = JSON.parse(await readFile(`third_party/pi/packages/${directory}/package.json`, 'utf8'));
  const installed = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  const version = project.dependencies[name];
  const entry = lock.packages[`node_modules/${name}`];
  if (version !== '1.1.0' || source.version !== version || installed.version !== version || entry.version !== version) throw new Error(`${name}: source, manifest, lockfile and installed package differ`);
  let provenanceCommit;
  if (online) {
    const response = await fetch(`https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(name)}@${version}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Cannot read npm provenance: ${response.status}`);
    const data = await response.json();
    for (const attestation of data.attestations ?? []) {
      const envelope = attestation.bundle?.dsseEnvelope;
      if (!envelope?.payload) continue;
      const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
      if (statement.predicateType !== 'https://slsa.dev/provenance/v1') continue;
      const build = statement.predicate.buildDefinition;
      if (build.externalParameters.workflow.repository !== REPOSITORY) throw new Error('Unexpected provenance repository');
      provenanceCommit = build.resolvedDependencies.find((dependency) => dependency.uri.startsWith(`git+${REPOSITORY}@`))?.digest.gitCommit;
      if (provenanceCommit !== commit) throw new Error('npm provenance source commit differs from the submodule');
      const sha512 = entry.integrity.replace('sha512-', '');
      const digest = Buffer.from(sha512, 'base64').toString('hex');
      if (!statement.subject.some((subject) => subject.digest?.sha512 === digest)) throw new Error('npm provenance package digest differs from the lockfile');
    }
    if (!provenanceCommit) throw new Error('No matching npm source provenance');
  }
  packages.push({ name, version, integrity: entry.integrity, ...(provenanceCommit ? { provenanceCommit } : {}) });
}
const result = { repository: REPOSITORY, tag: 'v1.1.0', commit, packages, verification: online ? 'HTTPS npm provenance source/digest matched; no independent Sigstore signature verification' : 'local source, manifest, lockfile, installed versions matched' };
if (online) {
  await mkdir('docs', { recursive: true });
  await writeFile('docs/upstream.json', JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
