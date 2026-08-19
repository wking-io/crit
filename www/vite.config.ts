import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const critRoot = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: critRoot("../node_modules/.vite/www"),
  resolve: {
    alias: {
      "@riff-refine/crit/tokens.css": critRoot("../src/react/base-tokens.css"),
      "@riff-refine/crit": critRoot("../src/react/index.ts")
    },
    dedupe: ["react", "react-dom"]
  },
  optimizeDeps: {
    holdUntilCrawlEnd: false,
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@base-ui/react/accordion",
      "@base-ui/react/button",
      "@base-ui/react/checkbox",
      "@base-ui/react/dialog",
      "@base-ui/react/field",
      "@base-ui/react/form",
      "@base-ui/react/input",
      "@base-ui/react/separator",
      "@base-ui/react/toast",
      "@base-ui/react/toggle",
      "@base-ui/react/tooltip",
      "@tanstack/react-hotkeys",
      "effect",
      "motion"
    ]
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.CRIT_WWW_PORT ?? "4173", 10),
    strictPort: true,
    fs: {
      allow: [critRoot("..")]
    }
  },
  preview: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.CRIT_WWW_PORT ?? "4173", 10),
    strictPort: true
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
    target: "es2022"
  }
})
