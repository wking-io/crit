import type { ReactNode } from "react"

export const WOVEN_AVATAR_FAMILIES = [
  "diamonds",
  "rings",
  "lattice",
  "stepped",
  "diagonal",
  "basket",
  "cross",
  "medallion",
  "windows",
  "pinwheel",
  "maze"
] as const

export type WovenAvatarFamily = typeof WOVEN_AVATAR_FAMILIES[number]

export type WovenAvatarPalette = {
  readonly accent: string
  readonly background: string
  readonly foreground: string
}

export type WovenAvatarSpec = {
  readonly accentCells: ReadonlyArray<number>
  readonly cells: ReadonlyArray<boolean>
  readonly family: WovenAvatarFamily
  readonly occupancy: number
  readonly palette: WovenAvatarPalette
}

type ColorFamily = "red" | "orange" | "blue" | "green" | "purple"
type EdgeMode = "full" | "inset"
type Mask = "none" | "diamond" | "square"
type PatternParameters = {
  band: number
  block: number
  framed: boolean
  mask: Mask
  modulus: number
  phase: number
  radius: number
  spacing: number
  threshold: number
}

const COLOR_FAMILIES: ReadonlyArray<ColorFamily> = [
  "red",
  "orange",
  "blue",
  "green",
  "purple"
]
const COLOR_HUE = {
  blue: "245.3",
  green: "156.3",
  orange: "55",
  purple: "302",
  red: "9"
} as const
const MASKS: ReadonlyArray<Mask> = ["none", "diamond", "square"]

const hashIdentity = (identity: string) => {
  let hash = 2166136261
  for (const character of identity) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const randomFor = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

const colorToken = (family: ColorFamily, role: "c2" | "p1" | "t2") => {
  const lightness = role === "c2" ? "94%" : role === "p1" ? "67%" : "28%"
  const chroma = role === "c2" ? "0.028" : role === "p1" ? "0.18" : "0.1"
  return `var(--crit-color-${family}-${role}, oklch(${lightness} ${chroma} ${COLOR_HUE[family]}))`
}

const paletteFor = (seed: number): WovenAvatarPalette => {
  const random = randomFor(seed ^ 0x5f3759df)
  const background = COLOR_FAMILIES[Math.floor(random() * COLOR_FAMILIES.length)]!
  const remaining = COLOR_FAMILIES.filter((family) => family !== background)
  const foreground = remaining[Math.floor(random() * remaining.length)]!
  const accents = COLOR_FAMILIES.filter(
    (family) => family !== background && family !== foreground
  )
  const accent = accents[Math.floor(random() * accents.length)]!
  const dark = random() > 0.5
  return {
    accent: colorToken(accent, "p1"),
    background: colorToken(background, dark ? "t2" : "c2"),
    foreground: colorToken(foreground, dark ? "c2" : "t2")
  }
}

const formula = (
  family: WovenAvatarFamily,
  x: number,
  y: number,
  parameters: PatternParameters
) => {
  const dx = Math.abs(x - 5)
  const dy = Math.abs(y - 5)
  const inner = Math.min(dx, dy)
  const outer = Math.max(dx, dy)
  const sum = dx + dy
  const difference = Math.abs(dx - dy)
  if (family === "diamonds") {
    return (sum + parameters.phase) % parameters.modulus < parameters.threshold
  }
  if (family === "rings") {
    return (outer + parameters.phase) % parameters.spacing === 0
  }
  if (family === "lattice") {
    return (dx + parameters.phase) % parameters.spacing === 0
      || (dy + parameters.phase) % parameters.spacing === 0
  }
  if (family === "stepped") {
    return (inner + outer * 2 + parameters.phase) % parameters.modulus
      < parameters.threshold
  }
  if (family === "diagonal") {
    return (difference + parameters.phase) % parameters.spacing === 0
      || (sum + parameters.phase) % parameters.modulus === 0
  }
  if (family === "basket") {
    return (Math.floor(dx / parameters.block)
      + Math.floor(dy / parameters.block)
      + parameters.phase) % 2 === sum % 2
  }
  if (family === "cross") {
    return dx <= parameters.band
      || dy <= parameters.band
      || difference === parameters.band + 1
  }
  if (family === "medallion") {
    return (sum <= parameters.radius
      && (sum + parameters.phase) % parameters.spacing !== 1)
      || outer === parameters.radius
  }
  if (family === "windows") {
    const radius = Math.max(3, parameters.radius)
    return outer === radius
      || (outer < radius && (dx === parameters.band || dy === parameters.band))
  }
  if (family === "pinwheel") {
    return (dx * 2 + dy + parameters.phase) % parameters.modulus
      < parameters.threshold
      || (dy * 2 + dx + parameters.phase) % parameters.modulus
        < parameters.threshold
  }
  return (dx * dy + sum + parameters.phase) % parameters.modulus
    < parameters.threshold
}

const neighborsFor = (index: number) => {
  const x = index % 11
  const y = Math.floor(index / 11)
  const neighbors: number[] = []
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue
      const nextX = x + offsetX
      const nextY = y + offsetY
      if (nextX >= 0 && nextX < 11 && nextY >= 0 && nextY < 11) {
        neighbors.push(nextY * 11 + nextX)
      }
    }
  }
  return neighbors
}

