// Bundles preview-runtime/ into the script that the sandboxed preview frame loads.

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

import { build } from "esbuild"

const ICONS_DIR = "node_modules/ionicons/dist/svg"

/** Icon name to the markup inside its svg. "-sharp" icons fall back to their base icon, to keep the script small. */
const ioniconsPlugin = {
  name: "ionicons",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^virtual:ionicons$/ }, (args) => ({ path: args.path, namespace: "ionicons" }))
    pluginBuild.onLoad({ filter: /.*/, namespace: "ionicons" }, async () => {
      const names = (await readdir(ICONS_DIR)).filter((file) => file.endsWith(".svg") && !file.endsWith("-sharp.svg"))
      const icons = {}
      await Promise.all(
        names.map(async (file) => {
          const svg = await readFile(path.join(ICONS_DIR, file), "utf8")
          icons[file.slice(0, -4)] = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
        })
      )
      return { contents: `export default ${JSON.stringify(icons)}`, loader: "js" }
    })
  },
}

await build({
  entryPoints: ["preview-runtime/index.tsx"],
  outfile: "public/preview-runtime/runtime.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  plugins: [ioniconsPlugin],
  logLevel: "warning",
})
