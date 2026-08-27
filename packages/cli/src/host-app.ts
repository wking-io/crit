import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { Effect, Schema } from "effect"
import { createServer } from "vite"

export const HOST_PORT = 5173
export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

export class HostAppFailure extends Schema.TaggedError<HostAppFailure>()(
  "HostAppFailure",
  { message: Schema.String }
) {}

export const resolveHostRoot = (
  from = fileURLToPath(new URL("../../host", import.meta.url))
): string | undefined => existsSync(path.join(from, "vite.config.ts")) ? from : undefined

export const startHostApp = (root: string, daemonOrigin: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async() => {
        const server = await createServer({
          configFile: path.join(root, "vite.config.ts"),
          root,
          server: {
            host: "127.0.0.1",
            port: HOST_PORT,
            strictPort: true,
            proxy: {
              "/browser": {
                target: daemonOrigin,
                changeOrigin: true,
                ws: true
              }
            }
          }
        })
        await server.listen()
        return server
      },
      catch: (cause) => new HostAppFailure({
        message: cause instanceof Error
          ? cause.message
          : "Unable to start the Crit browser application"
      })
    }),
    (server) => Effect.promise(() => server.close())
  )
