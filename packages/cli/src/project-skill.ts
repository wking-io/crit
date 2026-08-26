export const PROJECT_SKILL_RELATIVE_PATH = ".agents/skills/crit/SKILL.md"

export const projectSkillSource = `---
name: crit
description: Uses Crit to put project pages and captures on a Canvas as Frames, then hand the work to a person for review. Use when the user asks to add a Frame, lay out a Canvas, capture a page, mark ready-for-review, or inspect Crit.
---

# Crit

People review in the Crit browser. Agents write through the CLI.

## Start

\`\`\`
crit init
crit dev
\`\`\`

\`dev\` prints a bootstrap URL. Give that URL to the person. The browser opens \`canvas_local\`.

Before writing as an agent, begin a session so your work is stamped:

\`\`\`
eval "$(crit agent begin --name <agent-name> --harness <harness>)"
\`\`\`

Run it once per task. Without it your changes are attributed to the local person.

If the app is not already reachable at a trailing-slash origin, pass it.

\`\`\`
crit dev --application-origin http://127.0.0.1:5174/
\`\`\`

If Crit is unreachable, ask the user to run \`crit dev\`. Confirm with \`crit status\`.

## Catalog

\`crit --help\` is the live verb list. Read it before a new operation. A missing verb means the CLI cannot do that yet. Say so. Leave \`.crit/\` and SQLite alone.

Known local verbs:

\`\`\`
crit create <canvas-id> --title Title
crit open <canvas-id>
crit layout <canvas-id>
crit add-frame <canvas-id> --type applicationRoute --route /path --title Title --x 0 --y 0
\`\`\`

\`--type\`, \`--title\`, \`--x\`, and \`--y\` are required on add-frame. Width and height default to 1200x800.

## Canvas

A Canvas holds Frames.

- Frame. A titled box that shows a page, a public URL, or a capture.

Reuse IDs. Edit in place. Deleting and recreating a Frame drops its review state.

## Representations

- \`applicationRoute\` for a page in this project. Route is rooted (\`/checkout\`). Crit binds it through \`crit.manifest.json\`.
- \`webUrl\` for a public HTTP URL. Use a real public hostname.
- \`artifact\` for an immutable capture. Needs \`--artifact-id\` and \`--digest\`.

Project pages are applicationRoute Frames. Localhost is not a webUrl.

## Work

1. Read \`layout\` on the Canvas you will change. Default is \`canvas_local\`.
2. Place new Frames in empty space. Do not stack them.
3. Add a Frame as you create each page or prototype.
4. Batch related edits in one change when the client allows it.
5. Capture into an artifact Frame when the review should freeze that render.
6. Set \`ready-for-review\` when a person should look. Status values are \`in-progress\`, \`ready-for-review\`, \`changes-requested\`, and \`approved\`. \`approved\` is for after a person assessed it.
7. Leave camera, selection, and browser chrome to people.

## Live pages

Unselected Frames are not interactive. Crit covers them. The selected Frame is the live page.

The Frame Bridge reports the page route to Crit. Use the \`install-crit-frame-bridge\` skill to install \`@crit/frame-bridge\`. Turn it on for local development. Leave ordinary production builds off. Production HTML must not contain Frame Bridge markers.

## Shared work

After share, people review in the hosted UI. They do not install Crit. Do not review a shared Canvas as an Agent. Crit has no remote MCP.

Preview CI uses the \`crit-register-deployment\` skill.

## Done

\`layout\` shows the intended Frames at the intended geometry. The person has the bootstrap URL if they need to review.
`
