export type ApiScope = {
  tenantId: string
  workspaceId: string
}

export type ApiDeviceRecord = {
  id: string
  ownerUserId: string
  displayId: string
  deviceName: string
  deviceType: string
  ownerDisplayName: string
  ownerEmail: string
  workspaceName: string
  approvalState: 'Pending' | 'Approved' | 'Rejected' | 'Suspended' | 'Revoked'
  complianceState: 'Compliant' | 'NonCompliant' | 'Stale'
  lifecycleState: 'Active' | 'Suspended' | 'Retired' | 'WipeIssued'
  mdmDeviceId: string
  maskedSerialNumber: string
  operatingSystem: string
  operatingSystemVersion: string
  enrolledAt: string
  lastUsedSignals: {
    lastMdmCloudSyncAt: string | null
    lastMdmCloudSyncSource: string
    lastHardwareDeviceCheckInAt: string | null
    lastHardwareDeviceCheckInSource: string
    lastPwaAuthenticationAt: string | null
    lastPwaAuthenticationSource: string
    lastPwaForegroundActivityAt: string | null
    lastPwaForegroundActivitySource: string
    lastProtectedApiRequestAt: string | null
    lastProtectedApiRequestSource: string
    lastSessionStartAt: string | null
    lastSessionStartSource: string
    lastExplicitLogoutAt: string | null
    lastExplicitLogoutSource: string
  }
}

export type ApiAuditRecord = {
  id: string
  correlationId: string
  occurredAt: string
  actorDisplayName: string
  actorRole: string
  action: string
  targetDisplayName: string
  outcome: 'Success' | 'SUCCESS' | 'Denied' | 'Review'
  reason: string
}

export type AccessEvaluationRequest = {
  deviceId: string
  tenantId: string
  workspaceId: string
  userId: string
  requestedAppId: string
}

export type AccessEvaluationResponse = {
  decision: 'ALLOW' | 'DENY'
  reasonCode: string
  correlationId: string
  evaluatedAt: string
  grant: {
    token: string
    expiresAt: string
    scopes: string[]
  } | null
}

export type RemoteCommand = 'LOCK' | 'RETIRE' | 'WIPE'

export type RemoteCommandResponse = {
  command: RemoteCommand
  lifecycleState: ApiDeviceRecord['lifecycleState']
  outcome: string
  correlationId: string
}

export type MdmSyncResponse = {
  devicesSynced: number
  completedAt: string
  correlationId: string
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5080').replace(/\/$/, '')

const tenantIds: Record<string, string> = {
  'Acme Corporation': '11111111-1111-4111-8111-111111111111',
  'Northwind Health': '22222222-2222-4222-8222-222222222222',
  'Contoso Group': '33333333-3333-4333-8333-333333333333',
}

const workspaceIds: Record<string, string> = {
  Production: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  Engineering: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  Corporate: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
}

export function getApiScope(tenantName: string, workspaceName: string): ApiScope {
  const tenantId = tenantIds[tenantName]
  const workspaceId = workspaceIds[workspaceName]
  if (!tenantId || !workspaceId) throw new Error('Choose a valid tenant and workspace.')
  return { tenantId, workspaceId }
}

async function requestJson<T>(path: string, scope: ApiScope, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-Tenant-Id', scope.tenantId)
  headers.set('X-Workspace-Id', scope.workspaceId)
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `API request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export function getDevices(scope: ApiScope): Promise<ApiDeviceRecord[]> {
  return requestJson('/api/v1/admin/devices', scope)
}

export function getDevice(scope: ApiScope, id: string): Promise<ApiDeviceRecord> {
  return requestJson(`/api/v1/admin/devices/${encodeURIComponent(id)}`, scope)
}

export function getAuditRecords(scope: ApiScope): Promise<ApiAuditRecord[]> {
  return requestJson('/api/v1/admin/audit-logs', scope)
}

export function submitDeviceDecision(
  scope: ApiScope,
  id: string,
  decision: 'Approved' | 'Rejected',
  reason: string,
): Promise<ApiDeviceRecord> {
  const action = decision === 'Approved' ? 'approve' : 'reject'
  return requestJson(`/api/v1/admin/devices/${encodeURIComponent(id)}/${action}`, scope, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function evaluatePwaAccess(
  scope: ApiScope,
  request: AccessEvaluationRequest,
): Promise<AccessEvaluationResponse> {
  return requestJson('/api/v1/access/evaluate', scope, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export function submitRemoteCommand(
  scope: ApiScope,
  deviceId: string,
  command: RemoteCommand,
  reason: string,
): Promise<RemoteCommandResponse> {
  return requestJson(`/api/v1/admin/devices/${encodeURIComponent(deviceId)}/commands`, scope, {
    method: 'POST',
    body: JSON.stringify({ command, reason }),
  })
}

export function syncIntune(scope: ApiScope): Promise<MdmSyncResponse> {
  return requestJson('/api/v1/admin/integrations/intune/sync', scope, {
    method: 'POST',
  })
}

export async function downloadAuditExport(scope: ApiScope, format: 'csv' | 'json'): Promise<void> {
  const headers = new Headers({
    Accept: format === 'csv' ? 'text/csv' : 'application/json',
    'X-Tenant-Id': scope.tenantId,
    'X-Workspace-Id': scope.workspaceId,
  })
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/audit-logs/export?format=${format}`, { headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `Audit export failed (${response.status}).`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = format === 'csv' ? 'device_governance_audit.csv' : 'device_governance_audit.json'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}