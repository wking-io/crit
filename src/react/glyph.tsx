import {
  createContext,
  createElement,
  useContext,
  useId,
  type ReactNode,
  type SVGProps
} from "react"

import {
  glyphDefinitions,
  glyphNames,
  type GlyphAttributeValue,
  type GlyphName,
  type GlyphNode
} from "../glyphs/index.js"

const GlyphPrefixContext = createContext<string | null>(null)

const reactAttributeName = (name: string) => {
  if (name === "class") return "className"
  if (name.startsWith("aria-") || name.startsWith("data-")) return name
  return name.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase())
}

const reactAttributes = (attributes: Readonly<Record<string, GlyphAttributeValue>>) =>
  Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [reactAttributeName(name), value])
  )

const renderNode = ({ attrs, tag }: GlyphNode, key: number) =>
  createElement(tag, { ...reactAttributes(attrs), key })

const glyphId = (prefix: string, name: GlyphName) => `${prefix}-${name}`

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "children" | "name"> {
  readonly name: GlyphName
}

export function Glyph({ name, ...props }: GlyphProps) {
  const prefix = useContext(GlyphPrefixContext)
  const definition = glyphDefinitions[name]
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined
  const accessibility = labelled || props["aria-hidden"] !== undefined
    ? {}
    : { "aria-hidden": true }
  return (
    <svg
      height="1em"
      width="1em"
      viewBox={definition.viewBox}
      {...reactAttributes(definition.attrs ?? {})}
      {...accessibility}
      {...props}
    >
      {prefix === null
        ? definition.nodes.map(renderNode)
        : <use href={`#${glyphId(prefix, name)}`} />}
    </svg>
  )
}

function GlyphSheet({ prefix }: { readonly prefix: string }) {
  return (
    <svg
      aria-hidden="true"
      data-crit-glyph-sheet=""
      focusable="false"
      height="0"
      style={{ position: "absolute" }}
      width="0"
    >
      <defs>
        {glyphNames.map((name) => {
          const definition = glyphDefinitions[name]
          return (
            <symbol
              id={glyphId(prefix, name)}
              key={name}
              viewBox={definition.viewBox}
              {...reactAttributes(definition.attrs ?? {})}
            >
              {definition.nodes.map(renderNode)}
            </symbol>
          )
        })}
      </defs>
    </svg>
  )
}

export function GlyphProvider({ children }: { readonly children: ReactNode }) {
  const inheritedPrefix = useContext(GlyphPrefixContext)
  const reactId = useId()
  if (inheritedPrefix !== null) return children
  const prefix = `crit-glyph-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <GlyphPrefixContext.Provider value={prefix}>
      <GlyphSheet prefix={prefix} />
      {children}
    </GlyphPrefixContext.Provider>
  )
}

export { glyphNames, type GlyphName }
