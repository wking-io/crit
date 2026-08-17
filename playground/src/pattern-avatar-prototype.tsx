// PROTOTYPE — The selected woven-pattern direction on the existing `/ui` route.
import {
  useMemo,
  useState,
  type ReactNode
} from "react"

import { cssVariableStyle } from "../../src/react/css-variable-style.js"

import "./pattern-avatar-prototype.css"

type ColorFamily = "red" | "orange" | "blue" | "green" | "purple"
type EdgeMode = "full" | "inset"
type EdgePreference = EdgeMode | "mixed"
type PaletteMode = "mixed" | "light" | "dark" | "monochrome"
type PatternMode =
  | "basket"
  | "checker"
  | "cross"
  | "diagonal"
  | "diamonds"
  | "lattice"
  | "maze"
  | "medallion"
  | "pinwheel"
  | "rings"
  | "stepped"
  | "windows"

type QualityCheck = { readonly label: string; readonly passed: boolean }
type PatternPalette = {
  readonly accent: string
  readonly background: string
  readonly families: readonly [ColorFamily, ColorFamily, ColorFamily]
  readonly foreground: string
  readonly label: string
  readonly mode: Exclude<PaletteMode, "mixed">
}

type PatternParameters = {
  readonly band: number
  readonly framed: boolean
  readonly modulus: number
  readonly phase: number
  readonly radius: number
  readonly spacing: number
  readonly threshold: number
}

type WovenSpec = {
  readonly accentCells: ReadonlyArray<number>
  readonly attempts: number
  readonly cells: ReadonlyArray<boolean>
  readonly edgeMode: EdgeMode
  readonly gridSize: 11
  readonly mode: PatternMode
  readonly palette: PatternPalette
  readonly parameters: PatternParameters
  readonly quality: {
    readonly passed: boolean
    readonly checks: ReadonlyArray<QualityCheck>
  }
  readonly renderedSeed: number
  readonly requestedSeed: number
  readonly symmetry: "D4"
}

const COLOR_FAMILIES: ReadonlyArray<ColorFamily> = ["red", "orange", "blue", "green", "purple"]
const PALETTE_MODES: ReadonlyArray<PaletteMode> = ["mixed", "light", "dark", "monochrome"]
const EDGE_PREFERENCES: ReadonlyArray<EdgePreference> = ["mixed", "full", "inset"]
const paletteModeFor = (value: string): PaletteMode =>
  PALETTE_MODES.find((mode) => mode === value) ?? "mixed"
const edgePreferenceFor = (value: string): EdgePreference =>
  EDGE_PREFERENCES.find((preference) => preference === value) ?? "mixed"
const PATTERN_MODES: ReadonlyArray<PatternMode> = [
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
  "maze",
  "checker"
]

const mulberry32 = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

const colorToken = (family: ColorFamily, tone: "c1" | "c2" | "p1" | "t2") => `var(--crit-color-${family}-${tone})`

const paletteForSeed = (seed: number, requestedMode: PaletteMode): PatternPalette => {
  const random = mulberry32(seed ^ 0x5f37_59df)
  const backgroundFamily = COLOR_FAMILIES[Math.floor(random() * COLOR_FAMILIES.length)]!
  const remaining = COLOR_FAMILIES.filter((family) => family !== backgroundFamily)
  const foregroundFamily = remaining[Math.floor(random() * remaining.length)]!
  const accentCandidates = COLOR_FAMILIES.filter((family) => family !== backgroundFamily && family !== foregroundFamily)
  const accentFamily = accentCandidates[Math.floor(random() * accentCandidates.length)]!
  const mode = requestedMode === "mixed"
    ? random() > 0.5 ? "light" : "dark"
    : requestedMode
  if (mode === "monochrome") {
    return {
      accent: colorToken(backgroundFamily, "p1"),
      background: colorToken(backgroundFamily, "c2"),
      families: [backgroundFamily, backgroundFamily, backgroundFamily],
      foreground: colorToken(backgroundFamily, "t2"),
      label: `${backgroundFamily} monochrome`,
      mode
    }
  }
  const darkGround = mode === "dark"
  return {
    accent: colorToken(accentFamily, "p1"),
    background: colorToken(backgroundFamily, darkGround ? "t2" : "c2"),
    families: [backgroundFamily, foregroundFamily, accentFamily],
    foreground: colorToken(foregroundFamily, darkGround ? "c1" : "t2"),
    label: `${backgroundFamily} / ${foregroundFamily} / ${accentFamily}`,
    mode
  }
}

