export const FRAME_SIZE_PRESETS = [
  { id: "mobile", label: "Mobile", width: 402, height: 874 },
  { id: "tablet", label: "Tablet", width: 832, height: 1194 },
  { id: "laptop", label: "Laptop", width: 1280, height: 832 },
  { id: "desktop", label: "Desktop", width: 1512, height: 982 },
  { id: "widescreen", label: "Widescreen", width: 2560, height: 1440 }
] as const

export type FrameSizePreset = (typeof FRAME_SIZE_PRESETS)[number]

export const DEFAULT_NEW_FRAME_SIZE = FRAME_SIZE_PRESETS[2]
export const DUPLICATE_FRAME_GAP = 40

export const presetSizeDetail = (preset: FrameSizePreset): string =>
  `${preset.width} × ${preset.height}`
