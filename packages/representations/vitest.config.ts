import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@crit/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url))
    }
  },
  test: { include: [`${packageRoot}test/**/*.test.ts`] }
})
