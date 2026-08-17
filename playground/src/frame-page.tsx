import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type PropsWithChildren
} from "react"

import { cssVariableStyle } from "../../src/react/css-variable-style.js"

export type FrameVariant = "A" | "B" | "C"

export const frameRouteUrl = () =>
  document.querySelector<HTMLMetaElement>('meta[name="crit-frame-url"]')?.content ??
  window.location.href

export const frameVariantFromUrl = (url: string): FrameVariant | undefined => {
  const parsed = new URL(url, "http://crit.local")
  if (parsed.pathname.replace(/\/+$/, "") !== "/synth") return undefined
  const variant = parsed.searchParams.get("variant")?.toUpperCase()
  return variant === "A" || variant === "B" || variant === "C"
    ? variant
    : undefined
}

type Wave = "sine" | "triangle" | "sawtooth" | "square"
type EffectName = "tremolo" | "vibrato" | "chorus" | "delay" | "reverb"
type ActiveVoice = {
  readonly gain: GainNode
  readonly oscillators: ReadonlyArray<OscillatorNode>
}

const NOTE_KEYS = ["q", "w", "e", "r", "a", "s", "d"] as const
const CHORD_KEYS = ["u", "i", "o", "p", "j", "k", "l"] as const
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
type NoteName = typeof NOTE_NAMES[number]
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

declare global {
  interface Window {
    readonly webkitAudioContext?: typeof AudioContext
  }
}

const isNoteName = (value: string): value is NoteName =>
  NOTE_NAMES.some((name) => name === value)
const isMode = (value: string): value is "major" | "minor" =>
  value === "major" || value === "minor"
const isWave = (value: string): value is Wave =>
  value === "sine" || value === "triangle" ||
  value === "sawtooth" || value === "square"

const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const midiName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
const uniqueNotes = (gates: ReadonlyMap<string, ReadonlyArray<number>>) =>
  [...new Set([...gates.values()].flat())].sort((a, b) => a - b)

interface SynthParameters {
  readonly noteCutoff: number
  readonly noteResonance: number
  readonly chordCutoff: number
  readonly chordResonance: number
  readonly detune: number
  readonly release: number
  readonly noteOctave: number
  readonly chordOctave: number
}

const DEFAULT_PARAMETERS: SynthParameters = {
  noteCutoff: 6000,
  noteResonance: 0.5,
  chordCutoff: 4000,
  chordResonance: 0.7,
  detune: 8,
  release: 0.28,
  noteOctave: 4,
  chordOctave: 3
}

