import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCanvasStorage } from './storage'

const temporaryDirectories: string[] = []
const originalStateDirectory = process.env.PORTLESS_STATE_DIR

afterEach(async () => {
	if (originalStateDirectory === undefined) {
		delete process.env.PORTLESS_STATE_DIR
	} else {
		process.env.PORTLESS_STATE_DIR = originalStateDirectory
	}
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

describe('local canvas storage adapter', () => {
	it('discovers live Portless worktree routes', async () => {
		const root = await makeTemporaryDirectory()
		const state = await makeTemporaryDirectory()
		process.env.PORTLESS_STATE_DIR = state
		await writeFile(path.join(state, 'proxy.port'), '1355')
		await writeFile(path.join(state, 'proxy.tls'), '0')
		await writeFile(
			path.join(state, 'routes.json'),
			JSON.stringify([
				{
					hostname: 'fix-mobile.storefront.localhost',
					port: 4321,
					pid: process.pid,
				},
			]),
		)

		const snapshot = await createCanvasStorage(root).read('review')

		expect(snapshot.sources).toEqual([
			{
				id: expect.stringMatching(/^url-/),
				url: 'http://fix-mobile.storefront.localhost:1355/',
				title: 'fix-mobile.storefront',
				hostname: 'fix-mobile.storefront.localhost',
				port: 4321,
			},
		])
	})

	it('persists commands in a host-owned canvas document', async () => {
		const root = await makeTemporaryDirectory()
		const storage = createCanvasStorage(root)

		const snapshot = await storage.dispatch('Checkout Review', {
			type: 'add',
			items: [
				{
					url: 'feature.storefront.localhost',
					title: 'Feature',
					source: 'agent',
				},
			],
		})
		const persisted = JSON.parse(
			await readFile(
				path.join(root, '.dev-canvas/canvases/checkout-review.json'),
				'utf8',
			),
		) as { items: unknown[] }

		expect(snapshot.canvas.id).toBe('checkout-review')
		expect(persisted.items).toHaveLength(1)
	})
})

async function makeTemporaryDirectory() {
	const directory = await mkdtemp(path.join(tmpdir(), 'dev-canvas-test-'))
	temporaryDirectories.push(directory)
	return directory
}
