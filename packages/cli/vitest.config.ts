import { defineConfig } from "vitest/config"

process.env.NODE_NO_WARNINGS = "1"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000
  }
})
