import { build } from 'esbuild'
const targets = [
  { entry: 'castep-progress.bak/src/client/index.ts', out: 'castep-progress.bak/lib/client.js' },
  { entry: 'castep-structure-viewer.bak/src/client/index.ts', out: 'castep-structure-viewer.bak/lib/client.js' },
]
for (const t of targets) {
  await build({
    entryPoints: [t.entry],
    outfile: t.out,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
  })
  console.log('built', t.out)
}
