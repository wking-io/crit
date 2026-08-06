import { describe, expect, it } from 'vitest'
import {
	browserShapeMigrations,
	projectedRectangleRadius,
} from './BrowserShape'

describe('browser shape migrations', () => {
	it('adds in-progress status to persisted shapes created before statuses existed', () => {
		const props: Record<string, unknown> = {
			w: 880,
			h: 580,
			itemId: 'legacy-item',
			url: 'https://app.localhost/',
			title: 'Legacy frame',
			source: 'manual',
		}
		const migration = browserShapeMigrations.sequence[0]
		if (!migration || !('up' in migration)) {
			throw new Error('Expected the AddStatus migration')
		}

		migration.up(props)

		expect(props.status).toBe('in-progress')
	})

	it('projects rotated pill bounds onto the curve tangent', () => {
		expect(projectedRectangleRadius(100, 24, 0, 0, -1)).toBeCloseTo(12)
		expect(projectedRectangleRadius(100, 24, Math.PI / 2, 0, -1)).toBeCloseTo(
			50,
		)
	})

})
