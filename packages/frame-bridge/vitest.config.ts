import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@crit/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    include: [`${packageRoot}test/**/*.test.ts`]
  }
})
