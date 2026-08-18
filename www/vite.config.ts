import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const critRoot = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@riff-refine/crit/tokens.css": critRoot("../src/react/base-tokens.css"),
      "@riff-refine/crit": critRoot("../src/react/index.ts")
    },
    dedupe: ["react", "react-dom"]
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.CRIT_WWW_PORT ?? "4173", 10),
    strictPort: true
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
