import { randomUUID } from "node:crypto"
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { build, transform, type Loader, type Plugin } from "esbuild"
import { Effect, Layer } from "effect"
import { NodeType, parse, type Node as HtmlNode } from "node-html-parser"

import {
  SnapshotArchive,
  CRIT_SNAPSHOT_PATH,
  SnapshotCaptureFailed,
  SnapshotNotFound,
  SnapshotStorageFailed,
  type SnapshotArchiveShape,
  type SnapshotArtifact
} from "../runtime/snapshot-archive.js"

const SNAPSHOT_DIRECTORY = ".crit/snapshots"
const MAX_RESOURCE_BYTES = 12 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 30 * 1024 * 1024
const CAPTURE_TIMEOUT_MS = 60_000

export interface FileSystemSnapshotArchiveOptions {
  readonly root: string
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
  readonly createId?: () => string
  readonly captureTimeoutMillis?: number
}

type FetchedResource = {
  readonly body: Buffer
  readonly contentType: string
  readonly url: string
}

type FetchResource = (url: string) => Promise<FetchedResource>

const make = (
  options: FileSystemSnapshotArchiveOptions
): SnapshotArchiveShape => {
  const directory = path.join(options.root, SNAPSHOT_DIRECTORY)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? createSnapshotId
  const captureTimeout = options.captureTimeoutMillis ?? CAPTURE_TIMEOUT_MS

  return {
    capture: (value) =>
      Effect.gen(function*() {
        const sourceUrl = yield* Effect.try({
          try: () => normalizeSnapshotSourceUrl(value),
          catch: (cause) => captureFailure(value, cause)
        })
        const artifactId = yield* Effect.try({
          try: () => {
            const id = createId()
            assertArtifactId(id)
            return id
          },
          catch: (cause) => captureFailure(sourceUrl, cause)
        })
        const html = yield* Effect.tryPromise({
          // The signal aborts when the capture deadline interrupts this
          // effect, cancelling every in-flight resource fetch with it.
          try: async (signal) => {
            const fetchResource = createResourceFetcher(
              fetchImplementation,
              signal
            )
            const response = await fetchResource(sourceUrl)
            const output = await buildSnapshotHtml(
              response.body.toString("utf8"),
              response.url,
              `${CRIT_SNAPSHOT_PATH}${artifactId}`,
              fetchResource
            )
            const size = Buffer.byteLength(output)
            if (size > MAX_SNAPSHOT_BYTES) {
              throw new Error(
                `Snapshot is too large (${formatBytes(size)}; limit ${formatBytes(MAX_SNAPSHOT_BYTES)}).`
              )
            }
            return output
          },
          catch: (cause) => captureFailure(sourceUrl, cause)
        })
        const sizeBytes = Buffer.byteLength(html)
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(directory, { recursive: true })
            const target = snapshotFilePath(directory, artifactId)
            const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
            try {
              await writeFile(temporary, html, { mode: 0o600 })
              await link(temporary, target)
            } finally {
              await unlink(temporary).catch(() => undefined)
            }
          },
          catch: (cause) => storageFailure("capture", artifactId, cause)
        })
        return {
          artifactId,
          sourceUrl,
          capturedAt: now().toISOString(),
          sizeBytes
        } satisfies SnapshotArtifact
      }).pipe(
        Effect.timeoutOrElse({
          duration: captureTimeout,
          orElse: () =>
            Effect.fail(
              captureFailure(
                value,
                new Error(
                  `Capture deadline exceeded: the snapshot did not complete within ${Math.round(captureTimeout / 1000)} seconds.`
                )
              )
            )
        })
      ),
    read: (artifactId) =>
      Effect.tryPromise({
        try: async () => {
          assertArtifactId(artifactId)
          return new Uint8Array(
            await readFile(snapshotFilePath(directory, artifactId))
          )
        },
        catch: (cause) =>
          isNodeError(cause, "ENOENT")
            ? new SnapshotNotFound({ artifactId })
            : storageFailure("read", artifactId, cause)
      })
  }
}

const layer = (options: FileSystemSnapshotArchiveOptions) =>
  Layer.succeed(SnapshotArchive, make(options))

