import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@crit/authority": fileURLToPath(new URL("../authority/src/index.ts", import.meta.url)),
      "@crit/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@crit/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
      "@crit/replica": fileURLToPath(new URL("../replica/src/index.ts", import.meta.url)),
      "@crit/representations": fileURLToPath(new URL("../representations/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    include: [`${packageRoot}test/**/*.test.tsx`]
  }
})
