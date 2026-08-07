import {
	applyCanvasCommand,
	createCanvasDocument,
	normalizeCanvasId,
	normalizeItemTitle,
	normalizeItemStatus,
	normalizeUrl,
	summarizeCanvas,
} from './model'
import type {
	CanvasCommand,
	CanvasDocument,
	CanvasRepository,
	CanvasSnapshot,
	CanvasSummary,
} from './model'

const STORAGE_PREFIX = 'dev-canvas:document:'

export function createLocalCanvasRepository(): CanvasRepository {
	return {
		async read(canvasId) {
			try {
				return await request(canvasId)
			} catch {
				return readBrowserSnapshot(canvasId)
			}
		},

		async list() {
			try {
				return await requestCanvasList()
			} catch {
				return listBrowserCanvases()
			}
		},

		async getUrlTitle(url) {
			const normalizedUrl = normalizeUrl(url)
			try {
				const response = await fetch(
					`/__dev-canvas/api/metadata?url=${encodeURIComponent(normalizedUrl)}`,
				)
				if (!response.ok) return null
				const body = (await response.json()) as { title?: unknown }
				return typeof body.title === 'string' && body.title.trim()
					? body.title.trim()
					: null
			} catch {
				return null
			}
		},

		async dispatch(canvasId, command) {
			try {
				return await request(canvasId, command)
			} catch {
				return dispatchBrowserCommand(canvasId, command)
			}
		},

		async snapshot(canvasId, itemId) {
			let response: Response
			try {
				response = await fetch(
					`/__dev-canvas/api/canvases/${encodeURIComponent(
						normalizeCanvasId(canvasId),
					)}/snapshots/${encodeURIComponent(itemId)}`,
					{ method: 'POST' },
				)
			} catch {
				throw new Error('Snapshots require the local canvas server.')
			}
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: unknown
				} | null
				throw new Error(
					typeof body?.error === 'string'
						? body.error
						: `Snapshot adapter returned ${response.status}.`,
				)
			}
			const snapshot = (await response.json()) as CanvasSnapshot
			return {
				...snapshot,
				canvas: normalizeCanvasTitles(snapshot.canvas),
			}
		},
	}
}

async function requestCanvasList() {
	const response = await fetch('/__dev-canvas/api/canvases')
	if (!response.ok)
		throw new Error(`Canvas adapter returned ${response.status}.`)
	return (await response.json()) as CanvasSummary[]
}

async function request(canvasId: string, command?: CanvasCommand) {
	const response = await fetch(
		`/__dev-canvas/api/canvases/${encodeURIComponent(normalizeCanvasId(canvasId))}`,
		{
			method: command ? 'POST' : 'GET',
			headers: command ? { 'Content-Type': 'application/json' } : undefined,
			body: command ? JSON.stringify(command) : undefined,
		},
	)
	if (!response.ok)
		throw new Error(`Canvas adapter returned ${response.status}.`)
	const snapshot = (await response.json()) as CanvasSnapshot
	return {
		...snapshot,
		canvas: normalizeCanvasTitles(snapshot.canvas),
	}
}

function readBrowserSnapshot(canvasId: string): CanvasSnapshot {
	const id = normalizeCanvasId(canvasId)
	const stored = window.localStorage.getItem(storageKey(id))
	let canvas = createCanvasDocument(id)
	if (stored) {
		try {
			const parsed = JSON.parse(stored) as CanvasDocument
			if (
				parsed.version === 1 &&
				parsed.id === id &&
				Array.isArray(parsed.items)
			) {
				canvas = normalizeCanvasTitles(parsed)
			}
		} catch {
			// Invalid local data is ignored in favor of a fresh canvas.
		}
	}
	return { canvas, sources: [], mode: 'browser' }
}

function listBrowserCanvases(): CanvasSummary[] {
	const canvases: CanvasSummary[] = []
	for (let index = 0; index < window.localStorage.length; index += 1) {
		const key = window.localStorage.key(index)
		if (!key?.startsWith(STORAGE_PREFIX)) continue
		const stored = window.localStorage.getItem(key)
		if (!stored) continue
		try {
			const parsed = JSON.parse(stored) as CanvasDocument
			if (
				parsed.version === 1 &&
				typeof parsed.id === 'string' &&
				typeof parsed.title === 'string' &&
				Array.isArray(parsed.items)
			) {
				canvases.push(summarizeCanvas(normalizeCanvasTitles(parsed)))
			}
		} catch {
			// Invalid local data is omitted from the switcher.
		}
	}
	return canvases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function dispatchBrowserCommand(
	canvasId: string,
	command: CanvasCommand,
): CanvasSnapshot {
	const snapshot = readBrowserSnapshot(canvasId)
	const canvas = normalizeCanvasTitles(
		applyCanvasCommand(snapshot.canvas, command),
	)
	window.localStorage.setItem(storageKey(canvas.id), JSON.stringify(canvas))
	return { ...snapshot, canvas }
}

function normalizeCanvasTitles(canvas: CanvasDocument): CanvasDocument {
	let changed = false
	const items = canvas.items.map((item) => {
		const title = normalizeItemTitle(item.title)
		const status = normalizeItemStatus(item.status)
		if (title === item.title && status === item.status) return item
		changed = true
		return { ...item, title, status }
	})
	return changed ? { ...canvas, items } : canvas
}

function storageKey(canvasId: string) {
	return `${STORAGE_PREFIX}${canvasId}`
}