const usePlayableSynth = ({
  wave,
  voices,
  parameters
}: {
  readonly wave: Wave
  readonly voices: number
  readonly parameters: SynthParameters
}) => {
  const audioRef = useRef<AudioContext | null>(null)
  const activeRef = useRef(new Map<string, ReadonlyArray<ActiveVoice>>())
  const gatesRef = useRef(new Map<string, ReadonlyArray<number>>())
  const [powered, setPowered] = useState(false)
  const [activeNotes, setActiveNotes] = useState<ReadonlyArray<number>>([])

  const ensureAudio = useCallback(async () => {
    const AudioContextConstructor = window.AudioContext ??
      window.webkitAudioContext
    if (AudioContextConstructor === undefined) return null
    const context = audioRef.current ?? new AudioContextConstructor({ latencyHint: "interactive" })
    audioRef.current = context
    if (context.state === "suspended") await context.resume()
    setPowered(true)
    return context
  }, [])

  const stopGate = useCallback((id: string) => {
    const active = activeRef.current.get(id)
    if (active === undefined) return
    const now = audioRef.current?.currentTime ?? 0
    for (const voice of active) {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + parameters.release)
      for (const oscillator of voice.oscillators) oscillator.stop(now + parameters.release + 0.03)
    }
    activeRef.current.delete(id)
    gatesRef.current.delete(id)
    setActiveNotes(uniqueNotes(gatesRef.current))
  }, [parameters.release])

  const startGate = useCallback(async (
    id: string,
    midiNotes: ReadonlyArray<number>,
    kind: "notes" | "chords"
  ) => {
    if (activeRef.current.has(id)) return
    const context = await ensureAudio()
    if (context === null) return
    const cutoff = kind === "notes" ? parameters.noteCutoff : parameters.chordCutoff
    const resonance = kind === "notes" ? parameters.noteResonance : parameters.chordResonance
    const created = midiNotes.map((midi) => {
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      filter.type = "lowpass"
      filter.frequency.value = cutoff
      filter.Q.value = resonance
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.025, 0.3 / (midiNotes.length * voices)),
        context.currentTime + 0.012
      )
      filter.connect(gain).connect(context.destination)
      const oscillators = Array.from({ length: voices }, (_, index) => {
        const oscillator = context.createOscillator()
        oscillator.type = wave
        oscillator.frequency.value = midiFrequency(midi)
        oscillator.detune.value = voices === 1
          ? 0
          : ((index / (voices - 1)) * 2 - 1) * parameters.detune
        oscillator.connect(filter)
        oscillator.start()
        return oscillator
      })
      return { gain, oscillators }
    })
    activeRef.current.set(id, created)
    gatesRef.current.set(id, midiNotes)
    setActiveNotes(uniqueNotes(gatesRef.current))
  }, [ensureAudio, parameters, voices, wave])

  useEffect(() => () => {
    const now = audioRef.current?.currentTime ?? 0
    for (const active of activeRef.current.values()) {
      for (const voice of active) {
        for (const oscillator of voice.oscillators) oscillator.stop(now)
      }
    }
    void audioRef.current?.close()
  }, [])

  return { activeNotes, ensureAudio, powered, startGate, stopGate }
}

export function FramePage({ variant }: { readonly variant: FrameVariant }) {
  const [root, setRoot] = useState<NoteName>("C")
  const [mode, setMode] = useState<"major" | "minor">("major")
  const [wave, setWave] = useState<Wave>("triangle")
  const [voices, setVoices] = useState(3)
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS)
  const [effects, setEffects] = useState<Record<EffectName, boolean>>({
    tremolo: false,
    vibrato: false,
    chorus: false,
    delay: false,
    reverb: false
  })
  const synth = usePlayableSynth({ wave, voices, parameters })
  const intervals = mode === "major" ? MAJOR : MINOR
  const rootIndex = NOTE_NAMES.findIndex((name) => name === root)
  const noteScale = intervals.map((interval) => 12 * (parameters.noteOctave + 1) + rootIndex + interval)
  const chordScale = intervals.map((interval) => 12 * (parameters.chordOctave + 1) + rootIndex + interval)

  useEffect(() => {
    const releaseKeys = new Map<string, { id: string; midi: ReadonlyArray<number> }>()
    const keyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      const key = event.key.toLowerCase()
      const noteIndex = NOTE_KEYS.findIndex((noteKey) => noteKey === key)
      const chordIndex = CHORD_KEYS.findIndex((chordKey) => chordKey === key)
      if (noteIndex < 0 && chordIndex < 0) return
      event.preventDefault()
      const kind = noteIndex >= 0 ? "notes" : "chords"
      const index = noteIndex >= 0 ? noteIndex : chordIndex
      const midi = kind === "notes"
        ? [noteScale[index]!]
        : [chordScale[index]!, chordScale[index]! + 4, chordScale[index]! + 7]
      const id = `keyboard:${key}`
      releaseKeys.set(key, { id, midi })
      void synth.startGate(id, midi, kind)
    }
    const keyUp = (event: KeyboardEvent) => {
      const current = releaseKeys.get(event.key.toLowerCase())
      if (current === undefined) return
      synth.stopGate(current.id)
      releaseKeys.delete(event.key.toLowerCase())
    }
    window.addEventListener("keydown", keyDown)
    window.addEventListener("keyup", keyUp)
    return () => {
      window.removeEventListener("keydown", keyDown)
      window.removeEventListener("keyup", keyUp)
      for (const current of releaseKeys.values()) synth.stopGate(current.id)
    }
  }, [chordScale, noteScale, synth.startGate, synth.stopGate])

  const view: SynthView = {
    activeNotes: synth.activeNotes,
    chordScale,
    effects,
    mode,
    noteScale,
    parameters,
    root,
    voices,
    wave,
    onEffectChange: (name, enabled) => setEffects((current) => ({ ...current, [name]: enabled })),
    onParameterChange: (name, value) => setParameters((current) => ({ ...current, [name]: value })),
    setMode,
    setRoot,
    setVoices,
    setWave,
    startGate: synth.startGate,
    stopGate: synth.stopGate
  }

  return <main className={`synth-prototype synth-prototype--${variant.toLowerCase()}`}>
    {variant === "A" ? <VariantWorkbench view={view} /> : null}
    {variant === "B" ? <VariantPerformance view={view} /> : null}
    {variant === "C" ? <VariantRack view={view} /> : null}
    <button className="synth-preview-audio" onClick={() => void synth.ensureAudio()} type="button">
      <span>Preview mode</span><strong>{synth.powered ? "Audio ready" : "Enable audio"}</strong>
    </button>
  </main>
}

