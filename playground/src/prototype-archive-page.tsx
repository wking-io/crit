// REFERENCE ARCHIVE — Static reconstructions of superseded prototype directions.
import type { ReactNode } from "react"

import "./base-tokens.css"
import "./prototype-archive-page.css"

type ArchiveId = "eyes-randomized" | "eyes-art-directed" | "pattern-directions" | "pattern-color-mixing"
type EyeStyle = "random" | "mascot" | "editorial" | "geometric"
type PatternStyle = "glyph" | "woven" | "knot"

const ARCHIVES: ReadonlyArray<{
  readonly description: string
  readonly id: ArchiveId
  readonly label: string
  readonly version: string
}> = [
  {
    description: "The first broad eye grammar: curated families, parameter mixing, and evolutionary selection.",
    id: "eyes-randomized",
    label: "Randomized eye systems",
    version: "Eye exploration 01"
  },
  {
    description: "The constrained follow-up comparing graphic mascot, editorial, and geometric eye languages.",
    id: "eyes-art-directed",
    label: "Art-directed eye systems",
    version: "Eye exploration 02"
  },
  {
    description: "The first pattern comparison: glyph circuits, woven tiles, and Truchet knot emblems.",
    id: "pattern-directions",
    label: "Three pattern directions",
    version: "Pattern exploration 01"
  },
  {
    description: "The color and edge study that established mixed hues, full bleed, and 2px inset patterns.",
    id: "pattern-color-mixing",
    label: "Mixed-color pattern study",
    version: "Pattern exploration 02"
  }
]

const COLORS = [
  "var(--crit-color-orange-p1)",
  "var(--crit-color-blue-p2)",
  "var(--crit-color-green-p2)",
  "var(--crit-color-red-p1)",
  "var(--crit-color-purple-p1)"
] as const

const MIXED_PALETTES = [
  ["var(--crit-color-orange-c2)", "var(--crit-color-green-t2)", "var(--crit-color-purple-p1)"],
  ["var(--crit-color-blue-t2)", "var(--crit-color-red-c1)", "var(--crit-color-orange-p1)"],
  ["var(--crit-color-purple-c2)", "var(--crit-color-orange-t2)", "var(--crit-color-blue-p1)"],
  ["var(--crit-color-green-t2)", "var(--crit-color-purple-c1)", "var(--crit-color-red-p1)"],
  ["var(--crit-color-red-c2)", "var(--crit-color-blue-t2)", "var(--crit-color-green-p1)"]
] as const

function ArchiveShell({ children, description, title, verdict, version }: {
  readonly children: ReactNode
  readonly description: string
  readonly title: string
  readonly verdict: string
  readonly version: string
}) {
  return (
    <main className="prototype-archive-page">
      <nav className="prototype-archive-nav"><a href="/ui/prototypes">← Prototype archive</a><a href="/ui">Active UI lab ↗</a></nav>
      <header className="prototype-archive-hero">
        <span>{version} · reference only</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <aside><strong>Verdict</strong>{verdict}</aside>
      </header>
      {children}
    </main>
  )
}

function EyeTile({ expression, style }: { readonly expression: number; readonly style: EyeStyle }) {
  const background = style === "editorial" ? "var(--crit-color-orange-c1)" : style === "geometric" ? "var(--crit-color-blue-t2)" : COLORS[expression % COLORS.length]!
  const ink = style === "geometric" ? "var(--crit-color-blue-c1)" : "#171716"
  const left = 7
  const right = 15
  const gaze = expression % 3 - 1
  const closed = expression % 7 === 1
  const wink = expression % 7 === 4
  const sleepy = expression % 7 === 2
  const surprised = expression % 7 === 3
  const width = surprised ? 4.5 : 5.25
  const height = surprised ? 6.5 : sleepy ? 4.25 : 5.5
  const pupil = surprised ? 1.2 : 1.55
  const openEye = (x: number, closedEye: boolean, key: string) => closedEye
    ? <path d={`M${x - 2.5} 11.5Q${x} 8.5 ${x + 2.5} 11.5`} fill="none" key={key} stroke={ink} strokeLinecap="round" strokeWidth="1.5" />
    : style === "editorial"
      ? <g key={key}><path d={`M${x - width / 2} 10.8Q${x} ${10.8 - height / 2} ${x + width / 2} 10.8Q${x} ${10.8 + height / 2} ${x - width / 2} 10.8Z`} fill="none" stroke={ink} strokeWidth="1.1" /><circle cx={x + gaze * .6} cy="10.8" fill={ink} r={pupil} /></g>
      : <g key={key}><rect fill="#fff" height={height} rx={style === "geometric" ? 1 : height / 2} width={width} x={x - width / 2} y={10.8 - height / 2} /><circle cx={x + gaze * .6} cy="10.8" fill={ink} r={pupil} />{sleepy ? <rect fill={background} height="2" width={width + 1} x={x - width / 2 - .5} y={10.8 - height / 2} /> : null}</g>
  return (
    <span className="prototype-archive-avatar">
      <svg aria-hidden="true" viewBox="0 0 22 22">
        <rect fill={background} height="22" width="22" />
        {openEye(left, closed || wink, "left")}
        {openEye(right, closed, "right")}
      </svg>
    </span>
  )
}