export const FileSystemSnapshotArchive = { make, layer } as const

const captureFailure = (sourceUrl: string, cause: unknown) =>
  new SnapshotCaptureFailed({
    sourceUrl,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const storageFailure = (operation: string, artifactId: string, cause: unknown) =>
  new SnapshotStorageFailed({
    operation,
    artifactId,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const createResourceFetcher = (
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal
): FetchResource =>
  async (url) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fetchResourceOnce(fetchImpl, url, signal)
      } catch (cause) {
        if (
          !(cause instanceof TypeError) ||
          attempt > 0 ||
          signal.aborted
        ) {
          throw cause
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw new Error(`Could not snapshot ${url}.`)
  }

// Vite dev servers serve a .css URL as a JavaScript HMR module unless the
// request accepts text/css, so stylesheet fetches must say what they want.
const acceptHeaderFor = (url: string) => {
  try {
    if (new URL(url).pathname.toLowerCase().endsWith(".css")) {
      return "text/css,*/*;q=0.1"
    }
  } catch {
    // Not a parsable URL; the fetch itself will report the real failure.
  }
  return "*/*"
}

const fetchResourceOnce = async (
  fetchImpl: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal
): Promise<FetchedResource> => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: acceptHeaderFor(url),
      "User-Agent": "crit-snapshot/1.0"
    },
    redirect: "follow",
    signal
  })
  if (!response.ok) {
    throw new Error(`Could not snapshot ${url} (${response.status}).`)
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_BYTES) {
    throw new Error(
      `Snapshot resource is too large: ${url} (${formatBytes(declaredLength)}).`
    )
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > MAX_RESOURCE_BYTES) {
    throw new Error(
      `Snapshot resource is too large: ${url} (${formatBytes(body.byteLength)}).`
    )
  }
  return {
    body,
    contentType: response.headers.get("content-type") ?? "",
    url: response.url || url
  }
}

const buildSnapshotHtml = async (
  source: string,
  sourceUrl: string,
  archivePath: string,
  fetchResource: FetchResource
) => {
  const documentUrl = new URL(sourceUrl)
  const root = parse(source, {
    comment: true,
    blockTextElements: {
      pre: true,
      script: true,
      style: true,
      textarea: true
    }
  })
  const head = root.querySelector("head")
  const body = root.querySelector("body")
  if (head === null || body === null) {
    throw new Error("Snapshot source must contain a head and body.")
  }

  for (const meta of root.querySelectorAll("meta")) {
    if (
      meta.getAttribute("http-equiv")?.toLowerCase() ===
      "content-security-policy"
    ) {
      meta.setAttribute("content", "")
    }
  }

  for (const link of [...root.querySelectorAll("link")]) {
    const rel = link
      .getAttribute("rel")
      ?.toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    if (rel?.includes("stylesheet")) {
      const href = link.getAttribute("href")
      if (href === undefined) {
        link.remove()
        continue
      }
      const stylesheetUrl = resolveDocumentUrl(href, documentUrl)
      const css = await bundleRemoteEntry(
        stylesheetUrl,
        "css",
        documentUrl,
        fetchResource
      )
      link.setAttribute(
        "href",
        bufferToDataUrl(Buffer.from(css), "text/css;charset=utf-8")
      )
      link.setAttribute("data-snapshot-source-href", stylesheetUrl)
      link.removeAttribute("integrity")
      link.removeAttribute("crossorigin")
      continue
    }
    if (rel?.includes("modulepreload") || rel?.includes("preload")) {
      link.remove()
      continue
    }
    if (rel?.some((value) => value === "icon" || value === "apple-touch-icon")) {
      await inlineAttributeAsset(link, "href", documentUrl, fetchResource)
    }
  }

  for (const style of root.querySelectorAll("style")) {
    const css = await bundleInlineSource(
      style.innerHTML,
      "css",
      documentUrl,
      fetchResource
    )
    style.set_content(escapeStyle(css))
  }

  const moduleScripts = [...root.querySelectorAll("script")].filter(
    (script) => script.getAttribute("type")?.toLowerCase() === "module"
  )
  for (const [index, script] of moduleScripts.entries()) {
    const src = script.getAttribute("src")
    const sourceCode = src === undefined
      ? script.innerHTML
      : `import ${JSON.stringify(resolveDocumentUrl(src, documentUrl))};`
    let bundled = sourceCode.trim()
      ? await bundleInlineSource(sourceCode, "js", documentUrl, fetchResource)
      : ""
    if (index === 0) {
      bundled = `${createLocationPrelude(documentUrl, archivePath)};${bundled};${createLocationRestore(archivePath)}`
    }
    script.setAttribute(
      "src",
      bufferToDataUrl(Buffer.from(bundled), "text/javascript;charset=utf-8")
    )
    script.removeAttribute("integrity")
    script.removeAttribute("crossorigin")
    script.set_content("")
  }

  for (const script of [...root.querySelectorAll("script")]) {
    const type = script.getAttribute("type")?.toLowerCase()
    if (type === "module") continue
    if (type === "importmap") {
      script.remove()
      continue
    }
    if (type === "application/ld+json") {
      try {
        script.set_content(JSON.stringify(JSON.parse(script.innerHTML)))
      } catch {
        // Invalid structured data is preserved as served.
      }
      continue
    }
    if (
      type !== undefined &&
      type !== "text/javascript" &&
      type !== "application/javascript"
    ) {
      continue
    }
    const src = script.getAttribute("src")
    const sourceCode = src === undefined
      ? script.innerHTML
      : (await fetchResource(resolveDocumentUrl(src, documentUrl))).body.toString("utf8")
    const minified = await minifyJavaScript(sourceCode)
    script.removeAttribute("integrity")
    script.removeAttribute("crossorigin")
    if (src !== undefined) {
      script.setAttribute(
        "data-snapshot-source-src",
        resolveDocumentUrl(src, documentUrl)
      )
      script.setAttribute(
        "src",
        bufferToDataUrl(Buffer.from(minified), "text/javascript;charset=utf-8")
      )
      script.set_content("")
    } else {
      script.set_content(escapeScript(minified))
    }
  }

  await inlineDocumentAssets(root, documentUrl, fetchResource)
  removeNonRuntimeComments(root)
  const serialized = root.toString().trim()
  return /^<!doctype/i.test(serialized)
    ? serialized
    : `<!doctype html>${serialized}`
}

