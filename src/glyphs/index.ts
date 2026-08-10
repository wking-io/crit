export {
  glyphDefinitions,
  glyphNames,
  type GlyphName
} from "./definitions.js"
export type {
  GlyphAttributeValue,
  GlyphDefinition,
  GlyphNode
} from "./types.js"

import { glyphDefinitions, type GlyphName } from "./definitions.js"
import type { GlyphAttributeValue, GlyphDefinition, GlyphNode } from "./types.js"

const escapeAttribute = (value: GlyphAttributeValue) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")

const nodeMarkup = ({ attrs, tag }: GlyphNode) => {
  const attributes = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("")
  return `<${tag}${attributes}></${tag}>`
}

/** Render one definition without a sheet for non-React documents such as the Frame bridge. */
export const glyphSvgMarkup = (
  name: GlyphName,
  options: { readonly height?: number; readonly width?: number } = {}
) => {
  const definition: GlyphDefinition = glyphDefinitions[name]
  const rootAttributes = Object.entries(definition.attrs ?? {})
    .map(([attribute, value]) => ` ${attribute}="${escapeAttribute(value)}"`)
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width ?? 16}" height="${options.height ?? 16}" viewBox="${escapeAttribute(definition.viewBox)}" aria-hidden="true"${rootAttributes}>${definition.nodes.map(nodeMarkup).join("")}</svg>`
}
