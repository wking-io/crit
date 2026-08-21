import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@crit/domain": new URL("../domain/src", import.meta.url).pathname
    }
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] }
})
