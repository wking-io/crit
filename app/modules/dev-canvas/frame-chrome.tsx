import type { ReactNode, SVGProps } from 'react'
import type { CanvasItemStatus } from './model'

export type FrameStatus = {
	id: CanvasItemStatus
	label: string
	ink: string
	shell: string
	stroke: string
	icon: (props: SVGProps<SVGSVGElement>) => ReactNode
}

const ICON_OPACITY = 0.2
const IconFlag = (props: SVGProps<SVGSVGElement>) => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
		<path
			d="M3.75 3.24C4.911 2.432 6.006 2.098 7.031 2.256C8.721 2.515 9.276 3.965 10.969 4.225C11.982 4.38 13.075 4.058 14.25 3.241V9.804C13.075 10.622 11.982 10.944 10.969 10.788C9.277 10.528 8.721 9.078 7.031 8.819C6.005 8.662 4.911 8.996 3.75 9.803"
			fill="currentColor"
			fillOpacity={ICON_OPACITY}
		/>
		<path
			d="M3.75 3.24C4.911 2.432 6.006 2.098 7.031 2.256C8.721 2.515 9.276 3.965 10.969 4.225C11.982 4.38 13.075 4.058 14.25 3.241V9.804C13.075 10.622 11.982 10.944 10.969 10.788C9.277 10.528 8.721 9.078 7.031 8.819C6.005 8.662 4.911 8.996 3.75 9.803"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M3.75 2V16"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const IconCheck = (props: SVGProps<SVGSVGElement>) => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
		<path
			d="M13.25 2.75H4.75C3.645 2.75 2.75 3.645 2.75 4.75V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V4.75C15.25 3.645 14.355 2.75 13.25 2.75Z"
			fill="currentColor"
			fillOpacity={ICON_OPACITY}
		/>
		<path
			d="M5.5 9C6.363 9.867 7.037 10.868 7.6 11.962C8.907 9.471 10.54 7.496 12.5 6.039"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M13.25 2.75H4.75C3.645 2.75 2.75 3.645 2.75 4.75V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V4.75C15.25 3.645 14.355 2.75 13.25 2.75Z"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const IconAtom = (props: SVGProps<SVGSVGElement>) => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
		<path
			d="M9 11.25C10.243 11.25 11.25 10.243 11.25 9C11.25 7.757 10.243 6.75 9 6.75C7.757 6.75 6.75 7.757 6.75 9C6.75 10.243 7.757 11.25 9 11.25Z"
			fill="currentColor"
			fillOpacity={ICON_OPACITY}
		/>
		<path
			d="M13.163 3.07C12.309 2.469 11.32 2.051 10.25 1.865"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M16.137 7.75C15.958 6.721 15.554 5.727 14.929 4.838"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M14.93 13.163C15.531 12.309 15.949 11.32 16.135 10.25"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M10.25 16.137C11.279 15.958 12.273 15.554 13.162 14.929"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M4.837 14.93C5.691 15.531 6.68 15.949 7.75 16.135"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M1.863 10.25C2.042 11.279 2.446 12.273 3.071 13.162"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={ICON_OPACITY}
		/>
		<path
			d="M3.07 4.837C2.469 5.691 2.051 6.68 1.865 7.75"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={ICON_OPACITY}
		/>
		<path
			d="M7.75 1.863C6.721 2.042 5.727 2.446 4.838 3.071"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={ICON_OPACITY}
		/>
		<path
			d="M9 11.25C10.243 11.25 11.25 10.243 11.25 9C11.25 7.757 10.243 6.75 9 6.75C7.757 6.75 6.75 7.757 6.75 9C6.75 10.243 7.757 11.25 9 11.25Z"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const IconEye = (props: SVGProps<SVGSVGElement>) => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M9 3.5C12.787 3.5 15.001 6.205 15.951 7.878C16.343 8.571 16.348 9.42 15.956 10.113C15.006 11.786 12.787 14.5 9 14.5C5.206 14.5 2.992 11.785 2.045 10.113C1.652 9.42 1.652 8.579 2.045 7.887C2.992 6.215 5.206 3.5 9 3.5ZM9 6.25C7.481 6.25 6.25 7.481 6.25 9C6.25 10.519 7.481 11.75 9 11.75C10.518 11.75 11.75 10.519 11.75 9C11.75 7.481 10.518 6.25 9 6.25Z"
			fill="currentColor"
			fillOpacity={ICON_OPACITY}
		/>
		<path
			d="M9 11.75C10.519 11.75 11.75 10.519 11.75 9C11.75 7.481 10.519 6.25 9 6.25C7.481 6.25 6.25 7.481 6.25 9C6.25 10.519 7.481 11.75 9 11.75Z"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M10.922 10.966L14.25 14.25"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M15.321 11.092C15.574 10.747 15.786 10.413 15.956 10.113C16.348 9.42 16.348 8.579 15.956 7.887C15.009 6.215 12.794 3.5 9 3.5C5.206 3.5 2.991 6.215 2.044 7.887C1.652 8.579 1.652 9.42 2.044 10.113C2.991 11.785 5.206 14.5 9 14.5C9.399 14.5 9.776 14.464 10.14 14.408"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

