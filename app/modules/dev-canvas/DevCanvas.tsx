import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialRoot, useDialKit } from 'dialkit'
import { Tldraw, createShapeId } from 'tldraw'
import type { Editor, TLComponents } from 'tldraw'
import 'dialkit/styles.css'
import 'tldraw/tldraw.css'
import './dev-canvas.css'
import {
	DEFAULT_STATUS_ANIMATION,
	BrowserShapeActionsProvider,
	BrowserShapeUtil,
	organizeBrowserShapes,
} from './BrowserShape'
import type { BrowserShape } from './BrowserShape'
import type {
	CanvasCommand,
	CanvasItemStatus,
	CanvasSnapshot,
	PortlessSource,
} from './model'
import { createLocalCanvasRepository } from './repository.client'

const browserShapeUtils = [BrowserShapeUtil]

const tldrawComponents: TLComponents = {
	MainMenu: null,
	PageMenu: null,
	ActionsMenu: null,
	QuickActions: null,
	HelpMenu: null,
	DebugMenu: null,
	DebugPanel: null,
	Minimap: null,
	StylePanel: null,
}

export function DevCanvas({ canvasId }: { canvasId: string }) {
	const repository = useMemo(() => createLocalCanvasRepository(), [])
	const statusAnimationDials = useDialKit(
		'Frame status motion',
		{
			spring: DEFAULT_STATUS_ANIMATION.spring,
			stagger: [DEFAULT_STATUS_ANIMATION.stagger, 0, 0.2, 0.005],
			curve: [DEFAULT_STATUS_ANIMATION.curve, -120, 120, 1],
			curveExponent: [DEFAULT_STATUS_ANIMATION.curveExponent, 0.5, 3, 0.05],
			curveDelay: [DEFAULT_STATUS_ANIMATION.curveDelay, 0, 0.3, 0.005],
			originX: [DEFAULT_STATUS_ANIMATION.originX, -40, 40, 1],
			originOffset: [DEFAULT_STATUS_ANIMATION.originOffset, 0, 60, 1],
			pillScale: [DEFAULT_STATUS_ANIMATION.pillScale, 0.5, 1, 0.01],
			pillGap: [DEFAULT_STATUS_ANIMATION.pillGap, 0, 24, 1],
			frameGap: [DEFAULT_STATUS_ANIMATION.frameGap, 0, 32, 1],
		},
		{
			id: 'dev-canvas-frame-status-motion',
			persist: true,
		},
	)
	const statusAnimation = {
		...statusAnimationDials,
		spring:
			statusAnimationDials.spring as typeof DEFAULT_STATUS_ANIMATION.spring,
	}
	const editorRef = useRef<Editor | null>(null)
	const hasFramedInitialContent = useRef(false)
	const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [url, setUrl] = useState('')
	const [error, setError] = useState('')

	const refresh = useCallback(async () => {
		try {
			const next = await repository.read(canvasId)
			setSnapshot(next)
			setError('')
		} catch (refreshError) {
			setError(
				refreshError instanceof Error
					? refreshError.message
					: 'Could not refresh the canvas.',
			)
		}
	}, [canvasId, repository])

	useEffect(() => {
		void refresh()
		const interval = window.setInterval(() => void refresh(), 2_500)
		return () => window.clearInterval(interval)
	}, [refresh])

	useEffect(() => {
		if (!snapshot || !editorRef.current) return
		syncCanvasShapes(editorRef.current, snapshot)
		if (!hasFramedInitialContent.current && snapshot.canvas.items.length > 0) {
			hasFramedInitialContent.current = true
			window.setTimeout(() => {
				editorRef.current?.zoomToFit({ animation: { duration: 240 } })
			}, 80)
		}
	}, [snapshot])

	const dispatch = useCallback(
		async (command: CanvasCommand) => {
			try {
				const next = await repository.dispatch(canvasId, command)
				setSnapshot(next)
				setError('')
				return next
			} catch (dispatchError) {
				setError(
					dispatchError instanceof Error
						? dispatchError.message
						: 'Could not update the canvas.',
				)
			}
		},
		[canvasId, repository],
	)

	const addUrl = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!url.trim()) return
		const next = await dispatch({
			type: 'add',
			items: [{ url, source: 'manual' }],
		})
		if (next) setUrl('')
	}

	const addSource = async (source: PortlessSource) => {
		await dispatch({
			type: 'add',
			items: [{ url: source.url, title: source.title, source: 'portless' }],
		})
	}

	const removeItem = useCallback(
		(itemId: string) => {
			void dispatch({ type: 'remove', itemId })
		},
		[dispatch],
	)

	const setItemStatus = useCallback(
		(itemId: string, status: CanvasItemStatus) => {
			void dispatch({ type: 'set-status', itemId, status })
		},
		[dispatch],
	)

	const organizeFrames = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		organizeBrowserShapes(editor)
	}, [])

	const availableSources =
		snapshot?.sources.filter(
			(source) =>
				!snapshot.canvas.items.some((item) => item.url === source.url),
		) ?? []

	return (
		<BrowserShapeActionsProvider
			value={{
				remove: removeItem,
				setStatus: setItemStatus,
				statusAnimation,
			}}
		>
			<main className="dev-canvas-shell">
				<header className="dev-canvas-bar">
					<div className="dev-canvas-brand">
						<div className="dev-canvas-mark" aria-hidden="true">
							<span />
							<span />
						</div>
						<div>
							<strong>{snapshot?.canvas.title ?? 'Developer canvas'}</strong>
							<span>
								{snapshot?.canvas.items.length ?? 0} iteration
								{snapshot?.canvas.items.length === 1 ? '' : 's'}
								{' · '}
								{snapshot?.mode === 'browser'
									? 'browser local'
									: 'agent connected'}
							</span>
						</div>
					</div>

					<form
						className="dev-canvas-add"
						onSubmit={(event) => void addUrl(event)}
					>
						<label className="sr-only" htmlFor="dev-canvas-url">
							URL to add
						</label>
						<input
							id="dev-canvas-url"
							type="text"
							inputMode="url"
							autoComplete="off"
							placeholder="Paste a URL or app.localhost"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
						/>
						<button type="submit">Add frame</button>
					</form>

					<div className="dev-canvas-toolbar-actions">
						<button
							type="button"
							className="dev-canvas-organize-button"
							onClick={organizeFrames}
							disabled={!snapshot?.canvas.items.length}
							title="Organize selected frames, or all frames when none are selected"
						>
							<span aria-hidden="true">▦</span>
							Organize
						</button>
						<button
							type="button"
							className="dev-canvas-routes-button"
							onClick={() => setDrawerOpen((open) => !open)}
							aria-expanded={drawerOpen}
						>
							<span className="dev-canvas-live-dot" />
							Portless
							<small>{snapshot?.sources.length ?? 0}</small>
						</button>
					</div>
				</header>

				{error ? <div className="dev-canvas-error">{error}</div> : null}

				<section className="dev-canvas-stage" aria-label="Iteration canvas">
					<Tldraw
						shapeUtils={browserShapeUtils}
						components={tldrawComponents}
						persistenceKey={`dev-canvas:${canvasId}`}
						onMount={(editor) => {
							editorRef.current = editor
							editor.user.updateUserPreferences({ colorScheme: 'light' })
							if (snapshot) syncCanvasShapes(editor, snapshot)
						}}
					/>
					{snapshot?.canvas.items.length === 0 ? (
						<div className="dev-canvas-empty">
							<span>01</span>
							<h1>Put every iteration in view.</h1>
							<p>
								Add a URL above, choose a running Portless app, or ask an agent
								to assemble this canvas.
							</p>
							<button type="button" onClick={() => setDrawerOpen(true)}>
								Browse running apps
							</button>
						</div>
					) : null}
				</section>

				<aside
					className="dev-canvas-drawer"
					data-open={drawerOpen}
					aria-hidden={!drawerOpen}
				>
					<div className="dev-canvas-drawer__header">
						<div>
							<span>Live discovery</span>
							<h2>Portless routes</h2>
						</div>
						<button
							type="button"
							onClick={() => setDrawerOpen(false)}
							aria-label="Close Portless routes"
						>
							×
						</button>
					</div>
					<p className="dev-canvas-drawer__intro">
						Running worktrees appear automatically. Add any route without
						looking up its port.
					</p>
					<div className="dev-canvas-sources">
						{availableSources.map((source) => (
							<button
								type="button"
								key={source.id}
								onClick={() => void addSource(source)}
							>
								<span className="dev-canvas-source-icon">
									{source.title.slice(0, 2).toUpperCase()}
								</span>
								<span>
									<strong>{source.title}</strong>
									<small>localhost:{source.port}</small>
								</span>
								<b>+</b>
							</button>
						))}
						{snapshot && availableSources.length === 0 ? (
							<div className="dev-canvas-no-sources">
								<span>—</span>
								<p>
									{snapshot.sources.length === 0
										? 'No Portless apps are running.'
										: 'Every running app is already on this canvas.'}
								</p>
							</div>
						) : null}
					</div>
					<div className="dev-canvas-agent-hint">
						<span>Agent command</span>
						<code>
							npm run canvas -- open {canvasId} --iterations &lt;app&gt;
						</code>
					</div>
				</aside>
				<DialRoot position="bottom-right" theme="light" />
			</main>
		</BrowserShapeActionsProvider>
	)
}

