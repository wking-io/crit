const reservedPathPrefixes = ["/mcp", "/oauth", "/artifacts"] as const

export const isDocumentRequest = (request: Request): boolean => {
  if (request.method !== "GET" && request.method !== "HEAD") return false
  const accept = request.headers.get("accept")
  if (accept === null) return false
  return accept.toLowerCase().split(",").some((part) => part.trim().startsWith("text/html"))
}

const isReservedPath = (pathname: string): boolean =>
  reservedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

const emptyResponse = (status: number) => new Response(null, { status })

const placeholderShell = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Crit</title>
<body><p>Crit</p></body>
</html>`

const shellResponse = () => new Response(placeholderShell, {
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" }
})

export const serveShell = async (
  request: Request,
  env: Cloudflare.Env
): Promise<Response> => {
  const pathname = new URL(request.url).pathname
  if (isReservedPath(pathname)) return emptyResponse(404)
  if (request.method !== "GET" && request.method !== "HEAD") return emptyResponse(404)
  try {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
    if (isDocumentRequest(request)) {
      const index = new URL(request.url)
      index.pathname = "/"
      const fallback = await env.ASSETS.fetch(new Request(index, request))
      if (fallback.status !== 404) return fallback
      return shellResponse()
    }
  } catch {
    if (isDocumentRequest(request)) return shellResponse()
  }
  return emptyResponse(404)
}
