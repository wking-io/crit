import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" }
    })
  ],
  resolve: {
    alias: {
      "@crit/authority/adapter": fileURLToPath(new URL("../authority/src/adapter.ts", import.meta.url)),
      "@crit/authority/testing": fileURLToPath(new URL("../authority/src/testing.ts", import.meta.url)),
      "@crit/authority": fileURLToPath(new URL("../authority/src/index.ts", import.meta.url)),
      "@crit/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
      "@crit/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
      "@crit/representations/testing": fileURLToPath(new URL("../representations/src/testing.ts", import.meta.url)),
      "@crit/representations": fileURLToPath(new URL("../representations/src/index.ts", import.meta.url))
    }
  },
  test: {
    include: [`${packageRoot}test/**/*.workers.test.ts`]
  }
})
