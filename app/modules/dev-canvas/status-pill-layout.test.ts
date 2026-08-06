import { describe, expect, test } from 'vitest'
import {
	DEFAULT_STATUS_ANIMATION,
	calculateStatusPillLayout,
} from './BrowserShape'

const PILL_HEIGHT = 24
const PILL_RADIUS = 8

type Vector = { x: number; y: number }

function roundedRectangleSupport(
	width: number,
	height: number,
	radius: number,
	angle: number,
	direction: Vector,
) {
	const cosine = Math.cos(angle)
	const sine = Math.sin(angle)
	const localX = cosine * direction.x + sine * direction.y
	const localY = -sine * direction.x + cosine * direction.y
	const supportX = Math.sign(localX) * (width / 2 - radius) + radius * localX
	const supportY = Math.sign(localY) * (height / 2 - radius) + radius * localY
	return {
		x: cosine * supportX - sine * supportY,
		y: sine * supportX + cosine * supportY,
	}
}

describe('calculateStatusPillLayout', () => {
	test('keeps the rounded pill edges at one constant visual gap', () => {
		const pillGap = DEFAULT_STATUS_ANIMATION.pillGap
		const layout = calculateStatusPillLayout(
			[
				40 + 'Changes requested'.length * 6.5,
				40 + 'In progress'.length * 6.5,
				40 + 'Approved'.length * 6.5,
				40 + 'Ready for review'.length * 6.5,
			],
			DEFAULT_STATUS_ANIMATION,
		)

		for (let index = 0; index < layout.length - 1; index += 1) {
			const upper = layout[index]!
			const lower = layout[index + 1]!
			const normalAngle = (upper.angle + lower.angle) / 2
			const normal = {
				x: Math.sin(normalAngle),
				y: -Math.cos(normalAngle),
			}
			const upperSupport = roundedRectangleSupport(
				upper.width,
				PILL_HEIGHT,
				PILL_RADIUS,
				upper.angle,
				normal,
			)
			const lowerSupport = roundedRectangleSupport(
				lower.width,
				PILL_HEIGHT,
				PILL_RADIUS,
				lower.angle,
				normal,
			)
			const edgeGap = {
				x:
					upper.finalX +
					upper.width / 2 -
					(lower.finalX + lower.width / 2) -
					upperSupport.x -
					lowerSupport.x,
				y: upper.centerY - lower.centerY - upperSupport.y - lowerSupport.y,
			}

			expect(edgeGap.x).toBeCloseTo(pillGap * normal.x, 6)
			expect(edgeGap.y).toBeCloseTo(pillGap * normal.y, 6)
		}
	})

	test('uses the rounded bottom edge for the gap above the frame', () => {
		const [bottomPill] = calculateStatusPillLayout(
			[40 + 'Ready for review'.length * 6.5],
			DEFAULT_STATUS_ANIMATION,
		)
		expect(bottomPill).toBeDefined()

		const downwardSupport = roundedRectangleSupport(
			bottomPill!.width,
			PILL_HEIGHT,
			PILL_RADIUS,
			bottomPill!.angle,
			{ x: 0, y: 1 },
		)

		expect(bottomPill!.verticalHalfExtent).toBeCloseTo(downwardSupport.y, 6)
	})
})