interface SynthView {
  readonly activeNotes: ReadonlyArray<number>
  readonly chordScale: ReadonlyArray<number>
  readonly effects: Readonly<Record<EffectName, boolean>>
  readonly mode: "major" | "minor"
  readonly noteScale: ReadonlyArray<number>
  readonly parameters: SynthParameters
  readonly root: string
  readonly voices: number
  readonly wave: Wave
  readonly onEffectChange: (name: EffectName, enabled: boolean) => void
  readonly onParameterChange: (name: keyof SynthParameters, value: number) => void
  readonly setMode: (mode: "major" | "minor") => void
  readonly setRoot: (root: NoteName) => void
  readonly setVoices: (voices: number) => void
  readonly setWave: (wave: Wave) => void
  readonly startGate: (id: string, notes: ReadonlyArray<number>, kind: "notes" | "chords") => Promise<void>
  readonly stopGate: (id: string) => void
}

const VariantWorkbench = ({ view }: { readonly view: SynthView }) => <div className="synth-workbench">
  <InstrumentHeader kicker="Astra · Model 01" title="Polyphonic workbench" view={view} />
  <div className="synth-workbench__upper">
    <section className="synth-module synth-module--tone"><ModuleHeading index="01" title="Tone shaping" /><ParameterBank kind="knobs" view={view} /></section>
    <section className="synth-module synth-module--macros"><ModuleHeading index="02" title="Expression" /><MacroBank /></section>
    <section className="synth-module synth-module--effects"><ModuleHeading index="03" title="Effects bus" /><EffectsBank view={view} /></section>
  </div>
  <div className="synth-workbench__keyboard">
    <section><ModuleHeading index="04" title="Single notes · Q W E R A S D" /><KeyBank kind="notes" view={view} /></section>
    <section><ModuleHeading index="05" title="Triad chords · U I O P J K L" /><KeyBank kind="chords" view={view} /></section>
  </div>
</div>

const VariantPerformance = ({ view }: { readonly view: SynthView }) => <div className="synth-performance">
  <header className="synth-performance__header"><div><span>Performance instrument</span><h1>ASTRA</h1></div><NowPlaying notes={view.activeNotes} /><VoiceSetup compact view={view} /></header>
  <div className="synth-performance__body">
    <section className="synth-performance__pads">
      <div className="synth-performance__bank-label"><span>Left hand</span><strong>Chords</strong></div><KeyBank kind="chords" view={view} />
      <div className="synth-performance__bank-label"><span>Right hand</span><strong>Lead</strong></div><KeyBank kind="notes" view={view} />
    </section>
    <aside className="synth-performance__expression"><MacroBank /><EffectsBank view={view} /></aside>
  </div>
  <footer className="synth-performance__strip"><ParameterBank kind="sliders" view={view} /></footer>
</div>

