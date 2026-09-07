import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const targets = [
  { id: '@smartcatai/castep-progress', entry: 'castep-progress/src/client/index.ts', out: 'castep-progress/lib/client.js' },
  { id: '@smartcatai/castep-structure-viewer', entry: 'castep-structure-viewer/src/client/index.ts', out: 'castep-structure-viewer/lib/client.js' },
]

function wrap(id, body) {
  return `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n${body}\n\t\treturn module.exports;\n\t},\n});\n`
}

for (const t of targets) {
  const res = await build({
    entryPoints: [t.entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client'],
    write: false,
  })
  const body = res.outputFiles[0].text
  writeFileSync(t.out, wrap(t.id, body))
  console.log('built', t.out, ((body.length + 300) / 1024).toFixed(1) + 'KB')
}
