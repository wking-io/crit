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