const edgeModeFor = (seed: number, preference: EdgePreference): EdgeMode => preference === "mixed"
  ? Math.abs(seed) % 2 === 0 ? "full" : "inset"
  : preference

const patternAt = (
  mode: PatternMode,
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
  if (mode === "checker") return (x + y + parameters.phase) % 2 === 0
  if (mode === "diamonds") return (sum + parameters.phase) % parameters.modulus < parameters.threshold
  if (mode === "rings") return (outer + parameters.phase) % parameters.spacing === 0
  if (mode === "lattice") return (dx + parameters.phase) % parameters.spacing === 0 || (dy + parameters.phase) % parameters.spacing === 0
  if (mode === "stepped") return (inner + outer * 2 + parameters.phase) % parameters.modulus < parameters.threshold
  if (mode === "diagonal") return (difference + parameters.phase) % parameters.spacing === 0 || (sum + parameters.phase) % parameters.modulus === 0
  if (mode === "basket") return (Math.floor(dx / 2) + Math.floor(dy / 2) + parameters.phase) % 2 === (sum % 2)
  if (mode === "cross") return dx <= parameters.band || dy <= parameters.band || difference === parameters.band + 1
  if (mode === "medallion") return (sum <= parameters.radius && (sum + parameters.phase) % parameters.spacing !== 1) || outer === parameters.radius
  if (mode === "windows") {
    const windowRadius = Math.max(3, parameters.radius)
    return outer === windowRadius || (outer < windowRadius && (dx === parameters.band || dy === parameters.band))
  }
  if (mode === "pinwheel") return ((dx * 2 + dy + parameters.phase) % parameters.modulus < parameters.threshold) || ((dy * 2 + dx + parameters.phase) % parameters.modulus < parameters.threshold)
  return (dx * dy + sum + parameters.phase) % parameters.modulus < parameters.threshold
}

const matrixMetrics = (cells: ReadonlyArray<boolean>) => {
  const size = 11
  const active = cells.reduce((count, cell) => count + Number(cell), 0)
  const activeIndexes = new Set<number>()
  cells.forEach((cell, index) => { if (cell) activeIndexes.add(index) })
  const neighborsFor = (index: number) => {
    const x = index % size
    const y = Math.floor(index / size)
    const neighbors: number[] = []
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue
        const nextX = x + offsetX
        const nextY = y + offsetY
        if (nextX >= 0 && nextX < size && nextY >= 0 && nextY < size) neighbors.push(nextY * size + nextX)
      }
    }
    return neighbors
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
    const start = next.value
    const stack = [start]
    unseen.delete(start)
    while (stack.length > 0) {
      for (const neighbor of neighborsFor(stack.pop()!)) {
        if (!unseen.has(neighbor)) continue
        unseen.delete(neighbor)
        stack.push(neighbor)
      }
    }
  }
  const rowSignatures = new Set(Array.from({ length: size }, (_, row) => cells.slice(row * size, row * size + size).map(Number).join("")))
  let transitions = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      if (x < size - 1 && cells[index] !== cells[index + 1]) transitions += 1
      if (y < size - 1 && cells[index] !== cells[index + size]) transitions += 1
    }
  }
  const edgeIndexes = cells.flatMap((_, index) => {
    const x = index % size
    const y = Math.floor(index / size)
    return x === 0 || x === size - 1 || y === 0 || y === size - 1 ? [index] : []
  })
  return {
    components,
    edgeActive: edgeIndexes.some((index) => cells[index]),
    isolated,
    occupancy: active / cells.length,
    rowDiversity: rowSignatures.size,
    transitions
  }
}

