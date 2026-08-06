import { describe, expect, it } from 'vitest'
import {
	DEV_CANVAS_HEIGHT_MESSAGE,
	parseDevCanvasHeightMessage,
} from './frame-height-bridge.client'

describe('dev canvas frame height bridge', () => {
	it('accepts finite positive document and viewport heights', () => {
		expect(
			parseDevCanvasHeightMessage({
				type: DEV_CANVAS_HEIGHT_MESSAGE,
				documentHeight: 1200,
				viewportHeight: 580,
			}),
		).toEqual({
			type: DEV_CANVAS_HEIGHT_MESSAGE,
			documentHeight: 1200,
			viewportHeight: 580,
		})
	})

	it('rejects malformed and unrelated window messages', () => {
		expect(
			parseDevCanvasHeightMessage({ type: 'other', documentHeight: 1200 }),
		).toBeNull()
		expect(
			parseDevCanvasHeightMessage({
				type: DEV_CANVAS_HEIGHT_MESSAGE,
				documentHeight: Number.NaN,
				viewportHeight: 580,
			}),
		).toBeNull()
	})
})
