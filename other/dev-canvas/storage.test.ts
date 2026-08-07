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
		await expect(storage.list()).resolves.toEqual([
			{
				id: 'checkout-review',
				title: 'Checkout Review',
				itemCount: 1,
				updatedAt: snapshot.canvas.updatedAt,
			},
		])
	})

	it('adds an immutable archived frame without replacing the live frame', async () => {
		const root = await makeTemporaryDirectory()
		const storage = createCanvasStorage(root, {
			snapshotArchive: {
				async capture(sourceUrl) {
					return {
						id: '20260806210000-deadbeef',
						sourceUrl,
						capturedAt: '2026-08-06T21:00:00.000Z',
						sizeBytes: 512,
					}
				},
				async read() {
					return Buffer.from('<!doctype html>')
				},
			},
		})
		const live = await storage.dispatch('Review', {
			type: 'add',
			items: [{ url: 'http://app.localhost/', title: 'Workbench' }],
		})
		const item = live.canvas.items[0]
		if (!item) throw new Error('Expected a live frame')

		const captured = await storage.snapshot('review', item.id)

		expect(captured.canvas.items).toHaveLength(2)
		expect(captured.canvas.items[0]).toMatchObject({
			url: 'http://app.localhost/',
			source: 'manual',
		})
		expect(captured.canvas.items[1]).toMatchObject({
			url: '/__dev-canvas/snapshots/20260806210000-deadbeef',
			title: 'Workbench · Snapshot',
			source: 'snapshot',
			status: 'archived',
			snapshot: {
				artifactId: '20260806210000-deadbeef',
				sourceUrl: 'http://app.localhost/',
				capturedAt: '2026-08-06T21:00:00.000Z',
			},
		})
	})
})

async function makeTemporaryDirectory() {
	const directory = await mkdtemp(path.join(tmpdir(), 'dev-canvas-test-'))
	temporaryDirectories.push(directory)
	return directory
}
