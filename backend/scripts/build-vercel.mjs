#!/usr/bin/env node
// Builds the backend into Vercel's Build Output API layout (v3):
//   <repo>/.vercel/output/config.json
//   <repo>/.vercel/output/functions/index.func/{index.mjs,.vc-config.json}
// One bundled file: /shared, zod, Hono and @google/genai are all inside, so
// Vercel doesn't need to resolve anything outside this folder.

import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const repo = path.resolve(backend, '..');
const out = path.join(repo, '.vercel', 'output');
const fn = path.join(out, 'functions', 'index.func');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [path.join(backend, 'src', 'vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@skinfix/shared': path.join(repo, 'shared', 'src', 'index.ts') },
  nodePaths: [path.join(backend, 'node_modules'), path.join(repo, 'shared', 'node_modules')],
  // Some dependencies still call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
});

writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false, // keep the raw request stream for Hono
      maxDuration: 60, // analysis + Arabic translation can take ~20-30 s
    },
    null,
    2,
  ),
);

// Every path goes to the one function; Hono does the routing.
writeFileSync(path.join(out, 'config.json'), JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }, null, 2));
console.log(`Vercel output written to ${path.relative(repo, out)}`);
