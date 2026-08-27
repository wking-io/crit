export type GlyphAttributeValue = string | number

export interface GlyphNode {
  readonly tag: "circle" | "line" | "path" | "polyline" | "rect"
  readonly attrs: Readonly<Record<string, GlyphAttributeValue>>
}

export interface GlyphDefinition {
  readonly viewBox: string
  readonly attrs?: Readonly<Record<string, GlyphAttributeValue>>
  readonly nodes: ReadonlyArray<GlyphNode>
}
