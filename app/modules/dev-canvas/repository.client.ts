import {
	applyCanvasCommand,
	createCanvasDocument,
	normalizeCanvasId,
} from './model'
import type {
	CanvasCommand,
	CanvasDocument,
	CanvasRepository,
	CanvasSnapshot,
} from './model'

export function createLocalCanvasRepository(): CanvasRepository {
	return {
		async read(canvasId) {
			try {
				return await request(canvasId)
			} catch {
				return readBrowserSnapshot(canvasId)
			}
		},

		async dispatch(canvasId, command) {
			try {
				return await request(canvasId, command)
			} catch {
				return dispatchBrowserCommand(canvasId, command)
			}
		},
	}
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
	return (await response.json()) as CanvasSnapshot
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
				canvas = parsed
			}
		} catch {
			// Invalid local data is ignored in favor of a fresh canvas.
		}
	}
	return { canvas, sources: [], mode: 'browser' }
}

function dispatchBrowserCommand(
	canvasId: string,
	command: CanvasCommand,
): CanvasSnapshot {
	const snapshot = readBrowserSnapshot(canvasId)
	const canvas = applyCanvasCommand(snapshot.canvas, command)
	window.localStorage.setItem(storageKey(canvas.id), JSON.stringify(canvas))
	return { ...snapshot, canvas }
}

function storageKey(canvasId: string) {
	return `dev-canvas:document:${canvasId}`
}
