import { build } from 'esbuild'

await build({
  entryPoints: ['src/handler.ts', 'src/invocation-logging-config.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@aws-sdk/*'],
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
})
