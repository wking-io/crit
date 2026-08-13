import { parse } from "node-html-parser"

const escapeAttribute = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")

const scriptString = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c")

export const prepareFrameRelayHtml = (
  source: string,
  documentUrl: string,
  canonicalUrl: string
) => {
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
  if (head === null) throw new Error("Frame response must contain a head element")

  for (const metadata of root.querySelectorAll("meta")) {
    if (metadata.getAttribute("name")?.toLowerCase() === "crit-frame-url") {
      metadata.remove()
    }
  }
  for (const base of root.querySelectorAll("base")) base.remove()

  const navigationUrl = new URL(documentUrl)
  navigationUrl.hash = new URL(canonicalUrl).hash
  const prelude = [
    `<base href="${escapeAttribute(documentUrl)}">`,
    `<meta name="crit-frame-url" content="${escapeAttribute(canonicalUrl)}">`,
    "<script data-crit-frame-location>",
    `try{history.replaceState(history.state,"",${scriptString(navigationUrl.href)})}catch{}`,
    "</script>"
  ].join("")
  head.insertAdjacentHTML("afterbegin", prelude)
  return root.toString()
}