const buildWoven = (
  requestedSeed: number,
  renderedSeed: number,
  attempts: number,
  mode: PatternMode,
  palette: PatternPalette,
  edgeMode: EdgeMode
): WovenSpec => {
  const random = mulberry32(renderedSeed)
  const parameters: PatternParameters = {
    band: Math.floor(random() * 2),
    framed: edgeMode === "full" && random() < 0.28,
    modulus: 3 + Math.floor(random() * 3),
    phase: Math.floor(random() * 6),
    radius: 2 + Math.floor(random() * 4),
    spacing: 2 + Math.floor(random() * 3),
    threshold: 1 + Math.floor(random() * 2)
  }
  const cells = Array.from({ length: 121 }, (_, index) => {
    const x = index % 11
    const y = Math.floor(index / 11)
    const onEdge = x === 0 || x === 10 || y === 0 || y === 10
    if (edgeMode === "inset" && onEdge) return false
    if (parameters.framed && onEdge) return true
    return patternAt(mode, x, y, parameters)
  })
  const accentCells = cells.flatMap((cell, index) => {
    if (!cell) return []
    const x = index % 11
    const y = Math.floor(index / 11)
    const dx = Math.abs(x - 5)
    const dy = Math.abs(y - 5)
    return (dx * 2 + dy + parameters.phase) % 7 === 0 ? [index] : []
  })
  const metrics = matrixMetrics(cells)
  const checks: ReadonlyArray<QualityCheck> = [
    { label: "20–78% pattern occupancy", passed: metrics.occupancy >= 0.2 && metrics.occupancy <= 0.78 },
    { label: "At most four isolated pixels", passed: metrics.isolated <= 4 },
    { label: "At most six visual components", passed: metrics.components <= 6 },
    { label: "At least two distinct rows", passed: metrics.rowDiversity >= 2 },
    { label: "Useful internal rhythm", passed: metrics.transitions >= 18 && metrics.transitions <= 180 },
    { label: edgeMode === "full" ? "Pattern reaches avatar edge" : "2px inset edge", passed: edgeMode === "inset" || metrics.edgeActive },
    { label: "D4 symmetry", passed: true }
  ]
  return {
    accentCells,
    attempts,
    cells,
    edgeMode,
    gridSize: 11,
    mode,
    palette,
    parameters,
    quality: { checks, passed: checks.every(({ passed }) => passed) },
    renderedSeed,
    requestedSeed,
    symmetry: "D4"
  }
}

const generateWoven = (
  seed: number,
  mode: PatternMode,
  palette: PatternPalette,
  edgeMode: EdgeMode
) => {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const spec = buildWoven(seed, seed + attempt * 104_729, attempt + 1, mode, palette, edgeMode)
    if (spec.quality.passed) return spec
  }
  return buildWoven(seed, seed, 48, mode, palette, edgeMode)
}

const fingerprint = (spec: WovenSpec) => spec.cells.map(Number).join("")

const generateBatch = (
  batchSeed: number,
  paletteMode: PaletteMode,
  edgePreference: EdgePreference,
  count: number
) => {
  const seen = new Set<string>()
  const modeOffset = Math.abs(batchSeed) % PATTERN_MODES.length
  return Array.from({ length: count }, (_, index) => {
    const mode = PATTERN_MODES[(index + modeOffset) % PATTERN_MODES.length]!
    let candidate: WovenSpec | undefined
    for (let uniquenessAttempt = 0; uniquenessAttempt < 64; uniquenessAttempt += 1) {
      const seed = batchSeed + index * 193 + uniquenessAttempt * 7_919
      candidate = generateWoven(
        seed,
        mode,
        paletteForSeed(seed, paletteMode),
        edgeModeFor(seed, edgePreference)
      )
      const key = fingerprint(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      return candidate
    }
    if (candidate === undefined) {
      throw new TypeError("Pattern generation did not produce a candidate")
    }
    return candidate
  })
}

function PatternArtwork({ spec }: { readonly spec: WovenSpec }) {
  const accentCells = new Set(spec.accentCells)
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22">
      <rect fill={spec.palette.background} height="22" width="22" />
      {spec.cells.map((active, index) => active ? (
        <rect fill={accentCells.has(index) ? spec.palette.accent : spec.palette.foreground} height="2" key={index} width="2" x={(index % 11) * 2} y={Math.floor(index / 11) * 2} />
      ) : null)}
    </svg>
  )
}

function PatternAvatar({ spec }: { readonly spec: WovenSpec }) {
  return <span className="pattern-avatar" data-fingerprint={fingerprint(spec)} data-quality={spec.quality.passed ? "passed" : "failed"}><PatternArtwork spec={spec} /></span>
}

