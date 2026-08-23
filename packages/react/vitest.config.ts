import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@crit/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@crit/representations": fileURLToPath(new URL("../representations/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    include: [`${packageRoot}test/**/*.test.tsx`]
  }
})
