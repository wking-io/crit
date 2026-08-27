import type { ReviewStatus } from "@crit/domain"

export interface FrameStatusChrome {
  readonly label: string
  readonly ink: string
  readonly shell: string
  readonly stroke: string
}

export const reviewStatusLabel = {
  "in-progress": "In progress",
  "ready-for-review": "Ready for review",
  approved: "Approved",
  "changes-requested": "Changes requested"
} satisfies Record<ReviewStatus, string>

export const frameStatusChrome = {
  "changes-requested": {
    label: reviewStatusLabel["changes-requested"],
    ink: "oklch(52% 0.2 55)",
    shell: "oklch(95.25% 0.024 55)",
    stroke: "oklch(67% 0.18 55)"
  },
  "in-progress": {
    label: reviewStatusLabel["in-progress"],
    ink: "oklch(52% 0.2 245.3)",
    shell: "oklch(95.25% 0.024 245.3)",
    stroke: "oklch(67% 0.18 245.3)"
  },
  approved: {
    label: reviewStatusLabel.approved,
    ink: "oklch(52% 0.2 156.3)",
    shell: "oklch(95.25% 0.024 156.3)",
    stroke: "oklch(67% 0.18 156.3)"
  },
  "ready-for-review": {
    label: reviewStatusLabel["ready-for-review"],
    ink: "oklch(52% 0.2 302)",
    shell: "oklch(95.25% 0.024 302)",
    stroke: "oklch(67% 0.18 302)"
  }
} satisfies Record<ReviewStatus, FrameStatusChrome>

export const frameStatus = (status: ReviewStatus): FrameStatusChrome =>
  frameStatusChrome[status]