function PatternZoom({ scale, spec }: { readonly scale: 2 | 5; readonly spec: WovenSpec }) {
  return <span className="pattern-prototype-zoom" style={cssVariableStyle({ "--pattern-zoom": String(scale) })}><PatternAvatar spec={spec} /></span>
}

function PrototypeHeader({ children, description, eyebrow, title }: {
  readonly children?: ReactNode
  readonly description: string
  readonly eyebrow: string
  readonly title: string
}) {
  return (
    <header className="pattern-prototype-header">
      <div><span>{eyebrow}</span><h3>{title}</h3><p>{description}</p></div>
      {children}
    </header>
  )
}

function QualityList({ spec }: { readonly spec: WovenSpec }) {
  return <ul className="pattern-prototype-quality">{spec.quality.checks.map((check) => <li data-passed={check.passed} key={check.label}><span>{check.passed ? "✓" : "×"}</span>{check.label}</li>)}</ul>
}

const stateFor = (spec: WovenSpec) => ({
  ...spec,
  accentCells: spec.accentCells.length,
  cells: undefined,
  matrix: Array.from({ length: 11 }, (_, row) => spec.cells.slice(row * 11, row * 11 + 11).map((cell) => cell ? "1" : "·").join("")),
  fingerprint: fingerprint(spec)
})

// SAFETY: Vite supplies import.meta.env.PROD to this browser-only playground module.
const prototypeIsProduction = (
  import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }
).env?.PROD === true

export function PatternAvatarPrototype() {
  const [batchSeed, setBatchSeed] = useState(8_801)
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("mixed")
  const [edgePreference, setEdgePreference] = useState<EdgePreference>("mixed")
  const specs = useMemo(() => generateBatch(batchSeed, paletteMode, edgePreference, 36), [batchSeed, edgePreference, paletteMode])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = specs[selectedIndex] ?? specs[0]!
  if (prototypeIsProduction) return null
  const modeCounts = PATTERN_MODES.map((mode) => ({ mode, count: specs.filter((spec) => spec.mode === mode).length }))
  return (
    <div className="pattern-prototype-variant">
      <PrototypeHeader
        description="A balanced batch of twelve discrete pattern grammars. Shape fingerprints prevent duplicate matrices, while seeded parameters vary rhythm inside each family."
        eyebrow="Selected direction · balanced grammar sampler"
        title="Woven avatar generator"
      >
        <div className="pattern-prototype-header-actions">
          <label><span>Colors</span><select onChange={(event) => setPaletteMode(paletteModeFor(event.currentTarget.value))} value={paletteMode}>{PALETTE_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
          <label><span>Edges</span><select onChange={(event) => setEdgePreference(edgePreferenceFor(event.currentTarget.value))} value={edgePreference}>{EDGE_PREFERENCES.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
          <button className="pattern-prototype-action" onClick={() => setBatchSeed((seed) => seed + 1)} type="button">Regenerate batch</button>
        </div>
      </PrototypeHeader>
      <a className="pattern-prototype-archive-link" href="/ui/prototypes">View previous prototype explorations →</a>
      <div className="pattern-prototype-mode-balance" aria-label="Pattern family distribution">
        {modeCounts.map(({ count, mode }) => <span key={mode}><strong>{mode}</strong>{count}</span>)}
      </div>
      <div className="pattern-prototype-quilt-layout">
        <div className="pattern-prototype-quilt">
          {specs.map((spec, index) => (
            <button aria-label={`${spec.mode} woven pattern seed ${spec.requestedSeed}`} aria-pressed={index === selectedIndex} key={`${spec.requestedSeed}-${spec.mode}`} onClick={() => setSelectedIndex(index)} type="button">
              <PatternZoom scale={2} spec={spec} />
              <span>{spec.mode}</span>
            </button>
          ))}
        </div>
        <aside className="pattern-prototype-inspector">
          <span className="pattern-prototype-inspector__label">Selected grammar</span>
          <div className="pattern-prototype-size-proof"><PatternZoom scale={5} spec={selected} /><PatternAvatar spec={selected} /></div>
          <strong>{selected.mode} · {selected.edgeMode}</strong>
          <small>{selected.palette.mode} ground · {selected.palette.label}</small>
          <QualityList spec={selected} />
          <pre className="pattern-prototype-state"><code>{JSON.stringify(stateFor(selected), null, 2)}</code></pre>
        </aside>
      </div>
    </div>
  )
}
