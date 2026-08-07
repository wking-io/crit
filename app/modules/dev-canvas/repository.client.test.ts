import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalCanvasRepository } from './repository.client'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('local canvas repository', () => {
	it('reconnects to the local adapter after an initial network failure', async () => {
		const localStorage = createMemoryStorage()
		const connectedSnapshot = {
			canvas: {
				version: 1 as const,
				id: 'synth-ui-iterations',
				title: 'Synth UI Iterations',
				items: [
					{
						id: 'iteration-a',
						url: 'http://localhost:5173/synth?variant=A',
						title: 'Iteration A',
						source: 'agent' as const,
						status: 'in-progress' as const,
						addedAt: '2026-08-06T00:00:00.000Z',
					},
				],
				updatedAt: '2026-08-06T00:00:00.000Z',
			},
			sources: [],
			mode: 'local-server' as const,
		}
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce(
				new Response(JSON.stringify(connectedSnapshot), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			)
		vi.stubGlobal('fetch', fetch)
		vi.stubGlobal('window', { localStorage })

		const repository = createLocalCanvasRepository()

		expect((await repository.read('synth-ui-iterations')).mode).toBe('browser')
		await expect(repository.read('synth-ui-iterations')).resolves.toEqual(
			connectedSnapshot,
		)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('lists locally stored canvases when the adapter is unavailable', async () => {
		const localStorage = createMemoryStorage()
		localStorage.setItem(
			'dev-canvas:document:review',
			JSON.stringify({
				version: 1,
				id: 'review',
				title: 'Review',
				items: [],
				updatedAt: '2026-08-06T00:00:00.000Z',
			}),
		)
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')))
		vi.stubGlobal('window', { localStorage })

		await expect(createLocalCanvasRepository().list()).resolves.toEqual([
			{
				id: 'review',
				title: 'Review',
				itemCount: 0,
				updatedAt: '2026-08-06T00:00:00.000Z',
			},
		])
	})

	it('returns the server-resolved document title', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(JSON.stringify({ title: 'Example document' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		)
		vi.stubGlobal('fetch', fetch)

		await expect(
			createLocalCanvasRepository().getUrlTitle('example.com'),
		).resolves.toBe('Example document')
		expect(fetch).toHaveBeenCalledWith(
			'/__dev-canvas/api/metadata?url=https%3A%2F%2Fexample.com%2F',
		)
	})

	it('captures a frame through the local snapshot adapter', async () => {
		const snapshot = {
			canvas: {
				version: 1 as const,
				id: 'review',
				title: 'Review',
				items: [],
				updatedAt: '2026-08-06T00:00:00.000Z',
			},
			sources: [],
			mode: 'local-server' as const,
		}
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(JSON.stringify(snapshot), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		)
		vi.stubGlobal('fetch', fetch)

		await expect(
			createLocalCanvasRepository().snapshot('Review', 'url-live'),
		).resolves.toEqual(snapshot)
		expect(fetch).toHaveBeenCalledWith(
			'/__dev-canvas/api/canvases/review/snapshots/url-live',
			{ method: 'POST' },
		)
	})
})

function createMemoryStorage(): Storage {
	const values = new Map<string, string>()
	return {
		get length() {
			return values.size
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value),
	}
}