const occupancyOf = (cells: ReadonlyArray<boolean>) =>
  cells.reduce((count, cell) => count + Number(cell), 0) / 121

const metricsFor = (
  family: WovenAvatarFamily,
  cells: ReadonlyArray<boolean>,
  accentCount: number
) => {
  const activeIndexes = cells.flatMap((cell, index) => cell ? [index] : [])
  let transitions = 0
  for (let y = 0; y < 11; y += 1) {
    for (let x = 0; x < 11; x += 1) {
      const index = y * 11 + x
      if (x < 10 && cells[index] !== cells[index + 1]) transitions += 1
      if (y < 10 && cells[index] !== cells[index + 11]) transitions += 1
    }
  }
  let isolated = 0
  for (const index of activeIndexes) {
    if (neighborsFor(index).every((neighbor) => !cells[neighbor])) isolated += 1
  }
  const unseen = new Set(activeIndexes)
  let components = 0
  while (unseen.size > 0) {
    const next = unseen.values().next()
    if (next.done) break
    components += 1
    const stack = [next.value]
    unseen.delete(next.value)
    while (stack.length > 0) {
      for (const neighbor of neighborsFor(stack.pop()!)) {
        if (!unseen.has(neighbor)) continue
        unseen.delete(neighbor)
        stack.push(neighbor)
      }
    }
  }
  const occupancy = Math.round(occupancyOf(cells) * 1000) / 1000
  const componentLimit = family === "maze" ? 10 : 6
  return {
    occupancy,
    passed: occupancy >= 0.2
      && occupancy <= 0.78
      && !(occupancy >= 0.67 && transitions < 16)
      && transitions >= 18
      && transitions <= 180
      && isolated <= 2
      && components <= componentLimit
      && accentCount >= 5
  }
}

const cellsFor = (
  family: WovenAvatarFamily,
  edgeMode: EdgeMode,
  parameters: PatternParameters
) => Array.from({ length: 121 }, (_, index) => {
  const x = index % 11
  const y = Math.floor(index / 11)
  const dx = Math.abs(x - 5)
  const dy = Math.abs(y - 5)
  const onEdge = x === 0 || x === 10 || y === 0 || y === 10
  if (edgeMode === "inset" && onEdge) return false
  if (parameters.framed && onEdge) return true
  if (
    parameters.mask === "diamond"
    && dx + dy > Math.max(3, parameters.radius + 1)
  ) return false
  if (
    parameters.mask === "square"
    && Math.max(dx, dy) > Math.max(3, parameters.radius)
  ) return false
  return formula(family, x, y, parameters)
})

const interiorOccupancy = (cells: ReadonlyArray<boolean>) => {
  let active = 0
  for (let y = 1; y <= 9; y += 1) {
    for (let x = 1; x <= 9; x += 1) {
      if (cells[y * 11 + x]) active += 1
    }
  }
  return active / 81
}