const bundleRemoteEntry = async (
  entryUrl: string,
  loader: "css" | "js",
  documentUrl: URL,
  fetchResource: FetchResource
) => {
  const result = await build({
    entryPoints: [entryUrl],
    bundle: true,
    ...(loader === "js" ? { format: "iife" as const } : {}),
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    platform: "browser",
    target: ["es2020"],
    write: false,
    plugins: [createHttpBundlePlugin(documentUrl, fetchResource)]
  })
  return readBuildOutput(result.outputFiles ?? [], loader)
}

const bundleInlineSource = async (
  source: string,
  loader: "css" | "js",
  documentUrl: URL,
  fetchResource: FetchResource
) => {
  const result = await build({
    stdin: {
      contents: source,
      loader,
      sourcefile: `snapshot-inline.${loader}`
    },
    bundle: true,
    ...(loader === "js" ? { format: "iife" as const } : {}),
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    platform: "browser",
    target: ["es2020"],
    write: false,
    plugins: [createHttpBundlePlugin(documentUrl, fetchResource)]
  })
  return readBuildOutput(result.outputFiles ?? [], loader)
}

const createHttpBundlePlugin = (
  documentUrl: URL,
  fetchResource: FetchResource
): Plugin => ({
  name: "crit-http-snapshot",
  setup(bundle) {
    bundle.onResolve({ filter: /.*/ }, (args) => {
      if (/^(?:data|blob):/.test(args.path)) {
        return { path: args.path, external: true }
      }
      if (/^(?:node:|#)/.test(args.path)) {
        return { path: args.path, external: true }
      }
      const importer =
        args.namespace === "snapshot-http" && args.importer
          ? args.importer
          : documentUrl.href
      let url: URL
      try {
        url = new URL(args.path, importer)
      } catch {
        return { path: args.path, external: true }
      }
      if (url.pathname.endsWith("/@vite/client")) {
        return { path: url.href, namespace: "vite-client-stub" }
      }
      if (url.pathname.includes("inject-hmr-runtime")) {
        return { path: url.href, namespace: "react-refresh-preamble-stub" }
      }
      if (
        url.pathname.includes("@react-refresh") ||
        url.pathname.includes("hmr-runtime")
      ) {
        return { path: url.href, namespace: "react-refresh-stub" }
      }
      return { path: url.href, namespace: "snapshot-http" }
    })
    bundle.onLoad({ filter: /.*/, namespace: "vite-client-stub" }, () => ({
      contents: VITE_CLIENT_STUB,
      loader: "js"
    }))
    bundle.onLoad(
      { filter: /.*/, namespace: "react-refresh-preamble-stub" },
      () => ({ contents: REACT_REFRESH_PREAMBLE_STUB, loader: "js" })
    )
    bundle.onLoad({ filter: /.*/, namespace: "react-refresh-stub" }, () => ({
      contents: REACT_REFRESH_STUB,
      loader: "js"
    }))
    bundle.onLoad({ filter: /.*/, namespace: "snapshot-http" }, async (args) => {
      const resource = await fetchResource(args.path)
      return {
        contents: resource.body,
        loader: loaderForResource(resource)
      }
    })
  }
})

const VITE_CLIENT_STUB = `
const hotContext={data:{},accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){}}
export function createHotContext(){return hotContext}
export function injectQuery(url){return url}
export function updateStyle(id,css){let style=document.querySelector('style[data-vite-dev-id="'+id+'"]');if(!style){style=document.createElement('style');style.setAttribute('data-vite-dev-id',id);document.head.appendChild(style)}style.textContent=css}
export function removeStyle(id){document.querySelector('style[data-vite-dev-id="'+id+'"]')?.remove()}
export class ErrorOverlay{}
`

const REACT_REFRESH_PREAMBLE_STUB = `
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>value=>value;window.__vite_plugin_react_preamble_installed__=true
`

const REACT_REFRESH_STUB = `
const runtime={injectIntoGlobalHook(){},register(){},createSignatureFunctionForTransform(){return value=>value},performReactRefresh(){},__hmr_import(){return Promise.resolve({})},registerExportsForReactRefresh(){},validateRefreshBoundaryAndEnqueueUpdate(){}}
export default runtime
export function registerExportsForReactRefresh(){}
export function validateRefreshBoundaryAndEnqueueUpdate(){}
`

const loaderForResource = (resource: FetchedResource): Loader => {
  const contentType = resource.contentType.toLowerCase()
  const pathname = new URL(resource.url).pathname.toLowerCase()
  if (contentType.includes("text/css")) return "css"
  if (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    /\.[cm]?js$/.test(pathname)
  ) return "js"
  if (contentType.includes("json") || pathname.endsWith(".json")) return "json"
  if (contentType.startsWith("text/")) return "text"
  return "dataurl"
}

const readBuildOutput = (
  outputFiles: ReadonlyArray<{ readonly path: string; readonly text: string }>,
  loader: "css" | "js"
) => {
  const extension = loader === "css" ? ".css" : ".js"
  const output =
    outputFiles.find((file) => file.path.endsWith(extension)) ?? outputFiles[0]
  if (output === undefined) {
    throw new Error(`Snapshot ${loader.toUpperCase()} bundle is empty.`)
  }
  return output.text
}

const minifyJavaScript = async (source: string) => {
  if (!source.trim()) return ""
  const result = await transform(source, {
    legalComments: "none",
    loader: "js",
    minify: true,
    target: "es2020"
  })
  return result.code
}

const inlineDocumentAssets = async (
  root: ReturnType<typeof parse>,
  documentUrl: URL,
  fetchResource: FetchResource
) => {
  const attributes = [
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["video", "poster"],
    ["audio", "src"],
    ["input", "src"]
  ] as const
  for (const [selector, attribute] of attributes) {
    for (const element of root.querySelectorAll(selector)) {
      await inlineAttributeAsset(element, attribute, documentUrl, fetchResource)
    }
  }
  for (const element of root.querySelectorAll("img,source")) {
    const srcset = element.getAttribute("srcset")
    if (srcset === undefined) continue
    element.setAttribute("data-snapshot-source-srcset", srcset)
    const candidates = await Promise.all(
      srcset.split(",").map(async (candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2)
        if (url === undefined || shouldLeaveAssetUrl(url)) return candidate.trim()
        const dataUrl = await resourceToDataUrl(
          resolveDocumentUrl(url, documentUrl),
          fetchResource
        )
        return descriptor === undefined ? dataUrl : `${dataUrl} ${descriptor}`
      })
    )
    element.setAttribute("srcset", candidates.join(","))
  }
}

