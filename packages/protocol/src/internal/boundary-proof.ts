import type { DomainBoundaryProof } from "@crit/domain/internal/boundary-proof.js"

const domainBoundary: DomainBoundaryProof = { package: "domain" }

export type ProtocolBoundaryProof = typeof domainBoundary
