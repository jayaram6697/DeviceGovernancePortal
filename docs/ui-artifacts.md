# MDM Device Governance UI Artifacts

## Release 1 visual direction

A clear operational security console for customer IT administrators. Use a simple hierarchy, plain-language labels, persistent tenant/workspace context, and explicit status text. Keep queue and audit details scannable. Avoid consumer-device imagery and avoid implying that the browser can read OS inventory or issue device commands.

## Shared application shell

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ GateLogiq / DEVICE GOVERNANCE         Tenant: Acme  Workspace: Production │
│ Search                                    Administrator       Profile    │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Overview          │ WORKSPACE STATUS  Sample data / Connected           │
│ Devices           ├──────────────────────────────────────────────────────┤
│ Approvals       12│ Page title / purpose / common actions / why it matters│
│ Application access│                                                     │
│ Applications      │ Main operational content                            │
│ Operations        │                                                      │
└───────────────────┴──────────────────────────────────────────────────────┘
```

The workspace status notice remains visible across modules but is visually distinct from module content. In demo mode it explains that records are samples, changes stay in this browser, and no real devices are changed; retry and reset controls remain compact. Tenant and workspace are visible at all times. Navigation is grouped by purpose: Overview, Device governance, Application security, Operations, and Administration. The dashboard includes a clickable module directory; each module page starts with its purpose, common actions, and why the module matters. Tenant/workspace and user/role administration are directly accessible. Access control and remote commands are also first-class destinations instead of being hidden in Settings.

## Login and session

The unauthenticated view presents a GateLogiq device-governance login card. The demo accepts any credentials and opens the console as a Customer IT Administrator. Sign out returns immediately to the login screen.

## UI-008 Pending approvals

```text
Pending approvals  12                         Search / status filters
┌────────────────────────────────────────────────────────────────────────┐
│ Device       Owner       Workspace     Approval     Compliance  Seen  │
│ MacBook Pro  A. Morgan   Production    Pending      Compliant    4m    │
│ iPhone 15    J. Rivera   Production    Pending      Non-compliant 2m  │
└────────────────────────────────────────────────────────────────────────┘
```

Selecting **Review & Decide** on a request card opens a review dialog with owner and Intune correlation evidence, masked serial, and separate approval and compliance states. Approve and Reject require an actionable justification of at least 12 characters before submission. The UI makes no access-grant promise from approval alone.

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

Append-only event history with free-text search and an outcome filter. Each entry shows the action, result, reason, actor, target, and correlation ID; the ID can be copied. CSV and JSON exports are available. The current UI does not provide separate time-range or event-type filters, and it has no edit or delete affordances.

## Responsive and interaction notes

- Wide layouts use a persistent left navigation and full-width data tables; narrow layouts collapse navigation and allow tables to scroll without hiding row identity.
- All status indicators include text, not color alone.
- Dialog actions are keyboard accessible; justification is required for both approval decisions.
- Data shown in this prototype is illustrative. Production integrations must enforce tenant and workspace scope server-side and source OS inventory/remote commands through Intune.