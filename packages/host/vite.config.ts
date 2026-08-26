import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "dist-web",
    emptyOutDir: true
  },
  resolve: {
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
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