const IconTray = (props: SVGProps<SVGSVGElement>) => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
		<path
			d="M2.75 5.25H15.25V13.75C15.25 14.854 14.354 15.75 13.25 15.75H4.75C3.646 15.75 2.75 14.854 2.75 13.75V5.25Z"
			fill="currentColor"
			fillOpacity={ICON_OPACITY}
		/>
		<path
			d="M2.75 5.25L5 2.25H13L15.25 5.25"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M11.25 10.5L9 12.75L6.75 10.5"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M9 12.75V8.25"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M2.75 5.25H15.25V13.75C15.25 14.854 14.354 15.75 13.25 15.75H4.75C3.646 15.75 2.75 14.854 2.75 13.75V5.25Z"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M9 2.25V5.25"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

export const FRAME_STATUSES: FrameStatus[] = [
	{
		id: 'changes-requested',
		label: 'Changes requested',
		ink: 'oklch(64.6% 0.222 41.1)',
		shell: 'oklch(75% 0.183 55.9 / 30%)',
		stroke: 'oklch(64.6% 0.222 41.1 / 30%)',
		icon: IconFlag,
	},
	{
		id: 'in-progress',
		label: 'In progress',
		ink: 'oklch(54.6% 0.245 262.9)',
		shell: 'oklch(80.9% 0.105 251.8 / 30%)',
		stroke: 'oklch(54.6% 0.245 262.9 / 30%)',
		icon: IconAtom,
	},
	{
		id: 'archived',
		label: 'Archived',
		ink: 'oklch(26.9% 0 0)',
		shell: 'oklch(87% 0 0 / 30%)',
		stroke: 'oklch(26.9% 0 0 / 30%)',
		icon: IconTray,
	},
	{
		id: 'approved',
		label: 'Approved',
		ink: 'oklch(62.7% 0.194 149.2)',
		shell: 'oklch(79.2% 0.209 151.7 / 30%)',
		stroke: 'oklch(62.7% 0.194 149.2 / 30%)',
		icon: IconCheck,
	},
	{
		id: 'ready-for-review',
		label: 'Ready for review',
		ink: 'oklch(50% 0.24 302)',
		shell: 'oklch(78% 0.16 302 / 30%)',
		stroke: 'oklch(50% 0.24 302 / 30%)',
		icon: IconEye,
	},
]

export function frameStatus(status: CanvasItemStatus): FrameStatus {
	return (
		FRAME_STATUSES.find((candidate) => candidate.id === status) ??
		FRAME_STATUSES[1]
	)
}

export function shortIdForIndex(index: number) {
	let value = Math.max(0, index)
	let result = ''
	do {
		result = String.fromCharCode(65 + (value % 26)) + result
		value = Math.floor(value / 26) - 1
	} while (value >= 0)
	return result
}

export function formatFrameChromeTitle(shortId: string, title: string) {
	return `${shortId}: ${title}`
}

export function IconOpenExternal(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 18 18"
			aria-hidden="true"
			{...props}
		>
			<path
				d="m7.75,15.25h5.5c1.105,0,2-.8954,2-2V4.75c0-1.105-.8954-2-2-2H4.75c-1.105,0-2,.8954-2,2v5.5h4c.5523,0,1,.4477,1,1v4Z"
				fill="currentColor"
				fillOpacity={ICON_OPACITY}
			/>
			<rect
				x="2.75"
				y="2.75"
				width="12.5"
				height="12.5"
				rx="2"
				ry="2"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<polyline
				points="12.25 9 12.25 5.75 9 5.75"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<line
				x1="12.25"
				y1="5.75"
				x2="9.25"
				y2="8.75"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="m2.75,11.25c0-.5523.448-1,1-1h3c.5523,0,1,.4477,1,1v3c0,.5523-.4477,1-1,1"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

export function IconFullscreen(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 18 18"
			aria-hidden="true"
			{...props}
		>
			<rect
				x="3"
				y="3"
				width="12"
				height="12"
				rx="2"
				fill="currentColor"
				fillOpacity={ICON_OPACITY}
			/>
			<path
				d="M2.75 15.25L15.25 2.75"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M10.75 2.75H15.25V7.25"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M2.75 10.75V15.25H7.25"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 18 18"
			aria-hidden="true"
			{...props}
		>
			<path
				d="M13.145 5.043L12.689 13.981C12.639 14.978 11.849 15.75 10.892 15.75H7.107C6.15 15.75 5.36 14.978 5.31 13.981L4.855 5.043"
				fill="currentColor"
				fillOpacity={ICON_OPACITY}
			/>
			<path
				d="M3.375 5.043H14.625"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M6.975 5.043V3.181C6.975 2.669 7.378 2.25 7.875 2.25H10.125C10.622 2.25 11.025 2.669 11.025 3.181V5.043"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M13.37 5.043L12.915 13.981C12.865 14.978 12.074 15.75 11.118 15.75H6.883C5.926 15.75 5.136 14.978 5.086 13.981L4.63 5.043"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}
