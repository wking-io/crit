import { describe, expect, it } from 'vitest'
import { browserShapeMigrations } from './BrowserShape'

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
})
