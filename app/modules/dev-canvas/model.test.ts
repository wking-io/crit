import { describe, expect, it } from 'vitest'
import {
	applyCanvasCommand,
	createCanvasDocument,
	matchesPortlessIteration,
	normalizeCanvasId,
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

	it('adds by normalized URL without creating duplicates', () => {
		const document = createCanvasDocument('checkout', '2026-01-01T00:00:00Z')
		const first = applyCanvasCommand(
			document,
			{
				type: 'add',
				items: [{ url: 'app.localhost', title: 'First' }],
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
		expect(second.items[0]?.title).toBe('Latest')
	})

	it('finds a main app and every worktree-prefixed iteration', () => {
		expect(
			matchesPortlessIteration({ hostname: 'checkout.localhost' }, 'checkout'),
		).toBe(true)
		expect(
			matchesPortlessIteration(
				{ hostname: 'fix-mobile.checkout.localhost' },
				'checkout',
			),
		).toBe(true)
		expect(
			matchesPortlessIteration({ hostname: 'docs.localhost' }, 'checkout'),
		).toBe(false)
	})
})
