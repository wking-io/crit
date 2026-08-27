import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

const resolve = {
  alias: {
    "@crit/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url))
  }
}

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [`${packageRoot}test/**/*.test.ts`],
          exclude: [`${packageRoot}test/vite.test.ts`]
        }
      },
      {
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: [`${packageRoot}test/vite.test.ts`]
        }
      }
    ]
  }
})
