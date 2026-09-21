import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';

type PackageJson = {
  name: string;
  version: string;
  engines: {node: string; npm: string};
  packageManager: string;
};

type SemverModule = {
  valid: (version: string) => string | null;
  satisfies: (version: string, range: string) => boolean;
};

type PackageLock = {
  name: string;
  version: string;
  packages?: {
    '': {
      name?: string;
      version?: string;
      engines: {node: string; npm: string};
    };
  };
};

function readText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8').trim();
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

const manifest = readJson<PackageJson>('package.json');
const semver = createRequire(import.meta.url)('next/dist/compiled/semver') as SemverModule;

function acceptsNodeRuntime(version: string): boolean {
  const normalized = semver.valid(version);
  if (!normalized) throw new Error(`Malformed node version ${version}`);
  return semver.satisfies(normalized, manifest.engines.node);
}

test('runtime compatibility follows engines.node manifest range and rejects malformed major mismatches', () => {
  const supported = ['24.15.0', '24.19.0', '24.15.1', '24.20.2'];
  for (const version of supported) assert.equal(acceptsNodeRuntime(version), true);
  const unsupported = ['23.18.0', '25.0.0', 'v22.15.0'];
  for (const version of unsupported) assert.equal(acceptsNodeRuntime(version), false);
  for (const version of ['v24', '24', 'abc', '', '24.15', '24.15.0.1']) {
    assert.throws(() => acceptsNodeRuntime(version), /Malformed node version/);
  }
});

test('runtime pins and constraints in manifest files stay exact', () => {
  const lock = readJson<PackageLock>('package-lock.json');
  const lockRoot = lock.packages?.[''];
  assert.equal(manifest.packageManager, 'npm@11.12.1');
  assert.equal(manifest.engines.node, '24.x');
  assert.equal(manifest.engines.npm, '11.12.x');
  assert.equal(manifest.engines.node, lockRoot?.engines?.node);
  assert.equal(manifest.engines.npm, lockRoot?.engines?.npm);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
});

test('local and CI bootstrap remains pinned to Node24.15.0', () => {
  const nvmrc = readText('.nvmrc');
  const npmrc = readText('.npmrc');
  const ci = readText('.github/workflows/ci.yml');
  const setup = readText('scripts/setup.mjs');
  assert.equal(nvmrc, '24.15.0');
  assert.equal(npmrc.split(/\r?\n/).includes('engine-strict=true'), true);
  assert.equal(/node-version:\s*'24\.15\.0'/.test(ci), true);
  assert.equal(/npm install --global npm@11\.12\.1 --no-fund --no-audit/.test(ci), true);
  assert.equal(/process\.version !== 'v24\.15\.0'/.test(setup), true);
  assert.equal(setup.includes("const result = spawnSync('npm', args"), true);
});

test('Vercel commands continue to run with pinned npm11.12.1', () => {
  const vercel = readJson<{installCommand: string; buildCommand: string}>('vercel.json');
  assert.equal(vercel.installCommand, 'npx --yes --package=npm@11.12.1 -- npm ci --no-audit --no-fund');
  assert.equal(
    vercel.buildCommand,
    'node --version && npx --yes --package=npm@11.12.1 -- npm --version && npx --yes --package=npm@11.12.1 -- npm run build',
  );
  assert.equal(/npx --yes --package=npm@11\.12\.1/.test(vercel.installCommand), true);
  assert.equal(/npx --yes --package=npm@11\.12\.1/.test(vercel.buildCommand), true);
});
