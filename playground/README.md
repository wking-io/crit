# Crit feature lab

From the repository root, run:

```sh
npm run dev:portless
```

Open `https://crit.localhost` for the feature-lab Canvas. Portless
registers the stable hostname and selects the backing port automatically.
Portless requires Node.js 24 or newer. On first use, macOS may request
administrator access to bind standard HTTPS port 443; accept that prompt to use
the hostname without a port.

For a direct Vite server without Portless, use `npm run dev`. It defaults to
`http://127.0.0.1:5173`; set `CRIT_PLAYGROUND_PORT` if that port is unavailable.
The editor is source-backed in development: changes under `src/react` update the
open playground through Vite without a manual package build or server restart.

The playground uses Crit's real Vite plugin, HTTP adapter, filesystem repository,
snapshot archive, manifest discovery, and standalone editor route. Its four Frame
URLs are real pages served by the same Vite process. Canvas state persists under
`playground/.crit`, which is ignored by git.

## Browser checks

- Pan, zoom, and use **Fit**; verify toolbars remain a readable screen size.
- Right-click empty canvas space; create a Frame or Note and use **Zoom to fit**.
- Right-click a Frame; verify delete, fullscreen, new-tab, ordering, and **Fit content** actions.
- Open **Set size to...** and verify all five device presets resize to their displayed dimensions.
- Narrow a Frame; verify its title hides only after fewer than ten characters fit and its action icons remain.
- Use the **Frame chrome** DialKit panel to tune the title and per-icon visibility thresholds live.
- Drag and resize Frames, edit all four statuses, and use their ordering buttons.
- Interact with form controls inside a Frame.
- Edit, move, resize, and reorder Notes.
- Move the attached Note with its Frame, then drag it away to detach it.
- Take a snapshot, change the live page, and verify the archived Frame remains.
- Open the Canvas in two browser windows and verify edits synchronize.
- Pan a Frame offscreen and verify its iframe pauses.

## Agent checks

Keep the Portless dev server running, then use another terminal:

```sh
npm run dev:agent -- open feature-lab --json
npm run dev:agent -- activity feature-lab --id dev-agent --harness Terminal --detail "Testing agent edits" --json
npm run dev:agent -- apply feature-lab '[{"_tag":"SetFrameStatus","id":"checkout-draft","status":"ready-for-review"}]' --json
npm run dev:agent -- snapshot feature-lab checkout-ready --json
npm run dev:agent -- activity feature-lab --id dev-agent --clear --json
```

The browser and CLI operate on the same Canvas Document. `npm run dev:seed`
rebuilds the CLI and adds the feature Canvas if it has not been seeded yet. The
seed replaces its Note Author placeholders with the current Git-derived Author.
