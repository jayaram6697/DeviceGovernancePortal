# Device Governance Platform

The React/Vite client is at the repository root. The ASP.NET Core API is in `DeviceGovernancePlatform.Server`.

## Project overview

This project demonstrates how an organization can review managed devices before allowing access to protected work applications. The normal workflow is: sync device records, review an access request, check device compliance, then evaluate application access. Decisions and supported device actions are recorded in the audit history.

### Portal modules

- **Dashboard:** Workspace health, items needing attention, the access workflow, and a directory of portal modules.
- **Device governance:** Device inventory and details, approval decisions, compliance status, and device activity signals.
- **Application security:** Registered applications, a device access evaluator, and a confirmed remote-command interface.
- **Operations:** MDM sync status, alerts, audit history, and CSV/JSON reports.
- **Administration:** Tenant/workspace selection, administrator profile information, and links to available controls.

Each module page includes a short guide explaining its purpose, common actions, and why it matters. The Compliance page also labels its example policy criteria; policy configuration is not available in the portal. The demo sign-in accepts any email and password. When the API is unavailable, the client uses browser-local sample data; demo actions do not contact Intune or change real devices. Application registration is currently held in client memory and is not saved by the API.

## Run locally

Requires Node.js and the .NET 8 SDK. PostgreSQL and Docker are optional; if PostgreSQL is unavailable, the API uses persistent SQLite storage at `DeviceGovernancePlatform.Server/mdm_governance.db`.

1. In Visual Studio Terminal, change to `DeviceGovernancePlatform.Server`.
2. Set the environment so Development settings and User Secrets are loaded:
   `$env:ASPNETCORE_ENVIRONMENT = "Development"`
3. Optionally start PostgreSQL with Docker:
   `docker run -d --name mdm-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=devicemanagement -p 5432:5432 postgres:16-alpine`
   Configure credentials locally with .NET User Secrets (do not commit passwords):
   `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Host=localhost;Port=5432;Database=devicemanagement;Username=postgres;Password=<your-local-password>"`
4. If `dotnet ef` is not installed, install the EF Core 8 CLI:
   `dotnet tool install --global dotnet-ef --version 8.0.11`
5. PostgreSQL migrations are applied automatically at API startup. To apply them manually, run `dotnet ef database update`; for future schema changes, first run `dotnet ef migrations add <MigrationName>`. SQLite creates the model on first startup.
6. Start the API: `dotnet run`
7. Open Swagger at `http://localhost:5080/swagger`.
8. Start the client in another terminal from the repository root: `npm run dev`.

The client uses `http://localhost:5080` by default. Override it with `VITE_API_BASE_URL` when the API is hosted elsewhere.

## API scope headers

All admin endpoints require `X-Tenant-Id` and `X-Workspace-Id` UUID headers. The development client maps its tenant/workspace selectors to the demo IDs and sends both headers on every request. The API seeds demo devices and audit records only when both database tables are empty; existing records and approvals are preserved.

`POST /api/v1/access/evaluate` accepts `deviceId`, `tenantId`, `workspaceId`, `userId`, and `requestedAppId` in its JSON body. It returns an `ALLOW` or `DENY` decision and correlation ID; allow decisions include a five-minute mock grant and scopes. Every valid evaluation is recorded in the workspace audit log.

Remote device commands are available through `POST /api/v1/admin/devices/{id}/commands` with a `command` (`LOCK`, `RETIRE`, or `WIPE`) and mandatory `reason`. They update persisted lifecycle state, invalidate access for non-active devices, and create correlated audit events. `POST /api/v1/admin/integrations/intune/sync` refreshes MDM timestamps and compliance evaluation for the selected tenant/workspace and records `MDM_SYNC_COMPLETED`. These Intune operations are simulated; no Microsoft Graph/Intune credentials or live remote commands are configured.

`GET /api/v1/admin/audit-logs/export?format=csv|json` downloads the current tenant/workspace audit records. Each valid export first appends an `AUDIT_EXPORT_GENERATED` event to the audit log.

The device inventory supports search by device name, owner, email, identifiers, platform, version, and approval state, plus an approval-status filter. The approval queue lists pending requests and supports search by device, owner, email, ID, workspace, and platform/version. Compliance status is shown in its own prioritized view; it does not have a separate filter control. The selected tenant and workspace scope the device lists, audit log, synchronization, and audit exports.

Swagger and the API are unauthenticated development scaffolding: caller-supplied tenant, workspace, and user IDs do not establish identity or authorization, and audit actors can be spoofed. Before deployment, derive scope and actor identity from authenticated claims and add role-based authorization.