const accentsFor = (
  cells: ReadonlyArray<boolean>,
  parameters: PatternParameters
) => {
  const pick = (modulus: number) => cells.flatMap((cell, index) => {
    if (!cell) return []
    const x = index % 11
    const y = Math.floor(index / 11)
    return (x * 2 + y + parameters.phase) % modulus === 0 ? [index] : []
  })
  const preferred = 5 + parameters.band
  let accentCells = pick(preferred)
  if (accentCells.length < 5) accentCells = pick(4)
  if (accentCells.length < 5) accentCells = pick(3)
  const active = cells.reduce((count, cell) => count + Number(cell), 0)
  if (accentCells.length > Math.max(8, Math.floor(active * 0.32))) {
    const thinner = pick(preferred + 2)
    if (thinner.length >= 5) accentCells = thinner
  }
  return accentCells
}

const paint = (family: WovenAvatarFamily, seed: number) => {
  const random = randomFor(seed)
  const edgeMode: EdgeMode = random() > 0.5 ? "full" : "inset"
  const parameters: PatternParameters = {
    band: Math.floor(random() * 2),
    block: family === "basket"
      ? 2 + Math.floor(random() * 2)
      : 1 + Math.floor(random() * 3),
    framed: edgeMode === "full" && random() < 0.25,
    mask: edgeMode === "full"
      ? "none"
      : MASKS[Math.floor(random() * MASKS.length)]!,
    modulus: 3 + Math.floor(random() * 4),
    phase: Math.floor(random() * 8),
    radius: 2 + Math.floor(random() * 4),
    spacing: 2 + Math.floor(random() * 3),
    threshold: 1 + Math.floor(random() * 2)
  }
  if (
    family === "pinwheel"
    && parameters.modulus <= 3
    && parameters.threshold >= 2
  ) {
    parameters.threshold = 1
  }
  if (family === "rings" && parameters.spacing === 4) parameters.spacing = 3
  let cells = cellsFor(family, edgeMode, parameters)
  if (parameters.mask !== "none" && occupancyOf(cells) < 0.2) {
    parameters.mask = "none"
    cells = cellsFor(family, edgeMode, parameters)
  }
  if (parameters.framed && interiorOccupancy(cells) < 0.18) {
    parameters.framed = false
    cells = cellsFor(family, edgeMode, parameters)
  }
  if (
    edgeMode === "full"
    && !cells.some((cell, index) =>
      cell && (index < 11 || index >= 110 || index % 11 === 0 || index % 11 === 10)
    )
  ) {
    cells = cells.map((cell, index) => {
      const x = index % 11
      const y = Math.floor(index / 11)
      return cell
        || ((x === 5 && (y === 0 || y === 10)) || (y === 5 && (x === 0 || x === 10)))
    })
  }
  const accentCells = accentsFor(cells, parameters)
  const metrics = metricsFor(family, cells, accentCells.length)
  return {
    accentCells,
    cells,
    family,
    occupancy: metrics.occupancy,
    palette: paletteFor(seed),
    passed: metrics.passed
  }
}

export const wovenAvatarFor = (identity: string): WovenAvatarSpec => {
  const numeric = hashIdentity(identity)
  const family = WOVEN_AVATAR_FAMILIES[numeric % WOVEN_AVATAR_FAMILIES.length]!
  let fallback = paint(family, numeric)
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const candidate = paint(family, numeric + attempt * 104_729)
    if (candidate.passed) return candidate
    fallback = candidate
  }
  return fallback
}

export function WovenAvatarPattern({
  spec
}: {
  readonly spec: WovenAvatarSpec
}): ReactNode {
  const accents = new Set(spec.accentCells)
  return (
    <svg
      aria-hidden="true"
      className="crit-presence__pattern"
      viewBox="0 0 22 22"
    >
      <rect fill={spec.palette.background} height="22" width="22" />
      {spec.cells.map((active, index) =>
        active
          ? (
            <rect
              fill={accents.has(index)
                ? spec.palette.accent
                : spec.palette.foreground}
              height="2"
              key={index}
              width="2"
              x={(index % 11) * 2}
              y={Math.floor(index / 11) * 2}
            />
          )
          : null
      )}
    </svg>
  )
}
