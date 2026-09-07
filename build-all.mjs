import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const targets = [
  { id: '@smartcatai/castep-progress', entry: 'castep-progress/src/client/index.ts', out: 'castep-progress/lib/client.js' },
  { id: '@smartcatai/castep-structure-viewer', entry: 'castep-structure-viewer/src/client/index.ts', out: 'castep-structure-viewer/lib/client.js' },
]

for (const t of targets) {
  const res = await build({
    entryPoints: [t.entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    // react/react-dom 由 dsh web 应用通过 __ModuleLoader__ 的 require 提供（避免双 React）；three 会打进结构查看器。
    external: ['react', 'react-dom', 'react-dom/client'],
    write: false,
  })
  const body = res.outputFiles[0].text
  const wrapped = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(t.id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n${body}\n\t},\n});\n`
  writeFileSync(t.out, wrapped)
  console.log('built', t.out, (wrapped.length / 1024).toFixed(1) + 'KB')
}
