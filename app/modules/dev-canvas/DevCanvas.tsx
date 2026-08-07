import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, createShapeId } from 'tldraw'
import type { Editor, TLComponents, TLUiOverrides } from 'tldraw'
import 'tldraw/tldraw.css'
import './dev-canvas.css'
import {
	BROWSER_FRAME_TOOL_ID,
	BrowserShapeActionsProvider,
	BrowserFrameTool,
	BrowserShapeUtil,
} from './BrowserShape'
import type { BrowserShape } from './BrowserShape'
import { CanvasToolbar } from './CanvasToolbar'
import type {
	CanvasCommand,
	CanvasItemStatus,
	CanvasSnapshot,
	PortlessSource,
} from './model'
import { createItemId, normalizeUrl } from './model'
import { createLocalCanvasRepository } from './repository.client'

const browserShapeUtils = [BrowserShapeUtil]
const canvasTools = [BrowserFrameTool]

const tldrawUiOverrides: TLUiOverrides = {
	tools(_editor, tools) {
		delete tools.hand
		tools[BROWSER_FRAME_TOOL_ID] = {
			id: BROWSER_FRAME_TOOL_ID,
			icon: 'tool-frame',
			label: 'Add frame',
			onSelect: () => _editor.setCurrentTool(BROWSER_FRAME_TOOL_ID),
		}
		return tools
	},
}

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
	Toolbar: null,
}

export function DevCanvas({ canvasId }: { canvasId: string }) {
	const repository = useMemo(() => createLocalCanvasRepository(), [])
	const editorRef = useRef<Editor | null>(null)
	const hasFramedInitialContent = useRef(false)
	const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
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

	const setItemTitle = useCallback(
		(itemId: string, title: string) => {
			void dispatch({ type: 'set-item-title', itemId, title })
		},
		[dispatch],
	)

	const snapshotItem = useCallback(
		async (itemId: string) => {
			try {
				const next = await repository.snapshot(canvasId, itemId)
				setSnapshot(next)
				setError('')
				return true
			} catch (snapshotError) {
				setError(
					snapshotError instanceof Error
						? snapshotError.message
						: 'Could not snapshot this frame.',
				)
				return false
			}
		},
		[canvasId, repository],
	)

	const commitDraft = useCallback(
		async (shape: BrowserShape, value: string) => {
			try {
				const url = normalizeUrl(value)
				const title = (await repository.getUrlTitle(url)) ?? 'Untitled'
				const next = await dispatch({
					type: 'add',
					items: [
						{
							url,
							title,
							source: 'manual',
							status: shape.props.status,
						},
					],
				})
				if (!next) return false
				const itemId = createItemId(url)
				const item = next.canvas.items.find(
					(candidate) => candidate.id === itemId,
				)
				const editor = editorRef.current
				if (!editor || !item) return false
				const persistedShapeId = createShapeId(`dev-browser-${item.id}`)
				const existing = editor.getShape<BrowserShape>(persistedShapeId)
				editor.run(() => {
					if (existing) {
						editor.updateShape<BrowserShape>({
							id: persistedShapeId,
							type: 'dev-browser',
							x: shape.x,
							y: shape.y,
							rotation: shape.rotation,
							props: {
								w: shape.props.w,
								h: shape.props.h,
								itemId: item.id,
								url: item.url,
								title: item.title,
								source: item.source,
								status: item.status,
							},
						})
					} else {
						editor.createShape<BrowserShape>({
							id: persistedShapeId,
							type: 'dev-browser',
							x: shape.x,
							y: shape.y,
							rotation: shape.rotation,
							props: {
								w: shape.props.w,
								h: shape.props.h,
								itemId: item.id,
								url: item.url,
								title: item.title,
								source: item.source,
								status: item.status,
							},
						})
					}
					editor.deleteShape(shape.id)
					editor.select(persistedShapeId)
				})
				return true
			} catch (draftError) {
				setError(
					draftError instanceof Error
						? draftError.message
						: 'Could not add this URL.',
				)
				return false
			}
		},
		[dispatch, repository],
	)

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
				setTitle: setItemTitle,
				snapshot: snapshotItem,
				commitDraft,
			}}
		>
			<main className="dev-canvas-shell">
				{error ? <div className="dev-canvas-error">{error}</div> : null}

				<section className="dev-canvas-stage" aria-label="Iteration canvas">
					<Tldraw
						shapeUtils={browserShapeUtils}
						tools={canvasTools}
						components={tldrawComponents}
						overrides={tldrawUiOverrides}
						persistenceKey={`dev-canvas:${canvasId}`}
						onMount={(editor) => {
							editorRef.current = editor
							editor.user.updateUserPreferences({ colorScheme: 'light' })
							if (snapshot) syncCanvasShapes(editor, snapshot)
						}}
					>
						{snapshot ? (
							<CanvasToolbar canvas={snapshot.canvas} repository={repository} />
						) : null}
					</Tldraw>
					{snapshot?.canvas.items.length === 0 ? (
						<div className="dev-canvas-empty">
							<span>01</span>
							<h1>Put every iteration in view.</h1>
							<p>
								Use Add frame in the toolbar, choose a running Portless app, or
								ask an agent to assemble this canvas.
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
		if (!shape.props.itemId) continue
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
