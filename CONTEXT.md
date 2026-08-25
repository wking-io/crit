# Crit

Crit is a local-first collaborative review canvas for live web applications.

## Language

**Installation**: One customer-hosted Crit deployment. The Installation is the tenant and security boundary.
_Avoid_: Organization, tenant record

**Workspace**: The collaboration and authorization boundary inside an Installation. Workspaces contain members, Teams, Applications, and Canvases.

**Default Workspace**: The first Workspace created in an Installation, unless an administrator later changes the default. Crit selects it automatically when a Person has not chosen another accessible Workspace.

**Active Workspace**: The Workspace used for new links and Workspace-scoped browsing. Changing it does not move an existing linked Canvas. v1 uses the Installation's implicit default Workspace and does not expose switching.

**Canvas**: A named review space containing Frames.

**Canvas Projection**: The current Canvas content rebuilt from accepted Canvas Changes. It is a view, not the canonical history.
_Avoid_: Canvas Document, authoritative document

**Canvas Change**: One atomic batch of semantic Canvas Commands submitted under a stable change identity.

**Proposed Canvas Change**: Unauthored local or remote intent that has not been accepted by the active Canvas Authority.

**Accepted Canvas Change**: A Canvas Change assigned a canonical sequence, cursor, acceptance time, and trusted attribution by a Canvas Authority.

**Canvas Command**: One semantic request to change Canvas content. Commands contain intent and narrow content preconditions. They do not contain trusted authorship or server time.

**Canvas Authority**: The component that orders and stores accepted changes for one Canvas. A local-only Canvas uses the local authority. A linked Canvas uses its remote authority.

**Canvas Ledger**: The canonical ordered history of accepted changes owned by a Canvas Authority.

**Canvas Replica**: The local accepted history, pending changes, acknowledged remote cursor, conflicts, and current Canvas Projection for one Canvas.

**Pending Change**: A Proposed Canvas Change stored in a Canvas Replica and not yet accepted by the remote Canvas Authority.

**Replica Conflict**: A pending change whose semantic precondition no longer holds after accepted remote work is applied. Crit preserves it for recovery.

**Cursor**: An opaque position in one Canvas Ledger. A cursor supports resuming reads. It is not an exact content precondition.

**First Share**: The retry-safe operation that creates a remote Canvas from a local-only Canvas and links the local replica to it.

**Frame**: A stable Canvas item that places one Representation at a viewport size and Canvas geometry. A Frame also carries review state.

**Representation**: The content a Frame means to display, independent of the current viewer's environment.

**Application Route**: A logical Representation identified by an Application, route, and optional serializable page state.

**Web URL Representation**: A Representation identified by an explicit external URL. Crit provides reduced guarantees for authentication, embedding, and inspection.

**Artifact Representation**: An immutable Representation identified by an Artifact ID and content digest.

**Application**: A named web application that provides Application Route Representations.

**Application Binding**: An environment-specific base URL for an Application. Local bindings remain on the developer's machine. Shared bindings come from Deployments.

**Deployment**: A shared Application binding with a channel, URL, source revision, and optional expiration.

**Render Plan**: The result of resolving a Representation for one viewer. It is an iframe, immutable artifact, or unavailable state.

**Artifact**: Immutable content stored outside the Canvas Ledger and addressed by a digest.

**Capture**: The operation that creates an Artifact from a live Representation and adds a separate Artifact Frame. A Frame's Representation is set at create. Capture is not a generic representation-change action.

**Principal**: The authenticated identity making a request.

**Actor**: The durable author of an accepted change. An Actor is either a Person or an Agent.

**Person**: A human Actor associated with company identity for shared work and provisional local identity for local-only work. The Person record always includes an email state. Local work may be unspecified or carry a provisional address.

**Agent**: A non-human Actor that changes Crit through an authorized local tool on a developer's machine.
_Avoid_: remote agent, MCP agent

**Delegating Person**: The Person who ran a local Agent. The Delegating Person is not the author of the Agent's work.
_Avoid_: OAuth grant holder

**Agent Execution**: One local Agent run. It records the Agent, the Delegating Person, the execution identity, and optional reported runtime metadata.

**Reported Agent Runtime**: Harness, model, session, and task metadata supplied by a local Agent client. Crit displays it separately from server-verified identity.

**Presence**: Ephemeral awareness of connected People and active Agent Executions. Presence is not Canvas history.

**Frame Bridge**: The versioned browser protocol used for input relay, route and revision reporting, highlighting, and authorized inspection.

**Hosted Review UI**: The Crit review interface served from the customer Installation. People use it after share. They do not install Crit.
_Avoid_: remote MCP, shared agent endpoint

**Local Daemon**: The `crit dev` process that owns local SQLite state, local artifacts, local API endpoints, and synchronization.
