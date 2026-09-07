import { build } from 'esbuild'
const targets = [
  { entry: 'castep-progress/src/client/index.ts', out: 'castep-progress/lib/client.js' },
  { entry: 'castep-structure-viewer/src/client/index.ts', out: 'castep-structure-viewer/lib/client.js' },
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
    // react/react-dom 作为 peer 由 dsh web 应用提供（避免双 React）；three 会打进结构查看器包。
    external: ['react', 'react-dom', 'react-dom/client'],
  })
  console.log('built', t.out)
}