const inlineAttributeAsset = async (
  element: ReturnType<typeof parse>,
  attribute: string,
  documentUrl: URL,
  fetchResource: FetchResource
) => {
  const value = element.getAttribute(attribute)
  if (value === undefined || shouldLeaveAssetUrl(value)) return
  const source = resolveDocumentUrl(value, documentUrl)
  element.setAttribute(`data-snapshot-source-${attribute}`, source)
  element.setAttribute(
    attribute,
    await resourceToDataUrl(source, fetchResource)
  )
}

const resourceToDataUrl = async (
  url: string,
  fetchResource: FetchResource
) => {
  const resource = await fetchResource(url)
  const mimeType =
    resource.contentType.split(";")[0]?.trim() || "application/octet-stream"
  return bufferToDataUrl(resource.body, mimeType)
}

const bufferToDataUrl = (value: Buffer, mimeType: string) =>
  `data:${mimeType};base64,${value.toString("base64")}`

const shouldLeaveAssetUrl = (value: string) =>
  /^(?:data|blob|javascript|#):?/i.test(value)

const removeNonRuntimeComments = (node: HtmlNode) => {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === NodeType.COMMENT_NODE) {
      if (!/^\s*(?:\$[?!]?|\/\$)\s*$/.test(child.rawText)) child.remove()
      continue
    }
    removeNonRuntimeComments(child)
  }
}

