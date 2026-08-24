export const PROJECT_SKILL_RELATIVE_PATH = ".agents/skills/crit/SKILL.md"

export const projectSkillSource = `---
name: crit
description: Uses Crit to put project pages and captures on a Canvas as Frames, Notes, and comment threads, then hand the work to a person for review. Use when the user asks to add a Frame, lay out a Canvas, capture a page, leave a Note, reply to a review comment, mark ready-for-review, or inspect Crit.
---

# Crit

People review in the Crit browser. Agents write through the CLI.

## Start

\`\`\`
crit init
crit dev
\`\`\`

\`dev\` prints a bootstrap URL. Give that URL to the person. The browser opens \`canvas_local\`.

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
crit add-frame <canvas-id> --type application-route --route /path --title Title --x 0 --y 0
\`\`\`

\`--type\`, \`--title\`, \`--x\`, and \`--y\` are required on add-frame. Width and height default to 1200x800.

## Canvas

A Canvas holds Frames, Notes, and comment threads.

- Frame. A titled box that shows a page, a public URL, or a capture.
- Note. Canvas commentary. May attach to a Frame.
- Comment thread. Review on a Frame, or on an element inside a live Frame.

Reuse IDs. Edit in place. Deleting and recreating a Frame drops its comments and review.

## Representations

- \`application-route\` for a page in this project. Route is rooted (\`/checkout\`). Crit binds it through \`crit.manifest.json\`.
- \`web-url\` for a public HTTP URL. Use a real public hostname.
- \`artifact\` for an immutable capture. Needs \`--artifact-id\` and \`--digest\`.

Project pages are application-route Frames. Localhost is not a web-url.

## Work

1. Read \`layout\` on the Canvas you will change. Default is \`canvas_local\`.
2. Place new Frames in empty space. Do not stack them.
3. Add a Frame as you create each page or prototype.
4. Batch related edits in one change when the client allows it.
5. Notes carry working commentary. Comments carry review.
6. Capture into an artifact Frame when the review should freeze that render.
7. Set \`ready-for-review\` when a person should look. Status values are \`in-progress\`, \`ready-for-review\`, \`changes-requested\`, and \`approved\`. \`approved\` is for after a person assessed it.
8. Reply to comment threads. Ask before removing another actor's review content.
9. Leave camera, selection, and browser chrome to people.

## Live pages

Element comments and input inside an application Frame need the Frame Bridge in the app. Turn it on for local development. Leave ordinary production builds off. Use the official adapter. Production HTML must not contain \`data-crit-frame-input-bridge\` or \`data-crit-frame-comment-bridge\`.

## Shared work

When a shared Crit connection is available, use that MCP. It exposes \`search\` and \`execute\`. Same Canvas rules. Same IDs.

## Done

\`layout\` shows the intended Frames and Notes at the intended geometry. The person has the bootstrap URL if they need to review.
`
