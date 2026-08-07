import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
	ArrowDownToolbarItem,
	ArrowLeftToolbarItem,
	ArrowRightToolbarItem,
	ArrowToolbarItem,
	ArrowUpToolbarItem,
	AssetToolbarItem,
	CheckBoxToolbarItem,
	CloudToolbarItem,
	DiamondToolbarItem,
	DrawToolbarItem,
	EllipseToolbarItem,
	EraserToolbarItem,
	FrameToolbarItem,
	HeartToolbarItem,
	HexagonToolbarItem,
	HighlightToolbarItem,
	LaserToolbarItem,
	LineToolbarItem,
	NoteToolbarItem,
	OvalToolbarItem,
	OverflowingToolbar,
	RectangleToolbarItem,
	RhombusToolbarItem,
	SelectToolbarItem,
	StarToolbarItem,
	TextToolbarItem,
	TldrawUiIcon,
	TriangleToolbarItem,
	XBoxToolbarItem,
	stopEventPropagation,
	useEditor,
	useValue,
} from 'tldraw'
import { BROWSER_FRAME_TOOL_ID } from './BrowserShape'
import { summarizeCanvas } from './model'
import type { CanvasDocument, CanvasRepository, CanvasSummary } from './model'

export function CanvasToolbar({
	canvas,
	repository,
}: {
	canvas: CanvasDocument
	repository: CanvasRepository
}) {
	const editor = useEditor()
	const canUndo = useValue('dev canvas can undo', () => editor.getCanUndo(), [
		editor,
	])
	const canRedo = useValue('dev canvas can redo', () => editor.getCanRedo(), [
		editor,
	])
	const frameToolSelected = useValue(
		'dev canvas frame tool selected',
		() => editor.getCurrentToolId() === BROWSER_FRAME_TOOL_ID,
		[editor],
	)

	return (
		<div
			className="dev-canvas-custom-toolbar"
			onPointerDown={stopEventPropagation}
		>
			<CanvasSwitcher canvas={canvas} repository={repository} />
			<ToolbarDivider />
			<div className="dev-canvas-custom-toolbar__history">
				<ToolbarButton
					label="Undo"
					disabled={!canUndo}
					onClick={() => editor.undo()}
				>
					<TldrawUiIcon icon="undo" label="Undo" small />
				</ToolbarButton>
				<ToolbarButton
					label="Redo"
					disabled={!canRedo}
					onClick={() => editor.redo()}
				>
					<TldrawUiIcon icon="redo" label="Redo" small />
				</ToolbarButton>
				<ToolbarButton
					label="Add browser frame"
					pressed={frameToolSelected}
					onClick={() => editor.setCurrentTool(BROWSER_FRAME_TOOL_ID)}
				>
					<AddFrameIcon />
				</ToolbarButton>
			</div>
			<ToolbarDivider />
			<div className="dev-canvas-custom-toolbar__tools">
				<OverflowingToolbar
					orientation="horizontal"
					sizingParentClassName="dev-canvas-custom-toolbar__tools"
					minItems={2}
					minSizePx={72}
					maxItems={7}
					maxSizePx={264}
				>
					<SelectToolbarItem />
					<EraserToolbarItem />
					<DrawToolbarItem />
					<HighlightToolbarItem />
					<AssetToolbarItem />
					<TextToolbarItem />
					<ArrowToolbarItem />
					<RectangleToolbarItem />
					<EllipseToolbarItem />
					<TriangleToolbarItem />
					<DiamondToolbarItem />
					<HexagonToolbarItem />
					<OvalToolbarItem />
					<RhombusToolbarItem />
					<StarToolbarItem />
					<CloudToolbarItem />
					<HeartToolbarItem />
					<XBoxToolbarItem />
					<CheckBoxToolbarItem />
					<ArrowLeftToolbarItem />
					<ArrowUpToolbarItem />
					<ArrowDownToolbarItem />
					<ArrowRightToolbarItem />
					<LineToolbarItem />
					<LaserToolbarItem />
					<NoteToolbarItem />
					<FrameToolbarItem />
				</OverflowingToolbar>
			</div>
		</div>
	)
}