const pixelActive = (recipe: number, x: number, y: number) => {
  const dx = Math.abs(x - 5)
  const dy = Math.abs(y - 5)
  if (recipe % 8 === 0) return (x + y + recipe) % 2 === 0
  if (recipe % 8 === 1) return (dx + dy + recipe) % 3 !== 1
  if (recipe % 8 === 2) return dx % 3 === 0 || dy % 3 === 0
  if (recipe % 8 === 3) return (Math.max(dx, dy) + recipe) % 2 === 0
  if (recipe % 8 === 4) return (Math.min(dx, dy) + Math.max(dx, dy) * 2 + recipe) % 4 <= 1
  if (recipe % 8 === 5) return dx <= 1 || dy <= 1 || Math.abs(dx - dy) === 2
  if (recipe % 8 === 6) return (dx * dy + dx + dy + recipe) % 5 <= 1
  return Math.max(dx, dy) === 4 || (Math.max(dx, dy) < 4 && (dx === 0 || dy === 0))
}

function PixelTile({ index, mixed = false }: { readonly index: number; readonly mixed?: boolean }) {
  const palette = mixed ? MIXED_PALETTES[index % MIXED_PALETTES.length]! : ["var(--crit-color-purple-c2)", "var(--crit-color-purple-t2)", "var(--crit-color-purple-p1)"] as const
  const inset = index % 2 === 0
  return (
    <span className="prototype-archive-avatar">
      <svg aria-hidden="true" viewBox="0 0 22 22">
        <rect fill={palette[0]} height="22" width="22" />
        {Array.from({ length: 121 }, (_, cell) => {
          const x = cell % 11
          const y = Math.floor(cell / 11)
          if (inset && (x === 0 || x === 10 || y === 0 || y === 10)) return null
          if (!pixelActive(index, x, y)) return null
          const accent = (x * 2 + y + index) % 7 === 0
          return <rect fill={accent ? palette[2] : palette[1]} height="2" key={cell} width="2" x={x * 2} y={y * 2} />
        })}
      </svg>
    </span>
  )
}

function KnotTile({ index, mixed = false }: { readonly index: number; readonly mixed?: boolean }) {
  const palette = mixed ? MIXED_PALETTES[index % MIXED_PALETTES.length]! : ["var(--crit-color-purple-c2)", "var(--crit-color-purple-t2)", "var(--crit-color-purple-p1)"] as const
  return (
    <span className="prototype-archive-avatar">
      <svg aria-hidden="true" viewBox="0 0 22 22">
        <rect fill={palette[0]} height="22" width="22" />
        {Array.from({ length: 16 }, (_, cell) => {
          const size = index % 2 === 0 ? 5.5 : 4.5
          const offset = index % 2 === 0 ? 0 : 2
          const x = offset + (cell % 4) * size
          const y = offset + Math.floor(cell / 4) * size
          const orientation = (cell + Math.floor(cell / 4) + index) % 2
          const path = orientation === 0
            ? `M${x + size / 2} ${y}Q${x} ${y} ${x} ${y + size / 2}M${x + size / 2} ${y + size}Q${x + size} ${y + size} ${x + size} ${y + size / 2}`
            : `M${x + size / 2} ${y}Q${x + size} ${y} ${x + size} ${y + size / 2}M${x} ${y + size / 2}Q${x} ${y + size} ${x + size / 2} ${y + size}`
          return <path d={path} fill="none" key={cell} stroke={cell % 5 === 0 ? palette[2] : palette[1]} strokeWidth="1.5" />
        })}
      </svg>
    </span>
  )
}

function GlyphTile({ index }: { readonly index: number }) {
  const color = COLORS[index % COLORS.length]!
  const paths = [
    "M11 4V18M4 11H18",
    "M5 5H9V9H13V5H17V9H13V13H17V17H13V13H9V17H5V13H9V9H5Z",
    "M3 7H7V3M15 3H19V7M19 15V19H15M7 19H3V15M7 11H15M11 7V15",
    "M4 4H18V18H4ZM7 7H15V15H7ZM9 9H13V13H9Z"
  ]
  return <span className="prototype-archive-avatar"><svg aria-hidden="true" viewBox="0 0 22 22"><rect fill={`color-mix(in oklch, ${color} 16%, white)`} height="22" width="22" /><path d={paths[index % paths.length]} fill="none" stroke={color} strokeLinecap="square" strokeWidth="1.5" /></svg></span>
}

function TileGrid({ children }: { readonly children: ReactNode }) {
  return <div className="prototype-archive-grid">{children}</div>
}

