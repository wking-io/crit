import type { CSSProperties } from "react"

export type CssVariableStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>

export const cssVariableStyle = (
  style: CssVariableStyle
): CssVariableStyle => style
