import { describe, expect, it } from 'vitest'
import {
	applyCanvasCommand,
	createCanvasDocument,
	matchesPortlessIteration,
	normalizeCanvasId,
	normalizeItemTitle,
	normalizeUrl,
} from './model'

describe('dev canvas model', () => {
	it('normalizes canvas ids and URLs at the module seam', () => {
		expect(normalizeCanvasId(' Checkout Iterations! ')).toBe(
			'checkout-iterations',
		)
		expect(normalizeUrl('feature.app.localhost/path#section')).toBe(
			'https://feature.app.localhost/path',
		)
	})

	it('strips leading letter/id and dash prefixes from titles', () => {
		expect(normalizeItemTitle('A – Polyphonic Workbench')).toBe(
			'Polyphonic Workbench',
		)
		expect(normalizeItemTitle('B - Synth')).toBe('Synth')
		expect(normalizeItemTitle('12 — Checkout')).toBe('Checkout')
		expect(normalizeItemTitle('Plain Title')).toBe('Plain Title')
	})

	it('adds by normalized URL without creating duplicates', () => {
		const document = createCanvasDocument('checkout', '2026-01-01T00:00:00Z')
		const first = applyCanvasCommand(
			document,
			{
				type: 'add',
				items: [{ url: 'app.localhost', title: 'A – First' }],
			},
			'2026-01-02T00:00:00Z',
		)
		const second = applyCanvasCommand(
			first,
			{
				type: 'add',
				items: [{ url: 'https://app.localhost/', title: 'Latest' }],
			},
			'2026-01-03T00:00:00Z',
		)

		expect(second.items).toHaveLength(1)
		expect(first.items[0]?.title).toBe('First')
		expect(first.items[0]?.status).toBe('in-progress')
		expect(second.items[0]?.title).toBe('Latest')
	})

	it('persists status changes independently from frame titles', () => {
		const added = applyCanvasCommand(createCanvasDocument('review'), {
			type: 'add',
			items: [{ url: 'app.localhost', title: 'Workbench' }],
		})
		const item = added.items[0]
		if (!item) throw new Error('Expected a canvas item')

		const reviewed = applyCanvasCommand(added, {
			type: 'set-status',
			itemId: item.id,
			status: 'ready-for-review',
		})

		expect(reviewed.items[0]).toMatchObject({
			title: 'Workbench',
			status: 'ready-for-review',
		})
	})

	it('finds a main app and every worktree-prefixed iteration', () => {
		expect(
			matchesPortlessIteration({ hostname: 'checkout.localhost' }, 'checkout'),
		).toBe(true)
		expect(
			matchesPortlessIteration(
				{ hostname: 'feature-mobile.checkout.localhost' },
				'checkout',
			),
		).toBe(true)
		expect(
			matchesPortlessIteration({ hostname: 'docs.localhost' }, 'checkout'),
		).toBe(false)
	})
})