function EyesRandomizedPage() {
  return (
    <ArchiveShell description="This version treated eyes as freely combinable shells, pupils, lids, gaze, tilt, and asymmetry. It tested three workflows: family browsing, parameter mixing, and selection-based evolution." title="Randomized eye systems" verdict="High variety, but the independent parameters produced inconsistent art direction and too many low-quality combinations." version="Eye exploration 01">
      <section className="prototype-archive-section"><h2>Curated expression families</h2><p>Friendly, focused, sleepy, surprised, mischief, and oddity families with eight seeded options each.</p><TileGrid>{Array.from({ length: 30 }, (_, index) => <EyeTile expression={index} key={index} style="random" />)}</TileGrid></section>
      <section className="prototype-archive-notes"><strong>What carried forward</strong><span>Deterministic seeds, actual-size inspection, and explicit quality constraints.</span></section>
    </ArchiveShell>
  )
}

function EyesArtDirectedPage() {
  const directions: ReadonlyArray<{ readonly label: string; readonly style: EyeStyle; readonly note: string }> = [
    { label: "Graphic mascot", note: "Filled white shells and bold pupils; strongest at 22px.", style: "mascot" },
    { label: "Editorial character", note: "Outlined forms and expressive linework; authored but less robust.", style: "editorial" },
    { label: "Geometric identity", note: "Capsule-and-square construction with a strict modular language.", style: "geometric" }
  ]
  return (
    <ArchiveShell description="This version replaced arbitrary part mixing with twelve approved expressions and tightly bounded seed variation." title="Art-directed eye systems" verdict="Much more coherent than the first eye generator, but the team chose to explore abstract pattern identities instead of faces." version="Eye exploration 02">
      <div className="prototype-archive-columns">{directions.map((direction) => <section className="prototype-archive-section" key={direction.label}><h2>{direction.label}</h2><p>{direction.note}</p><TileGrid>{Array.from({ length: 12 }, (_, index) => <EyeTile expression={index} key={index} style={direction.style} />)}</TileGrid></section>)}</div>
    </ArchiveShell>
  )
}

function PatternDirectionsPage() {
  const directions: ReadonlyArray<{ readonly label: string; readonly note: string; readonly style: PatternStyle }> = [
    { label: "Glyph circuits", note: "D4-symmetric orthogonal graphs with highlighted junctions.", style: "glyph" },
    { label: "Woven tiles", note: "11×11 binary textile formulas rendered as crisp 2px cells.", style: "woven" },
    { label: "Knot emblems", note: "Four-by-four Truchet paths with continuous edge handoffs.", style: "knot" }
  ]
  return (
    <ArchiveShell description="The first abstract pattern prototype compared three fundamentally different generation systems." title="Three pattern directions" verdict="Woven tiles and knot emblems were strongest. Woven tiles won because they supported the greatest range while remaining crisp at 22px." version="Pattern exploration 01">
      <div className="prototype-archive-columns">{directions.map((direction) => <section className="prototype-archive-section" key={direction.label}><h2>{direction.label}</h2><p>{direction.note}</p><TileGrid>{Array.from({ length: 16 }, (_, index) => direction.style === "glyph" ? <GlyphTile index={index} key={index} /> : direction.style === "woven" ? <PixelTile index={index} key={index} /> : <KnotTile index={index} key={index} />)}</TileGrid></section>)}</div>
    </ArchiveShell>
  )
}

function PatternColorMixingPage() {
  return (
    <ArchiveShell description="This pass introduced three-hue palettes, light and dark grounds, plus full-bleed and 2px inset edge treatments." title="Mixed-color pattern study" verdict="Mixed colors and explicit edge modes were retained. Knot emblems were removed; the woven system became the sole active direction." version="Pattern exploration 02">
      <div className="prototype-archive-columns prototype-archive-columns--two">
        <section className="prototype-archive-section"><h2>Mixed woven tiles</h2><p>Background, structure, and accent each pull from different non-neutral hue families.</p><TileGrid>{Array.from({ length: 24 }, (_, index) => <PixelTile index={index} key={index} mixed />)}</TileGrid></section>
        <section className="prototype-archive-section"><h2>Mixed knot emblems</h2><p>The same palette experiment applied to full and inset Truchet constructions.</p><TileGrid>{Array.from({ length: 24 }, (_, index) => <KnotTile index={index} key={index} mixed />)}</TileGrid></section>
      </div>
    </ArchiveShell>
  )
}

function ArchiveIndex() {
  return (
    <main className="prototype-archive-page">
      <nav className="prototype-archive-nav"><a href="/ui">← Active UI lab</a></nav>
      <header className="prototype-archive-hero"><span>Reference only</span><h1>Prototype archive</h1><p>Superseded explorations preserved as static visual references. These pages are intentionally disconnected from production behavior.</p></header>
      <div className="prototype-archive-index">{ARCHIVES.map((archive) => <a href={`/ui/prototypes/${archive.id}`} key={archive.id}><span>{archive.version}</span><strong>{archive.label}</strong><p>{archive.description}</p><b>Open reference →</b></a>)}</div>
    </main>
  )
}

export default function PrototypeArchivePage() {
  const slug = window.location.pathname.replace(/\/+$/, "").split("/").pop()
  if (slug === "eyes-randomized") return <EyesRandomizedPage />
  if (slug === "eyes-art-directed") return <EyesArtDirectedPage />
  if (slug === "pattern-directions") return <PatternDirectionsPage />
  if (slug === "pattern-color-mixing") return <PatternColorMixingPage />
  return <ArchiveIndex />
}