const VariantRack = ({ view }: { readonly view: SynthView }) => <div className="synth-rack">
  <header className="synth-rack__header"><div><span>WK–01</span><strong>Astra signal rack</strong></div><NowPlaying notes={view.activeNotes} /></header>
  <div className="synth-rack__columns">
    <section className="synth-rack__channel synth-rack__channel--source"><ModuleHeading index="A" title="Source" /><VoiceSetup view={view} /><div aria-hidden="true" className="synth-rack__scope">{Array.from({ length: 22 }, (_, index) => <span key={index} style={{ height: `${18 + ((index * 23) % 58)}%` }} />)}</div><EffectsBank view={view} /></section>
    <section className="synth-rack__channel synth-rack__channel--filter"><ModuleHeading index="B" title="Filter / envelope" /><ParameterBank kind="faders" view={view} /></section>
    <section className="synth-rack__channel synth-rack__channel--play"><ModuleHeading index="C" title="Performance matrix" /><KeyBank kind="notes" view={view} /><KeyBank kind="chords" view={view} /><MacroBank /></section>
  </div>
</div>

const InstrumentHeader = ({ kicker, title, view }: { readonly kicker: string; readonly title: string; readonly view: SynthView }) => <header className="synth-instrument-header"><div><span>{kicker}</span><h1>{title}</h1></div><VoiceSetup view={view} /><NowPlaying notes={view.activeNotes} /></header>
const ModuleHeading = ({ index, title }: { readonly index: string; readonly title: string }) => <div className="synth-module-heading"><span>{index}</span><h2>{title}</h2></div>

const VoiceSetup = ({ view, compact = false }: { readonly view: SynthView; readonly compact?: boolean }) => <div className="synth-voice-setup" data-compact={compact}>
  <label><span>Root</span><select aria-label="Root" onChange={(event) => { if (isNoteName(event.currentTarget.value)) view.setRoot(event.currentTarget.value) }} value={view.root}>{NOTE_NAMES.map((name) => <option key={name}>{name}</option>)}</select></label>
  <label><span>Mode</span><select aria-label="Mode" onChange={(event) => { if (isMode(event.currentTarget.value)) view.setMode(event.currentTarget.value) }} value={view.mode}><option value="major">Major</option><option value="minor">Minor</option></select></label>
  <label><span>Wave</span><select aria-label="Wave" onChange={(event) => { if (isWave(event.currentTarget.value)) view.setWave(event.currentTarget.value) }} value={view.wave}><option value="triangle">Triangle</option><option value="sine">Sine</option><option value="sawtooth">Saw</option><option value="square">Square</option></select></label>
  <label><span>Voices</span><select aria-label="Voices" onChange={(event) => view.setVoices(Number(event.currentTarget.value))} value={view.voices}><option value="1">1</option><option value="3">3</option><option value="5">5</option></select></label>
</div>

const NowPlaying = ({ notes }: { readonly notes: ReadonlyArray<number> }) => <div className="synth-now-playing"><span>Playing</span><output aria-label="Currently playing notes" aria-live="polite">{notes.length === 0 ? "—" : notes.map(midiName).join(" · ")}</output><i data-active={notes.length > 0} /></div>

const KeyBank = ({ kind, view }: { readonly kind: "notes" | "chords"; readonly view: SynthView }) => <div className="synth-key-bank" data-kind={kind}>
  {Array.from({ length: 7 }, (_, index) => {
    const root = (kind === "notes" ? view.noteScale : view.chordScale)[index]!
    const notes = kind === "notes" ? [root] : [root, root + 4, root + 7]
    const keyboardKey = (kind === "notes" ? NOTE_KEYS : CHORD_KEYS)[index]!
    return <SynthKey id={`pointer:${kind}:${index}`} key={`${kind}:${index}`} keyboardKey={keyboardKey} kind={kind} notes={notes} view={view}><span className="synth-key__degree">0{index + 1}</span><strong>{midiName(root)}</strong>{kind === "chords" ? <small>triad</small> : null}</SynthKey>
  })}
</div>

