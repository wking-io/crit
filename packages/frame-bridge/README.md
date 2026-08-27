# @crit/frame-bridge

Framework-neutral Frame Bridge. The host assigns iframe src. The page reports route.

```ts
import { assignLiveFrameRoute, connectBridgedFrameInput } from "@crit/frame-bridge"
import { renderFrameRouteBridgeTag } from "@crit/frame-bridge/html"
import { frameAncestorsPreviewVitePlugin, frameRouteBridgeVitePlugin } from "@crit/frame-bridge/vite"
import { renderFrameAncestorsResponseHeaders } from "@crit/frame-bridge/headers"
```

`vite` is an optional peer of the Vite adapter. Shared review previews send `frame-ancestors` through `@crit/frame-bridge/headers`.
