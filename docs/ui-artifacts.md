# MDM Device Governance UI Artifacts

## Release 1 visual direction

An operational security console for customer IT administrators. The interface is dense enough for queue and audit work, with restrained color, crisp typography, persistent tenant/workspace context, and explicit status labels. Avoid consumer-device imagery and avoid implying that the browser can read OS inventory or issue device commands.

## Shared application shell

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ DeviceGate / MDM DEVICE GOVERNANCE    Tenant: Acme  Workspace: Production │
│ Search                                    Helpdesk Admin      Profile   │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Overview          │ SECURITY NOTICE  Intune sync is stale (last sync …) │
│ Devices           ├──────────────────────────────────────────────────────┤
│ Approvals       12│ Page title / scope / primary actions                │
│ Policies          │                                                      │
│ Applications      │ Main operational content                            │
│ Audit             │                                                      │
└───────────────────┴──────────────────────────────────────────────────────┘
```

The sync notice remains prominent across protected administrative views. Tenant and workspace are visible at all times. Navigation labels map to the supplied UI catalog; Release 1 screens are Approvals, Devices, PWA Access Simulator, and Audit.

## Login and session

The unauthenticated view presents a DeviceGate MDM login card for the Customer-Managed PWA Governance Platform. The demo accepts any credentials and opens the console as a Customer IT Administrator. Sign out returns immediately to the login screen.

## UI-008 Pending approvals

```text
Pending approvals  12                         Search / status filters
┌────────────────────────────────────────────────────────────────────────┐
│ Device       Owner       Workspace     Approval     Compliance  Seen  │
│ MacBook Pro  A. Morgan   Production    Pending      Compliant    4m    │
│ iPhone 15    J. Rivera   Production    Pending      Non-compliant 2m  │
└────────────────────────────────────────────────────────────────────────┘
```

Selecting a row opens a review dialog with owner and Intune correlation evidence, masked serial, compliance freshness, and the separate approval and compliance states. Approve and Reject require an actionable justification of at least 12 characters before submission. The UI makes no access-grant promise from approval alone.

## UI-009 Device details

Device identity and lifecycle states appear above a tabbed inspection surface. Approval state and compliance state use different labels and are never collapsed into one status. The Activity tab presents seven independent signals, each with its own timestamp, source, and empty-state handling:

1. Last MDM cloud sync (Microsoft Intune)
2. Last hardware device check-in (Microsoft Intune)
3. Last PWA authentication / login (Identity provider)
4. Last PWA foreground activity (PWA heartbeat)
5. Last protected API request (API gateway)
6. Last session start (Session service)
7. Last explicit logout (PWA; null when the browser closed)

The inventory cards can expand to show all seven signals with their individual last-seen times.

## PWA access simulator

The simulator previews the selected device in a mobile frame. Evaluation displays an authorized or denied verdict; denied decisions include the plain-language explanation and API reason code.

## UI-026 Audit explorer

Append-only event table with time range, outcome, event type, actor, and correlation ID filters. Rows show immutable event ID, correlation ID, timestamp, actor identity and role, action, target, outcome, and reason. No edit or delete affordances are provided.

## Responsive and interaction notes

- Wide layouts use a persistent left navigation and full-width data tables; narrow layouts collapse navigation and allow tables to scroll without hiding row identity.
- All status indicators include text, not color alone.
- Dialog actions are keyboard accessible; justification is required for both approval decisions.
- Data shown in this prototype is illustrative. Production integrations must enforce tenant and workspace scope server-side and source OS inventory/remote commands through Intune.