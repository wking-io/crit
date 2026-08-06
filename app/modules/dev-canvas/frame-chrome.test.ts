import { describe, expect, it } from 'vitest'
import {
	FRAME_STATUSES,
	frameStatus,
	formatFrameChromeTitle,
	shortIdForIndex,
} from './frame-chrome'

describe('frame chrome', () => {
	it('formats spreadsheet-style short ids by frame index', () => {
		expect(shortIdForIndex(0)).toBe('A')
		expect(shortIdForIndex(5)).toBe('F')
		expect(shortIdForIndex(25)).toBe('Z')
		expect(shortIdForIndex(26)).toBe('AA')
		expect(shortIdForIndex(-1)).toBe('A')
	})

	it('keeps the supported frame statuses in menu order', () => {
		expect(FRAME_STATUSES.map((status) => status.id)).toEqual([
			'changes-requested',
			'in-progress',
			'archived',
			'approved',
			'ready-for-review',
		])
		expect(frameStatus('approved').label).toBe('Approved')
	})

	it('formats chrome as {shortId}: {title}', () => {
		expect(formatFrameChromeTitle('A', 'Polyphonic Workbench')).toBe(
			'A: Polyphonic Workbench',
		)
	})
})