const resolveDocumentUrl = (value: string, documentUrl: URL) =>
  new URL(value, documentUrl).href

const normalizeSnapshotSourceUrl = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be snapshotted.")
  }
  url.hash = ""
  return url.href
}

const createSnapshotId = () => {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  return `${timestamp}-${randomUUID().slice(0, 8)}`
}

const snapshotFilePath = (directory: string, artifactId: string) =>
  path.join(directory, `${artifactId}.html`)

const assertArtifactId = (value: string) => {
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new Error("Invalid snapshot artifact id.")
  }
}

const escapeScript = (value: string) => value.replace(/<\/script/gi, "<\\/script")
const escapeStyle = (value: string) => value.replace(/<\/style/gi, "<\\/style")

const createLocationPrelude = (documentUrl: URL, archivePath: string) => {
  const sourceLocation = `${documentUrl.pathname}${documentUrl.search}${documentUrl.hash}`
  return `(()=>{const prefix="data-snapshot-source-",resources=[];for(const element of document.querySelectorAll("*")){for(const attribute of element.attributes){if(!attribute.name.startsWith(prefix))continue;const target=attribute.name.slice(prefix.length),frozen=element.getAttribute(target);if(frozen)resources.push({tag:element.tagName,target,source:attribute.value,frozen})}}const freeze=()=>{for(const resource of resources){for(const element of document.querySelectorAll(resource.tag)){const current=element.getAttribute(resource.target);if(!current||current===resource.frozen)continue;let matches=current===resource.source;try{matches||=new URL(current,document.baseURI).href===resource.source}catch{}if(matches)element.setAttribute(resource.target,resource.frozen)}}};window.__critFreezeSnapshotResources=freeze;new MutationObserver(freeze).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["href","src","srcset","poster"]});window.__critSnapshotUrl=${JSON.stringify(archivePath)};history.replaceState(history.state,"",${JSON.stringify(sourceLocation)})})()`
}

const createLocationRestore = (archivePath: string) =>
  `setTimeout(()=>{window.__critFreezeSnapshotResources?.();history.replaceState(history.state,"",${JSON.stringify(archivePath)})},5000)`

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const isNodeError = (cause: unknown, code: string) =>
  cause instanceof Error &&
  "code" in cause &&
  cause.code === code