function CanvasSwitcher({
	canvas,
	repository,
}: {
	canvas: CanvasDocument
	repository: CanvasRepository
}) {
	const rootRef = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false)
	const [canvases, setCanvases] = useState<CanvasSummary[]>([
		summarizeCanvas(canvas),
	])

	useEffect(() => {
		if (!open) return
		let cancelled = false
		void repository
			.list()
			.then((items) => {
				if (cancelled) return
				const byId = new Map(items.map((item) => [item.id, item]))
				byId.set(canvas.id, summarizeCanvas(canvas))
				setCanvases(
					[...byId.values()].sort((a, b) =>
						b.updatedAt.localeCompare(a.updatedAt),
					),
				)
			})
			.catch(() => {
				if (!cancelled) setCanvases([summarizeCanvas(canvas)])
			})
		const closeOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target
			if (target instanceof Node && rootRef.current?.contains(target)) return
			setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer, true)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			cancelled = true
			document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [canvas, open, repository])

	return (
		<div ref={rootRef} className="dev-canvas-switcher">
			<button
				type="button"
				className="dev-canvas-switcher__trigger"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<span>{canvas.title}</span>
				<SwitcherIcon />
			</button>
			{open ? (
				<div className="dev-canvas-switcher__menu" role="menu">
					{canvases.map((item) => (
						<a
							key={item.id}
							href={`/canvas/${item.id}`}
							role="menuitem"
							aria-current={item.id === canvas.id ? 'page' : undefined}
						>
							<span>{item.title}</span>
							<small>
								{item.itemCount} frame{item.itemCount === 1 ? '' : 's'}
							</small>
						</a>
					))}
				</div>
			) : null}
		</div>
	)
}

function ToolbarDivider() {
	return (
		<span className="dev-canvas-custom-toolbar__divider" aria-hidden="true" />
	)
}

function ToolbarButton({
	children,
	disabled,
	label,
	onClick,
	pressed,
}: {
	children: ReactNode
	disabled?: boolean
	label: string
	onClick(): void
	pressed?: boolean
}) {
	return (
		<button
			type="button"
			className="dev-canvas-custom-toolbar__button"
			aria-label={label}
			aria-pressed={pressed}
			disabled={disabled}
			title={label}
			onClick={onClick}
		>
			{children}
		</button>
	)
}

function SwitcherIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M12.5 6.25L9 2.75L5.5 6.25"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M12.5 11.75L9 15.25L5.5 11.75"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function AddFrameIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M1.75 4.75C1.75 3.65 2.645 2.75 3.75 2.75H14.25C15.355 2.75 16.25 3.65 16.25 4.75V7.75H1.75V4.75Z"
				fill="currentColor"
				opacity=".3"
			/>
			<path
				d="M4.25 6C4.664 6 5 5.66 5 5.25C5 4.84 4.664 4.5 4.25 4.5C3.836 4.5 3.5 4.84 3.5 5.25C3.5 5.66 3.836 6 4.25 6Z"
				fill="currentColor"
			/>
			<path
				d="M6.75 6C7.164 6 7.5 5.66 7.5 5.25C7.5 4.84 7.164 4.5 6.75 4.5C6.336 4.5 6 4.84 6 5.25C6 5.66 6.336 6 6.75 6Z"
				fill="currentColor"
			/>
			<path
				d="M1.75 7.75H16.25M14.25 12.25V17.25M16.75 14.75H11.75M16.25 10.014V4.75C16.25 3.65 15.355 2.75 14.25 2.75H3.75C2.645 2.75 1.75 3.65 1.75 4.75V13.25C1.75 14.35 2.645 15.25 3.75 15.25H8.792"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}
