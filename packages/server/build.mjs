import { build } from 'esbuild'

// One self-contained file per entrypoint: the Docker image needs no node_modules at all.
await build({
  entryPoints: ['src/index.ts', 'src/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minifySyntax: true,
  legalComments: 'none',
  // CommonJS dependencies (express, ioredis) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
})
