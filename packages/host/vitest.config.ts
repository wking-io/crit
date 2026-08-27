import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

const resolve = {
  alias: {
    "@crit/authority": fileURLToPath(new URL("../authority/src/index.ts", import.meta.url)),
    "@crit/client": fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
    "@crit/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
    "@crit/frame-bridge": fileURLToPath(new URL("../frame-bridge/src/index.ts", import.meta.url)),
    "@crit/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
    "@crit/react": fileURLToPath(new URL("../react/src/index.ts", import.meta.url)),
    "@crit/replica/http": fileURLToPath(new URL("../replica/src/http.ts", import.meta.url)),
    "@crit/replica": fileURLToPath(new URL("../replica/src/index.ts", import.meta.url)),
    "@crit/representations": fileURLToPath(new URL("../representations/src/index.ts", import.meta.url))
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
          include: [`${packageRoot}test/**/*.test.{ts,tsx}`],
          exclude: [`${packageRoot}test/vite-spa-fallback.test.ts`]
        }
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: [`${packageRoot}test/vite-spa-fallback.test.ts`]
        }
      }
    ]
  }
})
