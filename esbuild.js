// Bundles the extension host (Node/TS) into dist/extension.js.
// The webview is built separately by Vite (vite.webview.config.ts).
const esbuild = require('esbuild')
const path = require('path')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'dist', 'extension.js'),
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log('[esbuild] watching host…')
  } else {
    await esbuild.build(options)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
