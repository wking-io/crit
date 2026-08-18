export const LAUNCH_CANVAS_ID = "launch"
export const LAUNCH_FOCUS_ITEM_ID = "hero"
export const INSTALL_COMMAND = "npx @riff-refine/crit init"
export const LAUNCH_OWNER = {
  id: "crit:www",
  name: "Crit"
} as const

export const LAUNCH_HERO = {
  id: "hero",
  url: "/hero",
  title: "Crit",
  status: "approved",
  geometry: { x: 0, y: 0, width: 880, height: 560 }
} as const

export const LAUNCH_FEATURES = {
  id: "features",
  url: "/features",
  title: "Features",
  status: "ready-for-review",
  geometry: { x: -460, y: 40, width: 420, height: 520 }
} as const

export const LAUNCH_SIGNUP = {
  id: "signup",
  url: "/signup",
  title: "Email updates",
  status: "in-progress",
  geometry: { x: 940, y: 80, width: 400, height: 440 }
} as const

export const LAUNCH_NOTE = {
  id: "designer-note",
  text: "I didn't become a designer to review pull requests. Leave the note on the actual screen — the agent can keep moving after Figma is closed.",
  x: 40,
  y: 600,
  width: 340,
  height: 180,
  color: "orange"
} as const