function syncCanvasShapes(editor: Editor, snapshot: CanvasSnapshot) {
	const itemsByShapeId = new Map(
		snapshot.canvas.items.map((item) => [
			createShapeId(`dev-browser-${item.id}`),
			item,
		]),
	)
	const browserShapes = editor
		.getCurrentPageShapes()
		.filter((shape): shape is BrowserShape => shape.type === 'dev-browser')

	for (const shape of browserShapes) {
		const item = itemsByShapeId.get(shape.id)
		if (!item) {
			editor.deleteShape(shape.id)
			continue
		}
		if (
			shape.props.url !== item.url ||
			shape.props.title !== item.title ||
			shape.props.source !== item.source ||
			shape.props.status !== item.status
		) {
			editor.updateShape<BrowserShape>({
				id: shape.id,
				type: 'dev-browser',
				props: {
					url: item.url,
					title: item.title,
					source: item.source,
					itemId: item.id,
					status: item.status,
				},
			})
		}
		itemsByShapeId.delete(shape.id)
	}

	let index = browserShapes.length
	for (const [shapeId, item] of itemsByShapeId) {
		const column = index % 2
		const row = Math.floor(index / 2)
		editor.createShape<BrowserShape>({
			id: shapeId,
			type: 'dev-browser',
			x: 120 + column * 960,
			y: 120 + row * 660,
			props: {
				w: 880,
				h: 580,
				itemId: item.id,
				url: item.url,
				title: item.title,
				source: item.source,
				status: item.status,
			},
		})
		index += 1
	}
}