const SynthKey = ({ children, id, keyboardKey, kind, notes, view }: PropsWithChildren<{ readonly id: string; readonly keyboardKey: string; readonly kind: "notes" | "chords"; readonly notes: ReadonlyArray<number>; readonly view: SynthView }>) => {
  const active = notes.some((note) => view.activeNotes.includes(note))
  return <button aria-pressed={active} className="synth-key" onPointerCancel={() => view.stopGate(id)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void view.startGate(id, notes, kind) }} onPointerLeave={() => view.stopGate(id)} onPointerUp={() => view.stopGate(id)} type="button"><div className="key-content">{children}<div className="keyboard-hint">{keyboardKey.toUpperCase()}</div></div></button>
}

const PARAMETER_DEFINITIONS: ReadonlyArray<{ readonly key: keyof SynthParameters; readonly label: string; readonly short: string; readonly min: number; readonly max: number; readonly step: number; readonly format: (value: number) => string }> = [
  { key: "noteCutoff", label: "Note cutoff", short: "N Cut", min: 200, max: 12000, step: 1, format: (value) => `${Math.round(value)} Hz` },
  { key: "noteResonance", label: "Note resonance", short: "N Res", min: 0.1, max: 20, step: 0.1, format: (value) => value.toFixed(1) },
  { key: "chordCutoff", label: "Chord cutoff", short: "C Cut", min: 200, max: 12000, step: 1, format: (value) => `${Math.round(value)} Hz` },
  { key: "chordResonance", label: "Chord resonance", short: "C Res", min: 0.1, max: 20, step: 0.1, format: (value) => value.toFixed(1) },
  { key: "detune", label: "Voice spread", short: "Spread", min: 0, max: 40, step: 1, format: (value) => `${Math.round(value)} ct` },
  { key: "release", label: "Release", short: "Release", min: 0.03, max: 1, step: 0.01, format: (value) => `${value.toFixed(2)} s` },
  { key: "noteOctave", label: "Note octave", short: "N Oct", min: 2, max: 6, step: 1, format: String },
  { key: "chordOctave", label: "Chord octave", short: "C Oct", min: 2, max: 6, step: 1, format: String }
]

const ParameterBank = ({ kind, view }: { readonly kind: "knobs" | "sliders" | "faders"; readonly view: SynthView }) => <div className="synth-parameters" data-kind={kind}>{PARAMETER_DEFINITIONS.map((parameter) => {
  const value = view.parameters[parameter.key]
  const progress = (value - parameter.min) / (parameter.max - parameter.min)
  return <label className="synth-parameter" key={parameter.key}><span className="synth-parameter__label">{kind === "knobs" ? parameter.short : parameter.label}</span><span className="synth-parameter__control" style={cssVariableStyle({ "--parameter-progress": progress })}><i /><input aria-label={parameter.label} max={parameter.max} min={parameter.min} onChange={(event) => view.onParameterChange(parameter.key, Number(event.currentTarget.value))} step={parameter.step} type="range" value={value} /></span><output>{parameter.format(value)}</output></label>
})}</div>

const MacroBank = () => <div className="synth-macro-bank"><Macro label="Macro A" detail="Tremolo × Vibrato" /><Macro label="Macro B" detail="Chorus × Delay" /></div>
const Macro = ({ detail, label }: { readonly detail: string; readonly label: string }) => {
  const [position, setPosition] = useState({ x: 50, y: 50 })
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = event.currentTarget.getBoundingClientRect()
    setPosition({ x: Math.max(12, Math.min(88, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(12, Math.min(88, ((event.clientY - rect.top) / rect.height) * 100)) })
  }
  return <div><span>{label}</span><div className="synth-joystick" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event) }} onPointerMove={move}><div className="stick" style={{ left: `${position.x}%`, top: `${position.y}%` }}><div className="synth-joystick__cap" /></div></div><small>{detail}</small></div>
}

const EffectsBank = ({ view }: { readonly view: SynthView }) => <div className="synth-effects">{([['tremolo', 'Tremolo'], ['vibrato', 'Vibrato'], ['chorus', 'Chorus'], ['delay', 'Delay'], ['reverb', 'Space']] as const).map(([name, label]) => <label key={name}><input checked={view.effects[name]} onChange={(event) => view.onEffectChange(name, event.currentTarget.checked)} type="checkbox" /><span>{label}</span><i /></label>)}</div>
