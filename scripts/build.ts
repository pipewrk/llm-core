#!/usr/bin/env bun
/**
 * Central build script (Bun) that:
 * 1. Cleans dist
 * 2. Typechecks (no emit)
 * 3. Runs tsup build (JS + d.ts)
 * 4. Regenerates package.json exports map for every file in src/core (barrel style JS, per-file .d.ts)
 *
 * We intentionally keep a single runtime JS entry (dist/index.js) for all subpath entries to
 * preserve the barrel export pattern while still exposing granular type definitions.
 */
import { readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_CORE = join(ROOT, 'src', 'core');
const DIST = join(ROOT, 'dist');
const PKG_PATH = join(ROOT, 'package.json');

async function run(cmd: string, args: string[]) {
  const p = Bun.spawn([cmd, ...args], { stdout: 'inherit', stderr: 'inherit' });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${code}`);
}

async function clean() {
  await rm(DIST, { recursive: true, force: true });
}

async function typecheck() {
  // Use build config for declaration alignment (even though tsup will emit d.ts)
  await run('bun', ['x', 'tsc', '-p', 'tsconfig.build.json', '--noEmit']);
}

async function buildBundle() {
  await run('bun', ['x', 'tsup']);
}

function toExportKey(filename: string) {
  return filename.replace(/\.ts$/, '');
}

async function generateExports() {
  const entries = await readdir(SRC_CORE, { withFileTypes: true });
  const INTERNAL = new Set([
    'decorators.ts',
    'file-utils.ts',
    'ufetch.ts',
    'classification-service.ts',
    'ml-service.ts',
    'env.ts'
  ]);
  const files = entries
    .filter(d => d.isFile() && d.name.endsWith('.ts'))
    .map(d => d.name)
    .filter(name => !name.endsWith('.test.ts'))
    .filter(name => !INTERNAL.has(name));

  // Always ensure index.ts exists
  if (!files.includes('index.ts')) {
    throw new Error('Expected src/core/index.ts to exist');
  }

  const pkgRaw = await readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const baseExports: Record<string, any> = {
    '.': {
      import: './dist/index.js',
      types: './dist/index.d.ts'
    }
  };

  for (const file of files) {
    if (file === 'index.ts') continue; // root already handled
    const key = './' + toExportKey(file);
    const dtsPath = `./dist/core/${toExportKey(file)}.d.ts`;
    baseExports[key] = {
      import: './dist/index.js',
      types: dtsPath
    };
  }

  // Only update if changed to avoid dirty git state unnecessarily
  const changed = JSON.stringify(pkg.exports, null, 2) !== JSON.stringify(baseExports, null, 2);
  if (changed) {
    pkg.exports = baseExports;
    await writeFile(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log('Updated package.json exports map');
  } else {
    console.log('Exports map unchanged');
  }
}

async function main() {
  console.log('> Cleaning dist');
  await clean();
  console.log('> Typechecking');
  await typecheck();
  console.log('> Building bundle with tsup');
  await buildBundle();
  console.log('> Generating exports map');
  await generateExports();
  console.log('Build complete');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
