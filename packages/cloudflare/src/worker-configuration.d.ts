declare namespace Cloudflare {
  interface Env {
    readonly CANVASES: DurableObjectNamespace<
      import("./canvas-object.js").CanvasDurableObject
    >
    readonly CONTROL: D1Database
    readonly CRIT_DEPLOY_TOKEN: string
  }

  interface GlobalProps {
    mainModule: typeof import("./worker.js")
    durableNamespaces: "CanvasDurableObject"
  }
}
