declare namespace Cloudflare {
  interface Env {
    readonly CANVASES: DurableObjectNamespace<
      import("./canvas-object.js").CanvasDurableObject
    >
  }

  interface GlobalProps {
    mainModule: typeof import("./worker.js")
    durableNamespaces: "CanvasDurableObject"
  }
}
