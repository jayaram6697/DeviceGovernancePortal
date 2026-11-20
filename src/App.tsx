import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FileClock,
  Fingerprint,
  Laptop,
  ListFilter,
  LockKeyhole,
  LogOut,
  Menu,
  MonitorCog,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { downloadAuditExport, evaluatePwaAccess, getApiScope, getAuditRecords, getDevice, getDevices, submitDeviceDecision, submitRemoteCommand, syncIntune } from './api'
import type { AccessEvaluationResponse, ApiAuditRecord, ApiDeviceRecord, RemoteCommand } from './api'

type ApprovalState = 'Pending' | 'Approved' | 'Rejected' | 'Suspended' | 'Revoked'
type ComplianceState = 'Compliant' | 'Non-compliant' | 'Stale'
type Screen = 'dashboard' | 'devices' | 'approvals' | 'compliance' | 'applications' | 'intune' | 'signals' | 'audit' | 'alerts' | 'reports' | 'settings' | 'identity' | 'scope' | 'access' | 'commands' | 'detail'
type DeviceInventoryFilter = 'all' | 'pending' | 'review' | 'ready'
type DeviceKind = 'Laptop' | 'Phone' | 'Tablet'
type DemoWorkspace = 'Engineering' | 'Operations UAE' | 'Field Logistics'
type ManagedApplication = {
  id: string
  name: string
  origin: string
  clientId: string
  workspaces: string[]
}

const sampleApplications: ManagedApplication[] = [
  { id: 'APP-001', name: 'GateLogiq Workspace', origin: 'https://workspace.example.com', clientId: 'com.northstar.workspace', workspaces: ['Engineering', 'Production'] },
  { id: 'APP-002', name: 'GateLogiq Support', origin: 'https://support.example.com', clientId: 'com.northstar.support', workspaces: ['Operations UAE'] },
  { id: 'APP-003', name: 'GateLogiq Analytics', origin: 'https://analytics.example.com', clientId: 'com.northstar.analytics', workspaces: ['Engineering', 'Corporate'] },
]

type ActivitySignal = {
  label: string
  value: string | null
  occurredAt: string | null
  source: string
  icon: LucideIcon
  note?: string
}

type Device = {
  recordId: string
  id: string
  name: string
  kind: DeviceKind
  hardwareModel: string | null
  ownerUserId: string
  lifecycleState: ApiDeviceRecord['lifecycleState']
  lastMdmSyncAt: string | null
  owner: string
  email: string
  workspace: string
  approval: ApprovalState
  compliance: ComplianceState
  intuneId: string
  serial: string
  platform: string
  version: string
  enrolled: string
  signals: ActivitySignal[]
}

type AuditEvent = {
  eventId: string
  correlationId: string
  date: string
  time: string
  actor: string
  role: string
  action: string
  target: string
  outcome: 'Success' | 'SUCCESS' | 'Denied' | 'Review'
  reason: string
  scope?: string
}

type PersistedDemoDeviceState = {
  approval: ApprovalState
  lifecycleState: ApiDeviceRecord['lifecycleState']
  lastMdmSyncAt: string | null
}

type PersistedDemoState = {
  devices?: Record<string, PersistedDemoDeviceState>
  approvals?: Record<string, ApprovalState>
  audit: AuditEvent[]
}

type PortalNotification = {
  id: string
  icon: string
  title: string
  description: string
  screen: Screen
  deviceId?: string
  auditSearch?: string
}

const demoProfileEmails: Record<string, string> = {
  'Acme Corporation': 'alex.mercer@acmecorp.com',
  'Northwind Health': 'alex.mercer@northwindhealth.com',
  'Contoso Group': 'alex.mercer@contoso.com',
}

function getDemoProfileEmail(tenant: string): string {
  return demoProfileEmails[tenant] ?? demoProfileEmails['Acme Corporation']
}

function demoStateStorageKey(tenant: string, workspace: DemoWorkspace): string {
  return `gatelogiq-demo-v1:${encodeURIComponent(tenant)}:${encodeURIComponent(workspace)}`
}

function isApprovalState(value: unknown): value is ApprovalState {
  return value === 'Pending' || value === 'Approved' || value === 'Rejected'
    || value === 'Suspended' || value === 'Revoked'
}

function isPersistedDemoDeviceState(value: unknown): value is PersistedDemoDeviceState {
  if (typeof value !== 'object' || value === null) return false
  const device = value as Record<string, unknown>
  return isApprovalState(device.approval)
    && (device.lifecycleState === 'Active' || device.lifecycleState === 'Suspended'
      || device.lifecycleState === 'Retired' || device.lifecycleState === 'WipeIssued')
    && (device.lastMdmSyncAt === null || typeof device.lastMdmSyncAt === 'string')
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  return typeof event.eventId === 'string'
    && typeof event.correlationId === 'string'
    && typeof event.date === 'string'
    && typeof event.time === 'string'
    && typeof event.actor === 'string'
    && typeof event.role === 'string'
    && typeof event.action === 'string'
    && typeof event.target === 'string'
    && (event.outcome === 'Success' || event.outcome === 'SUCCESS' || event.outcome === 'Denied' || event.outcome === 'Review')
    && typeof event.reason === 'string'
    && (event.scope === undefined || typeof event.scope === 'string')
}

function readPersistedDemoState(storageKey: string): PersistedDemoState | null {
  const serialized = window.localStorage.getItem(storageKey)
  if (!serialized) return null
  const parsed: unknown = JSON.parse(serialized)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Stored demo data has an invalid format.')
  }
  const value = parsed as Record<string, unknown>
  const storedDevices = value.devices
  const storedApprovals = value.approvals
  if (!Array.isArray(value.audit) || !value.audit.every(isAuditEvent)
    || (storedDevices === undefined && storedApprovals === undefined)) {
    throw new Error('Stored demo data is incomplete or invalid.')
  }
  if (storedDevices !== undefined
    && (typeof storedDevices !== 'object' || storedDevices === null || Array.isArray(storedDevices))) {
    throw new Error('Stored demo device state is invalid.')
  }
  if (storedApprovals !== undefined
    && (typeof storedApprovals !== 'object' || storedApprovals === null || Array.isArray(storedApprovals))) {
    throw new Error('Stored demo approvals are invalid.')
  }
  const devices = Object.create(null) as Record<string, PersistedDemoDeviceState>
  if (storedDevices) {
    for (const [deviceId, device] of Object.entries(storedDevices as Record<string, unknown>)) {
      if (!isPersistedDemoDeviceState(device)) throw new Error('Stored demo device state is invalid.')
      devices[deviceId] = device
    }
  }
  const approvals = Object.create(null) as Record<string, ApprovalState>
  if (storedApprovals) {
    for (const [deviceId, approval] of Object.entries(storedApprovals as Record<string, unknown>)) {
      if (!isApprovalState(approval)) throw new Error('Stored demo approval state is invalid.')
      approvals[deviceId] = approval
    }
  }
  return { devices, approvals, audit: value.audit }
}

function persistDemoState(storageKey: string, devices: Device[], audit: AuditEvent[]): void {
  const persistedDevices = Object.create(null) as Record<string, PersistedDemoDeviceState>
  for (const device of devices) {
    persistedDevices[device.recordId] = {
      approval: device.approval,
      lifecycleState: device.lifecycleState,
      lastMdmSyncAt: device.lastMdmSyncAt,
    }
  }
  window.localStorage.setItem(storageKey, JSON.stringify({ devices: persistedDevices, audit } satisfies PersistedDemoState))
}

function formatRelativeTime(value: string | null): string | null {
  if (!value) return null
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} mins ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hrs ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

function formatCompactRelativeTime(value: string | null): string | null {
  if (!value) return null
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function friendlySignalTitle(label: string): string {
  const titles: Record<string, string> = {
    'MDM cloud sync': 'Cloud sync time',
    'Hardware check-in': 'Last hardware check-in',
    'PWA authentication': 'Last app login',
    'PWA foreground activity': 'Last foreground activity',
    'Protected API request': 'Last protected activity',
    'Session start': 'Last session started',
    'Explicit logout': 'Last sign-out',
  }
  return titles[label] ?? label
}

function mapDevice(record: ApiDeviceRecord): Device {
  const signals = record.lastUsedSignals
  const signal = (label: string, at: string | null, source: string, icon: LucideIcon): ActivitySignal => ({
    label,
    value: formatRelativeTime(at),
    occurredAt: at,
    source,
    icon,
    ...(at === null && label === 'Explicit logout' ? { note: 'No logout event recorded' } : {}),
  })
  return {
    recordId: record.id,
    ownerUserId: record.ownerUserId,
    lifecycleState: record.lifecycleState,
    lastMdmSyncAt: signals.lastMdmCloudSyncAt,
    id: record.displayId,
    name: record.deviceName,
    kind: record.deviceType as DeviceKind,
    hardwareModel: record.deviceName,
    owner: record.ownerDisplayName,
    email: record.ownerEmail,
    workspace: record.workspaceName,
    approval: record.approvalState,
    compliance: record.complianceState === 'NonCompliant' ? 'Non-compliant' : record.complianceState,
    intuneId: record.mdmDeviceId,
    serial: record.maskedSerialNumber,
    platform: record.operatingSystem,
    version: record.operatingSystemVersion,
    enrolled: new Date(record.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    signals: [
      signal('MDM cloud sync', signals.lastMdmCloudSyncAt, signals.lastMdmCloudSyncSource, MonitorCog),
      signal('Hardware check-in', signals.lastHardwareDeviceCheckInAt, signals.lastHardwareDeviceCheckInSource, Laptop),
      signal('PWA authentication', signals.lastPwaAuthenticationAt, signals.lastPwaAuthenticationSource, Fingerprint),
      signal('PWA foreground activity', signals.lastPwaForegroundActivityAt, signals.lastPwaForegroundActivitySource, Activity),
      signal('Protected API request', signals.lastProtectedApiRequestAt, signals.lastProtectedApiRequestSource, LockKeyhole),
      signal('Session start', signals.lastSessionStartAt, signals.lastSessionStartSource, ArrowUpRight),
      signal('Explicit logout', signals.lastExplicitLogoutAt, signals.lastExplicitLogoutSource, LogOut),
    ],
  }
}

function mapAuditRecord(record: ApiAuditRecord): AuditEvent {
  const occurredAt = new Date(record.occurredAt)
  return {
    eventId: `EVT-${record.id.slice(0, 6).toUpperCase()}`,
    correlationId: record.correlationId,
    date: occurredAt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    time: occurredAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    actor: record.actorDisplayName,
    role: record.actorRole,
    action: record.action,
    target: record.targetDisplayName,
    outcome: record.outcome,
    reason: record.reason,
  }
}

function createDemoDevices(workspace: DemoWorkspace): Device[] {
  const timestamp = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const signal = (label: string, minutesAgo: number | null, source: string, icon: LucideIcon, note?: string): ActivitySignal => {
    const occurredAt = minutesAgo === null ? null : timestamp(minutesAgo)
    return {
      label,
      value: formatRelativeTime(occurredAt),
      occurredAt,
      source,
      icon,
      ...(note ? { note } : {}),
    }
  }
  const signals = () => [
    signal('MDM cloud sync', 10, 'Microsoft Intune', MonitorCog),
    signal('Hardware check-in', 12, 'Device inventory', Laptop),
    signal('PWA authentication', 20, 'Corporate identity provider', Fingerprint),
    signal('PWA foreground activity', 4, 'GateLogiq Workspace', Activity),
    signal('Protected API request', 5, 'Governance API', LockKeyhole),
    signal('Session start', 18, 'Corporate identity provider', ArrowUpRight),
    signal('Explicit logout', null, 'Corporate identity provider', LogOut, 'No logout event recorded'),
  ]
  const enrolled = new Date(Date.now() - 150 * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })

  return [
    {
      recordId: 'demo-device-sarah-ipad',
      id: 'DV-20468',
      name: "Sarah's Corporate iPad Pro",
      kind: 'Tablet',
      hardwareModel: 'iPad Pro 12.9-inch',
      ownerUserId: 'demo-user-sarah',
      lifecycleState: 'Active',
      lastMdmSyncAt: timestamp(10),
      owner: 'Sarah Mansoor',
      email: 'sarah.mansoor@acme.example',
      workspace,
      approval: 'Pending',
      compliance: 'Compliant',
      intuneId: 'INT-IPAD-9938',
      serial: 'FVF•••Q6K2',
      platform: 'iPadOS',
      version: '18.1',
      enrolled,
      signals: signals(),
    },
    {
      recordId: 'demo-device-thinkpad',
      id: 'DV-20459',
      name: 'ThinkPad X1 Carbon Gen 11',
      kind: 'Laptop',
      hardwareModel: 'ThinkPad X1 Carbon Gen 11',
      ownerUserId: 'demo-user-riley',
      lifecycleState: 'Active',
      lastMdmSyncAt: timestamp(8),
      owner: 'Riley Patel',
      email: 'riley.patel@acme.example',
      workspace,
      approval: 'Approved',
      compliance: 'Compliant',
      intuneId: 'INT-TPAD-7B03',
      serial: 'PF5•••0RK4',
      platform: 'Windows',
      version: '11 Pro 24H2',
      enrolled,
      signals: signals(),
    },
    {
      recordId: 'demo-device-galaxy-tab',
      id: 'DV-20511',
      name: 'Samsung Galaxy Tab Active4',
      kind: 'Tablet',
      hardwareModel: 'Galaxy Tab Active4',
      ownerUserId: 'demo-user-tariq',
      lifecycleState: 'Active',
      lastMdmSyncAt: timestamp(45),
      owner: 'Tariq Khalid',
      email: 'tariq.khalid@acme.example',
      workspace,
      approval: 'Pending',
      compliance: 'Non-compliant',
      intuneId: 'INT-TAB-4410',
      serial: 'R52•••A4M8',
      platform: 'Android',
      version: '14',
      enrolled,
      signals: signals(),
    },
  ]
}

function createDemoAudit(): AuditEvent[] {
  const entries = [
    ['10', 'DEVICE_SYNCED', 'Microsoft Intune', 'Inventory refreshed successfully.'],
    ['24', 'DEVICE_APPROVAL_REQUESTED', "Sarah's Corporate iPad Pro", 'PWA access requested by the assigned user.'],
    ['43', 'COMPLIANCE_CHECK', 'Samsung Galaxy Tab Active4', 'Disk encryption evidence needs attention.'],
    ['96', 'DEVICE_APPROVED', 'ThinkPad X1 Carbon Gen 11', 'Corporate device ownership verified.'],
  ] as const
  return entries.map(([minutesAgo, action, target, reason], index) => {
    const occurredAt = new Date(Date.now() - Number(minutesAgo) * 60_000)
    return {
      eventId: `DEMO-EVT-${String(index + 1).padStart(4, '0')}`,
      correlationId: `DEMO-CORR-${String(index + 1).padStart(4, '0')}`,
      date: occurredAt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      time: occurredAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      actor: 'GateLogiq Governance',
      role: 'System activity',
      action,
      target,
      outcome: action === 'COMPLIANCE_CHECK' ? 'Review' : 'Success',
      reason,
    }
  })
}

function createDemoAuditEvent(action: string, target: string, reason: string, scope?: string): AuditEvent {
  const occurredAt = new Date()
  const eventId = `DEMO-EVT-${occurredAt.getTime()}`
  return {
    eventId,
    correlationId: `DEMO-CORR-${occurredAt.getTime()}`,
    date: occurredAt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    time: occurredAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    actor: 'Customer IT Administrator',
    role: 'Demo action',
    action,
    target,
    outcome: 'Success',
    reason: `${reason} (local demo only; not sent to the backend)`,
    ...(scope ? { scope } : {}),
  }
}

function loadDemoWorkspaceData(tenant: string, workspace: DemoWorkspace): { devices: Device[]; audit: AuditEvent[] } {
  const seededDevices = createDemoDevices(workspace)
  const persisted = readPersistedDemoState(demoStateStorageKey(tenant, workspace))
  return {
    devices: persisted
      ? seededDevices.map((device) => {
        const saved = persisted.devices?.[device.recordId]
        if (!saved) return { ...device, approval: persisted.approvals?.[device.recordId] ?? device.approval }
        return {
          ...device,
          approval: saved.approval,
          lifecycleState: saved.lifecycleState,
          lastMdmSyncAt: saved.lastMdmSyncAt,
          signals: device.signals.map((signal) => signal.label === 'MDM cloud sync'
            ? { ...signal, occurredAt: saved.lastMdmSyncAt, value: formatRelativeTime(saved.lastMdmSyncAt) }
            : signal),
        }
      })
      : seededDevices,
    audit: persisted?.audit ?? createDemoAudit(),
  }
}

function downloadDemoAuditExport(events: AuditEvent[], format: 'csv' | 'json') {
  const columns: (keyof AuditEvent)[] = ['eventId', 'date', 'time', 'actor', 'role', 'scope', 'action', 'target', 'outcome', 'reason', 'correlationId']
  const csvField = (value: string) => {
    const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  const content = format === 'json'
    ? JSON.stringify(events, null, 2)
    : [columns.join(','), ...events.map((event) => columns.map((column) => csvField(String(event[column] ?? ''))).join(','))].join('\r\n')
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `device_governance_demo_audit.${format}`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function downloadDeviceInventoryExport(devices: Device[]) {
  const columns = ['Device ID', 'Device name', 'Owner', 'Email', 'Workspace', 'Platform', 'Approval', 'Compliance', 'Lifecycle']
  const field = (value: string) => {
    const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  const rows = devices.map((device) => [
    device.id, device.name, device.owner, device.email, device.workspace, device.platform,
    device.approval, device.compliance, device.lifecycleState,
  ])
  const content = [columns, ...rows].map((row) => row.map(field).join(',')).join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = 'device_governance_inventory.csv'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

const navSections: { title: string; links: { label: string; screen: Screen; icon: LucideIcon; badge?: 'pending' | 'alerts' }[] }[] = [
  {
    title: 'Overview',
    links: [
      { label: 'Dashboard', screen: 'dashboard', icon: ShieldCheck },
    ],
  },
  {
    title: 'Device governance',
    links: [
      { label: 'Device inventory', screen: 'devices', icon: Smartphone },
      { label: 'Approvals', screen: 'approvals', icon: CheckCircle2, badge: 'pending' },
      { label: 'Compliance', screen: 'compliance', icon: ShieldAlert },
      { label: 'Device activity', screen: 'signals', icon: Activity },
    ],
  },
  {
    title: 'Application security',
    links: [
      { label: 'Applications', screen: 'applications', icon: Package },
      { label: 'PWA Access Control', screen: 'access', icon: ShieldCheck },
      { label: 'Remote Commands', screen: 'commands', icon: LockKeyhole },
    ],
  },
  {
    title: 'Operations',
    links: [
      { label: 'MDM Integrations', screen: 'intune', icon: RefreshCw },
      { label: 'Audit log', screen: 'audit', icon: FileClock },
      { label: 'Alerts', screen: 'alerts', icon: Bell, badge: 'alerts' },
      { label: 'Reports', screen: 'reports', icon: Download },
    ],
  },
  {
    title: 'Administration',
    links: [
      { label: 'Tenant & Workspace', screen: 'scope', icon: Users },
      { label: 'Users & Roles', screen: 'identity', icon: Fingerprint },
      { label: 'Settings', screen: 'settings', icon: MonitorCog },
    ],
  },
]

type StatusTone = 'pending' | 'approved' | 'rejected' | 'compliant' | 'noncompliant' | 'stale' | 'success' | 'denied' | 'review'

const statusHelp: Record<StatusTone, string> = {
  pending: 'Waiting for an administrator to review this request.',
  approved: 'Approved for access; the device must still meet security rules.',
  rejected: 'This access request was declined.',
  compliant: 'The device meets the current security rules.',
  noncompliant: 'The device does not meet one or more security rules.',
  stale: 'The device security information may be out of date.',
  success: 'This action completed successfully.',
  denied: 'Access was blocked by the security check.',
  review: 'This item needs a closer look.',
}

const auditActionNames: Record<string, string> = {
  DEVICE_SYNCED: 'Device list updated',
  DEVICE_APPROVAL_REQUESTED: 'Access request received',
  COMPLIANCE_CHECK: 'Security check',
  DEVICE_APPROVED: 'Device approved',
  DEVICE_REJECTED: 'Device request rejected',
  PWA_ACCESS_ALLOWED: 'App access allowed',
  PWA_ACCESS_BLOCKED: 'App access blocked',
  DEMO_SYNC_REQUESTED: 'Device sync requested',
  DEMO_REMOTE_LOCK: 'Lock action recorded',
  DEMO_REMOTE_RETIRE: 'Device retirement recorded',
  DEMO_REMOTE_WIPE: 'Wipe request recorded',
  AUDIT_EXPORT_GENERATED: 'Activity report exported',
}

function friendlyAuditAction(action: string) {
  const knownName = auditActionNames[action]
  if (knownName) return knownName
  return action.replace(/_/g, ' ').toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function StatusPill({ children, tone, title }: { children: string; tone: StatusTone; title?: string }) {
  return <span className={`status-pill status-${tone}`} title={title ?? statusHelp[tone]}><span className="status-dot" />{children}</span>
}

function lifecycleHelp(state: string) {
  switch (state) {
    case 'Active': return 'This device is active in the selected workspace.'
    case 'Suspended': return 'Workspace access is temporarily blocked for this device.'
    case 'Retired': return 'This device is marked as retired.'
    case 'WipeIssued': return 'A wipe action was recorded; this demo does not erase the physical device.'
    default: return 'Current device lifecycle status.'
  }
}

function DeviceGlyph({ kind }: { kind: DeviceKind }) {
  const Icon = kind === 'Laptop' ? Laptop : kind === 'Phone' ? Smartphone : MonitorCog
  return <span className={`device-glyph glyph-${kind.toLowerCase()}`}><Icon size={18} strokeWidth={1.8} /></span>
}

function LoginPage({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState('alex.mercer@acmecorp.com')
  const [password, setPassword] = useState('')
  const [helpMessage, setHelpMessage] = useState('')

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSignIn(email.trim())
  }

  return <main className="login-screen" aria-current="page">
    <div className="login-glow login-glow-left" />
    <div className="login-glow login-glow-right" />
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand-mark"><ShieldCheck size={25} strokeWidth={1.9} /></div>
      <div className="login-brand-name">GateLogiq <span>DEVICE GOVERNANCE</span></div>
      <div className="login-heading"><h1 id="login-title">Sign in to your account</h1><p>Explore sample device, access, and activity records.</p></div>
      <form className="login-form" onSubmit={submit}>
        <label className="login-field"><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="username" required /></label>
        <label className="login-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /></label>
        <div className="login-options">
          <button type="button" className="forgot-password" title="Password reset is not available in the demo." onClick={() => setHelpMessage('Password reset isn’t available in the demo.')}>Forgot password?</button>
        </div>
        {helpMessage && <p className="login-help-message" role="status">{helpMessage}</p>}
        <button className="login-submit" type="submit">Sign In</button>
      </form>
      <p className="login-demo-notice">Demo sign-in · Enter an email and any password to explore.</p>
    </section>
  </main>
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(true)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [auditSearchRequest, setAuditSearchRequest] = useState({ query: '', version: 0 })
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [demoWorkspace, setDemoWorkspace] = useState<DemoWorkspace>('Engineering')
  const demoWorkspaceRef = useRef<DemoWorkspace>('Engineering')
  demoWorkspaceRef.current = demoWorkspace
  const [demoDataScope, setDemoDataScope] = useState<{ tenant: string; workspace: DemoWorkspace } | null>(null)
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [deviceInventoryFilter, setDeviceInventoryFilter] = useState<DeviceInventoryFilter>('all')
  const [devices, setDevices] = useState<Device[]>([])
  const [applications, setApplications] = useState<ManagedApplication[]>(sampleApplications)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [reviewDeviceId, setReviewDeviceId] = useState<string | null>(null)
  const [tenant, setTenant] = useState('Acme Corporation')
  const [workspace, setWorkspace] = useState('Production')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [apiError, setApiError] = useState('')
  const [connectionRetryMessage, setConnectionRetryMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [exportingAudit, setExportingAudit] = useState(false)
  const [remoteCommandDevice, setRemoteCommandDevice] = useState<Device | null>(null)
  const [remoteCommandInitial, setRemoteCommandInitial] = useState<RemoteCommand>('LOCK')
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const notificationMenuRef = useRef<HTMLDivElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const helpCloseButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setIsLoading(true)
    setApiError('')
    setConnectionRetryMessage('')
    if (!isDemoMode) {
      setDevices([])
      setAudit([])
    }
    const loadGovernanceData = async () => {
      try {
        const scope = getApiScope(tenant, workspace)
        const [deviceRecords, auditRecords] = await Promise.all([getDevices(scope), getAuditRecords(scope)])
        if (cancelled) return
        const mappedDevices = deviceRecords.map(mapDevice)
        setDevices(mappedDevices)
        setAudit(auditRecords.map(mapAuditRecord))
        setIsDemoMode(false)
        setDemoDataScope(null)
        setSelectedDeviceId((current) => mappedDevices.some((device) => device.recordId === current)
          ? current
          : mappedDevices[0]?.recordId ?? '')
      } catch (error) {
        if (cancelled) return
        if (error instanceof TypeError) {
          const fallbackWorkspace = demoWorkspaceRef.current
          let sampleDevices: Device[]
          let sampleAudit: AuditEvent[]
          try {
            const demoData = loadDemoWorkspaceData(tenant, fallbackWorkspace)
            sampleDevices = demoData.devices
            sampleAudit = demoData.audit
            setApiError('')
          } catch (storageError) {
            console.error('Unable to restore saved demo data.', storageError)
            sampleDevices = createDemoDevices(fallbackWorkspace)
            sampleAudit = createDemoAudit()
            setApiError('Saved demo data could not be restored; the initial sample data is shown.')
          }
          setDevices(sampleDevices)
          setAudit(sampleAudit)
          setDemoDataScope({ tenant, workspace: fallbackWorkspace })
          setSelectedDeviceId(sampleDevices[0]?.recordId ?? '')
          setUserEmail(getDemoProfileEmail(tenant))
          setIsDemoMode(true)
          setConnectionRetryMessage(reloadToken > 0 ? 'We couldn’t reach the live service. Sample data is still available, and changes stay in this browser.' : '')
        } else {
          setIsDemoMode(false)
          setDemoDataScope(null)
          setConnectionRetryMessage(reloadToken > 0 ? 'The live service returned an error. Please review the message below.' : '')
          setApiError('We couldn’t load the live records. Please try again; sample data wasn’t substituted.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void loadGovernanceData()
    return () => { cancelled = true }
  }, [isAuthenticated, tenant, workspace, reloadToken])

  useEffect(() => {
    if (!isAuthenticated || !isDemoMode || isLoading || !demoDataScope
      || demoDataScope.tenant !== tenant || demoDataScope.workspace !== demoWorkspace) return
    try {
      persistDemoState(demoStateStorageKey(tenant, demoWorkspace), devices, audit)
    } catch (storageError) {
      console.error('Unable to save demo data.', storageError)
      setApiError('Local demo changes could not be saved in this browser.')
    }
  }, [isAuthenticated, isDemoMode, isLoading, demoDataScope, tenant, demoWorkspace, devices, audit])

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (profileMenuRef.current && event.target instanceof Node && !profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  useEffect(() => {
    if (!isNotificationsOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (notificationMenuRef.current && event.target instanceof Node && !notificationMenuRef.current.contains(event.target)) {
        setIsNotificationsOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isNotificationsOpen])

  useEffect(() => {
    if (!isHelpOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsHelpOpen(false)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    helpCloseButtonRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      helpButtonRef.current?.focus()
    }
  }, [isHelpOpen])

  useEffect(() => {
    if (!isAuthenticated) return
    const handleGlobalKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false)
        setIsNotificationsOpen(false)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsNotificationsOpen(false)
        setSearchQuery('')
        setIsSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleGlobalKeys)
    return () => document.removeEventListener('keydown', handleGlobalKeys)
  }, [isAuthenticated])

  const pendingCount = devices.filter((device) => device.approval === 'Pending').length
  const selectedDevice = devices.find((device) => device.recordId === selectedDeviceId) ?? devices[0]
  const reviewDevice = devices.find((device) => device.id === reviewDeviceId) ?? null
  const latestMdmSyncAt = devices.reduce<string | null>((latest, device) => {
    const current = device.lastMdmSyncAt
    return current && (!latest || new Date(current) > new Date(latest)) ? current : latest
  }, null)
  const isMdmSyncFresh = devices.length > 0 && devices.every((device) =>
    device.lastMdmSyncAt !== null && Date.now() - new Date(device.lastMdmSyncAt).getTime() <= 60 * 60_000)
  const syncStatusClass = isDemoMode ? 'sync-mini-demo' : isMdmSyncFresh ? 'sync-mini-current' : ''
  const visibleWorkspace = isDemoMode ? demoWorkspace : workspace
  const screenTitle: Record<Screen, string> = {
    dashboard: 'Dashboard',
    devices: 'Device inventory',
    approvals: 'Approvals',
    compliance: 'Compliance',
    applications: 'Applications',
    intune: 'MDM Integrations',
    signals: 'Device activity',
    audit: 'Audit log',
    alerts: 'Alerts',
    reports: 'Reports',
    settings: 'Settings',
    identity: 'User and Role Administration',
    scope: 'Tenant and Workspace Management',
    access: 'PWA Access Control',
    commands: 'Remote Command Console',
    detail: 'Device details',
  }
  const searchTerm = searchQuery.trim().toLowerCase()
  const matchingModules = searchTerm
    ? navSections.flatMap(({ links }) => links).filter(({ label, screen: target }) =>
      `${label} ${screenTitle[target]}`.toLowerCase().includes(searchTerm))
    : []
  const matchingDevices = searchTerm
    ? devices.filter((device) =>
      `${device.name} ${device.owner} ${device.email} ${device.id} ${device.platform} ${device.version} ${device.workspace}`.toLowerCase().includes(searchTerm))
    : []
  const matchingAuditEvents = searchTerm
    ? audit.filter((event) =>
      `${event.actor} ${event.action} ${event.target} ${event.correlationId} ${event.eventId} ${event.reason} ${event.scope ?? ''}`
        .toLowerCase().includes(searchTerm)).slice(0, 5)
    : []
  const notifications: PortalNotification[] = []
  if (isDemoMode) {
    notifications.push({
      id: `demo-offline:${tenant}:${visibleWorkspace}`,
      icon: '⚠️',
      title: 'Demo mode active',
      description: 'Live backend is unavailable; this view uses sample data.',
      screen: 'intune',
    })
  } else if (!isMdmSyncFresh) {
    notifications.push({
      id: `sync-delayed:${tenant}:${workspace}`,
      icon: '⚠️',
      title: 'Intune sync needs attention',
      description: latestMdmSyncAt
        ? `Last device sync was ${formatCompactRelativeTime(latestMdmSyncAt)}.`
        : 'No device synchronization timestamp is available.',
      screen: 'intune',
    })
  }
  devices.filter((device) => device.approval === 'Pending').forEach((device) => {
    notifications.push({
      id: `approval:${device.recordId}`,
      icon: '📱',
      title: 'Approval required',
      description: `${device.name} · ${device.owner} is awaiting a decision.`,
      screen: 'approvals',
      deviceId: device.recordId,
    })
  })
  devices.filter((device) => device.compliance !== 'Compliant').forEach((device) => {
    notifications.push({
      id: `compliance:${device.recordId}`,
      icon: '🛡️',
      title: 'Compliance posture alert',
      description: `${device.name} is ${device.compliance.toLowerCase()}.`,
      screen: 'compliance',
      deviceId: device.recordId,
    })
  })
  audit.filter((event) => event.outcome === 'Denied' || event.outcome === 'Review').slice(0, 3).forEach((event) => {
    notifications.push({
      id: `audit:${event.eventId}`,
      icon: '🧾',
      title: 'Activity needs review',
      description: `${friendlyAuditAction(event.action)} · ${event.target}`,
      screen: 'audit',
      auditSearch: event.correlationId,
    })
  })

  async function openDevice(device: Device) {
    setReviewDeviceId(null)
    setSelectedDeviceId(device.recordId)
    setScreen('detail')
    if (isDemoMode) {
      setDetailLoading(false)
      return
    }
    setDetailLoading(true)
    try {
      const record = await getDevice(getApiScope(tenant, workspace), device.recordId)
      const detailedDevice = mapDevice(record)
      setDevices((current) => current.map((item) => item.recordId === detailedDevice.recordId ? detailedDevice : item))
      setSelectedDeviceId(detailedDevice.recordId)
      setApiError('')
    } catch (error) {
      setApiError('Could not load this device record. No changes were made.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function submitDecision(decision: 'Approved' | 'Rejected', justification: string) {
    if (!reviewDevice || !justification.trim()) return
    if (isDemoMode) {
      setDevices((current) => current.map((device) =>
        device.recordId === reviewDevice.recordId ? { ...device, approval: decision } : device))
      setAudit((current) => [createDemoAuditEvent(
        decision === 'Approved' ? 'DEVICE_APPROVED' : 'DEVICE_REJECTED',
        reviewDevice.name,
        justification.trim(),
        `${tenant} / ${demoWorkspace}`,
      ), ...current])
      setReviewDeviceId(null)
      setNotice(`Demo action: ${reviewDevice.name} locally marked ${decision.toLowerCase()}. No server-side decision was made.`)
      window.setTimeout(() => setNotice(''), 5000)
      return
    }
    await submitDeviceDecision(getApiScope(tenant, workspace), reviewDevice.recordId, decision, justification.trim())
    setReviewDeviceId(null)
    setNotice(`${reviewDevice.name} ${decision.toLowerCase()}. Audit event recorded.`)
    setReloadToken((current) => current + 1)
    window.setTimeout(() => setNotice(''), 4200)
  }

  async function testPwaAccess(device: Device, requestedAppId: string): Promise<AccessEvaluationResponse> {
    if (isDemoMode) {
      const allowed = device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active'
      const evaluatedAt = new Date()
      const reasonCode = allowed
        ? 'DEMO_POLICY_PASSED'
        : device.approval !== 'Approved'
          ? 'DEVICE_NOT_APPROVED'
          : device.compliance !== 'Compliant'
            ? 'DEVICE_NON_COMPLIANT'
            : 'DEVICE_LIFECYCLE_INACTIVE'
      setAudit((current) => [createDemoAuditEvent(
        allowed ? 'PWA_ACCESS_ALLOWED' : 'PWA_ACCESS_BLOCKED',
        device.name,
        `Local demo evaluation for ${requestedAppId}`,
      ), ...current])
      return {
        decision: allowed ? 'ALLOW' : 'DENY',
        reasonCode,
        correlationId: `DEMO-CORR-${evaluatedAt.getTime()}`,
        evaluatedAt: evaluatedAt.toISOString(),
        grant: allowed ? {
          token: `DEMO-GRANT-${evaluatedAt.getTime()}`,
          expiresAt: new Date(evaluatedAt.getTime() + 15 * 60_000).toISOString(),
          scopes: ['workspace:read'],
        } : null,
      }
    }
    const scope = getApiScope(tenant, workspace)
    const result = await evaluatePwaAccess(scope, {
      deviceId: device.recordId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: device.ownerUserId,
      requestedAppId,
    })
    setReloadToken((current) => current + 1)
    return result
  }

  async function runIntuneSync() {
    setIsSyncing(true)
    setApiError('')
    try {
      if (isDemoMode) {
        const syncedAt = new Date().toISOString()
        setDevices((current) => current.map((device) => ({
          ...device,
          lastMdmSyncAt: syncedAt,
          signals: device.signals.map((signal) => signal.label === 'MDM cloud sync'
            ? { ...signal, occurredAt: syncedAt, value: 'Just now' }
            : signal),
        })))
        setAudit((current) => [createDemoAuditEvent('DEMO_SYNC_REQUESTED', 'Microsoft Intune', 'Inventory refresh simulated locally'), ...current])
        setNotice('Demo sync completed locally. No Intune synchronization was performed.')
        window.setTimeout(() => setNotice(''), 5000)
        return
      }
      const result = await syncIntune(getApiScope(tenant, workspace))
      setNotice(`Intune sync completed. ${result.devicesSynced} device(s) refreshed; audit event recorded.`)
      setReloadToken((current) => current + 1)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setApiError('We couldn’t confirm the sync. No successful update was recorded.')
    } finally {
      setIsSyncing(false)
    }
  }

  async function runRemoteCommand(command: RemoteCommand, reason: string) {
    if (!remoteCommandDevice) return
    const device = remoteCommandDevice
    if (isDemoMode) {
      const lifecycleState = command === 'LOCK' ? 'Suspended' : command === 'RETIRE' ? 'Retired' : 'WipeIssued'
      setDevices((current) => current.map((item) =>
        item.recordId === device.recordId ? { ...item, lifecycleState } : item))
      setAudit((current) => [createDemoAuditEvent(`DEMO_REMOTE_${command}`, device.name, reason), ...current])
      setRemoteCommandDevice(null)
      setNotice(`Demo action: ${command} simulated for ${device.name}. No device command was sent.`)
      window.setTimeout(() => setNotice(''), 5000)
      return
    }
    const result = await submitRemoteCommand(getApiScope(tenant, workspace), device.recordId, command, reason)
    setRemoteCommandDevice(null)
    setNotice(`${command} command issued for ${device.name}. Lifecycle: ${result.lifecycleState}. Audit event recorded.`)
    setReloadToken((current) => current + 1)
    window.setTimeout(() => setNotice(''), 5000)
  }

  async function exportAudit(format: 'csv' | 'json') {
    setExportingAudit(true)
    setApiError('')
    try {
      if (isDemoMode) {
        downloadDemoAuditExport(audit, format)
        setNotice(`Demo audit ${format.toUpperCase()} export downloaded. Sample records only.`)
        window.setTimeout(() => setNotice(''), 5000)
        return
      }
      await downloadAuditExport(getApiScope(tenant, workspace), format)
      setNotice(`Audit ${format.toUpperCase()} export downloaded. Export event recorded.`)
      setReloadToken((current) => current + 1)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setApiError('We couldn’t download the audit file. No export was completed.')
    } finally {
      setExportingAudit(false)
    }
  }

  function openRemoteCommand(device: Device, initialCommand: RemoteCommand = 'LOCK') {
    setRemoteCommandDevice(device)
    setRemoteCommandInitial(initialCommand)
  }

  function switchDemoWorkspace(next: DemoWorkspace) {
    demoWorkspaceRef.current = next
    setDemoWorkspace(next)
    let demoData: { devices: Device[]; audit: AuditEvent[] }
    try {
      demoData = loadDemoWorkspaceData(tenant, next)
      setApiError('')
    } catch (storageError) {
      console.error('Unable to restore saved demo data.', storageError)
      demoData = { devices: createDemoDevices(next), audit: createDemoAudit() }
      setApiError('Saved demo data could not be restored; the initial sample data is shown.')
    }
    setDevices(demoData.devices)
    setAudit(demoData.audit)
    setDemoDataScope({ tenant, workspace: next })
    setSelectedDeviceId(demoData.devices[0]?.recordId ?? '')
    setReviewDeviceId(null)
    setNotice(`Demo workspace switched to ${next}.`)
    window.setTimeout(() => setNotice(''), 4000)
  }

  function switchTenant(nextTenant: string) {
    setTenant(nextTenant)
    if (!isDemoMode) return
    setUserEmail(getDemoProfileEmail(nextTenant))
    let demoData: { devices: Device[]; audit: AuditEvent[] }
    try {
      demoData = loadDemoWorkspaceData(nextTenant, demoWorkspace)
      setApiError('')
    } catch (storageError) {
      console.error('Unable to restore saved demo data.', storageError)
      demoData = { devices: createDemoDevices(demoWorkspace), audit: createDemoAudit() }
      setApiError('Saved demo data could not be restored; the initial sample data is shown.')
    }
    setDevices(demoData.devices)
    setAudit(demoData.audit)
    setDemoDataScope({ tenant: nextTenant, workspace: demoWorkspace })
    setSelectedDeviceId(demoData.devices[0]?.recordId ?? '')
    setReviewDeviceId(null)
  }

  function resetDemoData() {
    if (!isDemoMode) return
    try {
      window.localStorage.removeItem(demoStateStorageKey(tenant, demoWorkspace))
    } catch (storageError) {
      console.error('Unable to clear saved demo data.', storageError)
      setApiError('Saved demo data could not be cleared in this browser.')
      return
    }
    const sampleDevices = createDemoDevices(demoWorkspace)
    setDevices(sampleDevices)
    setAudit(createDemoAudit())
    setSelectedDeviceId(sampleDevices[0]?.recordId ?? '')
    setReviewDeviceId(null)
    setApiError('')
    setNotice('Demo data has been restored to its initial state.')
    window.setTimeout(() => setNotice(''), 5000)
  }

  function navigate(next: Screen, deviceFilter: DeviceInventoryFilter = 'all') {
    if (next === 'devices') setDeviceInventoryFilter(deviceFilter)
    setScreen(next)
    setMobileNavOpen(false)
  }

  function openNotification(notification: PortalNotification) {
    if (notification.deviceId) {
      const device = devices.find((item) => item.recordId === notification.deviceId)
      if (device) {
        setSelectedDeviceId(device.recordId)
        if (notification.screen === 'approvals') setReviewDeviceId(device.id)
      }
    }
    if (notification.auditSearch) requestAuditSearch(notification.auditSearch)
    navigate(notification.screen)
    setIsNotificationsOpen(false)
  }

  function requestAuditSearch(query: string) {
    setAuditSearchRequest((current) => ({ query, version: current.version + 1 }))
  }

  function signOut() {
    setProfileMenuOpen(false)
    setIsNotificationsOpen(false)
    setIsSearchOpen(false)
    setIsAuthenticated(false)
    setUserEmail('')
  }

  if (!isAuthenticated) return <LoginPage onSignIn={(email) => { setUserEmail(email); setIsAuthenticated(true) }} />

  return (
    <div className="app-shell app-shell-enter">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><ShieldCheck size={19} strokeWidth={2.2} /></div>
          <div><span className="brand-name">GateLogiq</span><span className="brand-product">DEVICE GOVERNANCE</span></div>
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
        </div>
        {screen !== 'scope' && <>
          <div className="tenant-switcher">
            <span className="tenant-avatar">{tenant === 'Northwind Health' ? 'NH' : tenant === 'Contoso Group' ? 'CG' : 'AC'}</span>
            <label className="select-stack"><span>Tenant</span><select value={tenant} onChange={(event) => switchTenant(event.target.value)} aria-label="Tenant"><option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option></select></label>
            <ChevronDown size={15} className="select-chevron" />
          </div>
          <div className="workspace-switcher">
            <span className="workspace-label">WORKSPACE</span>
            <label className="workspace-select"><span className="workspace-indicator" /><select value={visibleWorkspace} onChange={(event) => isDemoMode
              ? switchDemoWorkspace(event.target.value as DemoWorkspace)
              : setWorkspace(event.target.value)} aria-label="Workspace">
              {isDemoMode
                ? ['Engineering', 'Operations UAE', 'Field Logistics'].map((name) => <option key={name}>{name}</option>)
                : ['Production', 'Engineering', 'Corporate'].map((name) => <option key={name}>{name}</option>)}
            </select><ChevronDown size={14} /></label>
          </div>
        </>}
        <nav className="primary-nav" aria-label="Primary navigation">
          {navSections.map((section) => <div className="nav-group" key={section.title}>
            <div className="nav-heading">{section.title}</div>
            {section.links.map(({ label, screen: target, icon: Icon, badge }) => {
              const isActive = target === screen || (screen === 'detail' && target === 'devices')
              return <button
                className={`nav-link ${isActive ? 'nav-active' : ''}`}
                key={label}
                onClick={() => navigate(target)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  size={17}
                  strokeWidth={1.8}
                  className={isActive ? 'text-white' : 'text-slate-500'}
                  style={isActive ? { color: '#ffffff', stroke: '#ffffff' } : undefined}
                />
                  <span>{label}</span>
                  {badge && (badge === 'pending' ? pendingCount : notifications.length) > 0
                    && <span className="nav-badge">{badge === 'pending' ? pendingCount : notifications.length}</span>}
              </button>
            })}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-mini ${syncStatusClass}`} role="status" title={isDemoMode ? 'Sample timestamps only; there is no live Intune connection.' : isMdmSyncFresh ? 'The latest live device sync is recent.' : 'The latest live device sync is more than 60 minutes old.'}>
            <span className="sync-mini-dot" aria-hidden="true" />
            <span>{isDemoMode
              ? 'MDM Sync: Simulated (Demo Data)'
              : `MDM Sync: ${isMdmSyncFresh ? 'Healthy' : 'Delayed'} (${formatCompactRelativeTime(latestMdmSyncAt) ?? '—'})`}</span>
          </div>
          <div className="profile-menu-wrapper" ref={profileMenuRef}>
            <button type="button" className="profile-row" aria-label="Open user profile details" aria-haspopup="dialog" aria-expanded={profileMenuOpen} aria-controls="profile-details" onClick={() => setProfileMenuOpen((open) => !open)}>
              <span className="profile-avatar">IT</span><span className="profile-copy"><strong title={userEmail}>{userEmail}</strong><small>Customer IT Administrator</small></span><MoreHorizontal size={18} />
            </button>
            {profileMenuOpen && <div className="profile-popover" id="profile-details" role="dialog" aria-label="User profile details">
              <div className="profile-popover-details"><span className="profile-popover-avatar">IT</span><span className="profile-popover-copy"><strong>{userEmail}</strong><small>{isDemoMode ? 'Demo session · sample profile' : 'Active portal session'}</small><span className="profile-role-badge">Customer IT Administrator</span></span></div>
            </div>}
          </div>
        </div>
      </aside>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" title="Open the module menu" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{tenant}</span><ChevronRight size={14} /><strong>{screenTitle[screen]}</strong></div>
          <div className="topbar-actions">
            <button className="global-search" type="button" onClick={() => { setSearchQuery(''); setIsSearchOpen(true) }} aria-label="Search devices, users, and modules" title="Search devices, people, modules, and audit activity in this workspace."><Search size={16} /><span>Search anything</span><kbd>Ctrl K</kbd></button>
            <button
              ref={helpButtonRef}
              className="icon-button topbar-help"
              type="button"
              aria-label="Help"
              title="Open the Quick Guide."
              aria-haspopup="dialog"
              aria-expanded={isHelpOpen}
              aria-controls="help-dialog"
              onClick={() => {
                setIsSearchOpen(false)
                setIsNotificationsOpen(false)
                setIsHelpOpen(true)
              }}
            ><CircleHelp size={18} /></button>
            <div className="notification-anchor" ref={notificationMenuRef}>
              <button
                className="icon-button notification-button"
                type="button"
                aria-label="Notifications"
                title="View recent updates for this workspace."
                aria-haspopup="dialog"
                aria-expanded={isNotificationsOpen}
                aria-controls="notification-menu"
                onClick={() => setIsNotificationsOpen((open) => !open)}
              >
                <Bell size={18} />
                {hasUnreadNotifications && notifications.length > 0 && <span />}
              </button>
              {isNotificationsOpen && <section className="notification-menu" id="notification-menu" role="dialog" aria-label="Notifications">
                <header className="notification-menu-header">
                  <h2>Notifications</h2>
                  <button type="button" onClick={() => setHasUnreadNotifications(false)} disabled={!hasUnreadNotifications || notifications.length === 0}>Mark as read</button>
                </header>
                <div className="notification-list">
                  {notifications.length === 0
                    ? <p className="notification-empty">You’re all caught up for {tenant} / {visibleWorkspace}.</p>
                    : notifications.map((notification) => <button
                      type="button"
                      className="notification-item notification-action"
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                    >
                      <span className="notification-emoji" aria-hidden="true">{notification.icon}</span>
                      <span><strong>{notification.title}</strong><small>{notification.description}</small></span>
                      <ChevronRight size={16} />
                    </button>)}
                </div>
              </section>}
            </div>
            <div className="topbar-account"><span className="profile-avatar">IT</span><button className="sign-out-button" aria-label="Sign Out" onClick={signOut}><LogOut size={14} /><span>Sign Out</span></button></div>
          </div>
        </header>

        <main className="page-content">
          {isDemoMode
            ? <details className="connection-banner connection-banner-demo" aria-label="Sample data status">
              <summary className="connection-demo-summary">
                <span className="connection-banner-icon"><MonitorCog size={18} /></span>
                <span className="connection-demo-copy"><strong>Demo data</strong><small>{connectionRetryMessage ? 'Live connection unavailable · Sample records' : 'Sample records · Actions stay in this browser'}</small></span>
                <span className="connection-demo-toggle">Why am I seeing this?</span><ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="connection-banner-details">
                <p>{connectionRetryMessage || 'The live service is unavailable. This workspace uses sample records; changes stay in this browser and no real devices are changed.'}</p>
                <div className="connection-banner-actions">
                  <button className="button button-secondary" title="Try loading live records again." onClick={() => setReloadToken((current) => current + 1)} disabled={isLoading}>Retry connection</button>
                  <button className="button button-secondary" title="Restore the original sample records in this browser." onClick={resetDemoData}>Reset sample data</button>
                </div>
              </div>
            </details>
            : <div className="connection-banner" role="status">
              <span className="connection-banner-icon"><ShieldCheck size={18} /></span>
              <div><strong>{isLoading ? 'Loading your workspace…' : (connectionRetryMessage || apiError) ? 'A service request needs attention' : 'Governance data connected'}</strong>
                <span>{connectionRetryMessage || apiError || (isLoading ? 'Loading the selected tenant and workspace.' : `Last device sync: ${formatRelativeTime(latestMdmSyncAt) ?? 'not recorded'}.`)}</span>
              </div>
            </div>}

          {apiError && <div className="friendly-error" role="alert"><AlertTriangle size={17} /><span>{apiError}</span><button type="button" aria-label="Dismiss message" onClick={() => setApiError('')}><X size={15} /></button></div>}
          {isLoading && <div className="loading-state" role="status">Loading devices in {visibleWorkspace}…</div>}

          {screen === 'dashboard' && <DashboardPage devices={devices} audit={audit} alertCount={notifications.length} tenant={tenant} workspace={visibleWorkspace} onNavigate={navigate} />}
          {screen === 'identity' && <IdentityRolesPage email={userEmail} tenant={tenant} workspace={visibleWorkspace} isDemoMode={isDemoMode} />}
          {screen === 'scope' && <WorkspaceTenantsPage tenant={tenant} workspace={visibleWorkspace} isDemoMode={isDemoMode} demoWorkspace={demoWorkspace} onTenantChange={switchTenant} onWorkspaceChange={(next) => isDemoMode ? switchDemoWorkspace(next as DemoWorkspace) : setWorkspace(next)} />}
          {screen === 'approvals' && <ApprovalsPage devices={devices} workspace={visibleWorkspace} isDemoMode={isDemoMode} onReview={(device) => setReviewDeviceId(device.id)} />}
          {screen === 'devices' && <DevicesPage devices={devices} isDemoMode={isDemoMode} initialFilter={deviceInventoryFilter} onOpenDevice={openDevice} />}
          {screen === 'intune' && <IntunePage devices={devices} latestSyncAt={latestMdmSyncAt} syncIsFresh={isMdmSyncFresh} isSyncing={isSyncing} isDemoMode={isDemoMode} onSync={() => void runIntuneSync()} />}
          {screen === 'compliance' && <CompliancePage devices={devices} isDemoMode={isDemoMode} onOpenDevice={openDevice} />}
          {screen === 'applications' && <ApplicationsPage applications={applications} isDemoMode={isDemoMode} onAdd={(application) => setApplications((current) => [application, ...current])} onOpenAccessTest={() => navigate('access')} />}
          {screen === 'detail' && detailLoading && <div className="loading-state" role="status">Loading device details…</div>}
          {screen === 'detail' && !detailLoading && selectedDevice && <DeviceDetail device={selectedDevice} onBack={() => navigate('devices')} onRemoteCommand={openRemoteCommand} />}
          {screen === 'detail' && !detailLoading && !selectedDevice && <div className="executive-empty detail-empty" role="status">
            <p>This device isn’t available in the selected workspace.</p>
            <button type="button" className="button button-secondary" onClick={() => navigate('devices')}>Back to Devices</button>
          </div>}
          {screen === 'audit' && <AuditPage events={audit} isDemoMode={isDemoMode} onExport={exportAudit} exporting={exportingAudit} initialSearch={auditSearchRequest.query} searchRequestVersion={auditSearchRequest.version} />}
          {screen === 'access' && <PwaAccessPage devices={devices} applications={applications} isDemoMode={isDemoMode} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} onEvaluate={testPwaAccess} />}
          {screen === 'signals' && <SignalsPage devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />}
          {screen === 'commands' && <RemoteCommandsPage devices={devices} isDemoMode={isDemoMode} onRemoteCommand={openRemoteCommand} />}
          {screen === 'alerts' && <AlertsPage alerts={notifications} hasUnread={hasUnreadNotifications} onMarkRead={() => setHasUnreadNotifications(false)} onOpen={openNotification} />}
          {screen === 'reports' && <ReportsPage devices={devices} audit={audit} isDemoMode={isDemoMode} exportingAudit={exportingAudit} onExportAudit={exportAudit} onExportInventory={() => downloadDeviceInventoryExport(devices)} />}
          {screen === 'settings' && <SettingsPage onNavigate={navigate} />}
        </main>
        <footer className="page-footer"><span>GateLogiq Device Governance</span><span>Tenant scope: {tenant} <i /> Workspace: {visibleWorkspace}</span></footer>
      </div>

      {isSearchOpen && <div className="modal-backdrop search-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsSearchOpen(false) }}>
        <section className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
          <header className="search-dialog-header">
            <div><Search size={19} /><h2 id="global-search-title">Search</h2></div>
            <button className="icon-button" type="button" aria-label="Close search" onClick={() => setIsSearchOpen(false)}><X size={18} /></button>
          </header>
          <label className="global-search-input">
            <Search size={18} />
            <input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search devices, users, modules, or audit logs..."
              aria-label="Search devices, users, modules, or audit logs"
            />
            <kbd>ESC</kbd>
          </label>
          <div className="global-search-results" aria-live="polite">
            {!searchTerm && <p className="global-search-hint">Search devices, assigned users, modules, or audit activity in the selected scope.</p>}
            {searchTerm && matchingModules.length === 0 && matchingDevices.length === 0 && matchingAuditEvents.length === 0 && <p className="global-search-hint">No devices, modules, or audit events match “{searchQuery.trim()}”.</p>}
            {matchingModules.length > 0 && <>
              <h3>Modules</h3>
              {matchingModules.map(({ label, screen: target, icon: Icon }) => <button
                type="button"
                className="global-search-result"
                key={target}
                onClick={() => { navigate(target); setIsSearchOpen(false) }}
              >
                <span className="global-search-result-icon"><Icon size={17} /></span>
                <span><strong>{label}</strong><small>{screenTitle[target]}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </>}
            {matchingDevices.length > 0 && <>
              <h3>Devices</h3>
              {matchingDevices.map((device) => <button
                type="button"
                className="global-search-result"
                key={device.recordId}
                onClick={() => { setIsSearchOpen(false); void openDevice(device) }}
              >
                <span className="global-search-result-icon"><DeviceGlyph kind={device.kind} /></span>
                <span><strong>{device.name}</strong><small>{device.owner} · {device.id}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </>}
            {matchingAuditEvents.length > 0 && <>
              <h3>Audit logs</h3>
              {matchingAuditEvents.map((event) => <button
                type="button"
                className="global-search-result"
                key={event.eventId}
                onClick={() => {
                  requestAuditSearch(event.correlationId)
                  navigate('audit')
                  setIsSearchOpen(false)
                }}
              >
                <span className="global-search-result-icon"><FileClock size={17} /></span>
                <span><strong>{friendlyAuditAction(event.action)}</strong><small>{event.target} · {event.actor} · {event.correlationId}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </>}
          </div>
        </section>
      </div>}

      {isHelpOpen && <div
        className="modal-backdrop help-modal-backdrop"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setIsHelpOpen(false) }}
      >
        <section className="help-dialog" id="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
          <header className="help-dialog-header">
            <div><CircleHelp size={20} /><h2 id="help-dialog-title">Quick Guide</h2></div>
            <button
              ref={helpCloseButtonRef}
              className="icon-button"
              type="button"
              aria-label="Close help"
              onClick={() => setIsHelpOpen(false)}
            ><X size={18} /></button>
          </header>
          <div className="help-dialog-body">
            <section className="help-dialog-section">
              <h3>Start here</h3>
              <p>Start on Dashboard: Explore the modules gives a one-line guide to each area, and every module page explains its purpose, available actions, and why it matters. Choose a tenant and workspace from the sidebar to scope the records shown throughout the portal. The number beside Approvals shows requests waiting for review.</p>
            </section>
            <section className="help-dialog-section">
              <h3>What the colors mean</h3>
              <ul className="help-status-list">
                <li><span className="help-status-dot help-status-healthy" aria-hidden="true" /><span><strong>Green:</strong> healthy, compliant, or approved.</span></li>
                <li><span className="help-status-dot help-status-review" aria-hidden="true" /><span><strong>Amber:</strong> waiting for review or needs attention.</span></li>
                <li><span className="help-status-dot help-status-action" aria-hidden="true" /><span><strong>Red:</strong> action required, rejected, or not compliant.</span></li>
                <li><span className="help-status-dot help-status-info" aria-hidden="true" /><span><strong>Blue:</strong> information or demo/sample data.</span></li>
              </ul>
            </section>
            <section className="help-dialog-section">
              <h3>Common tasks</h3>
              <ul>
                <li>In Approvals, review a request, choose Approve or Reject, and enter a reason. The decision is added to Audit.</li>
                <li>Use Devices to find a device and open its details. Compliance shows which devices meet company security rules.</li>
                <li>Use Applications to review registered PWAs, then PWA Access Control to evaluate a device. Remote Commands requires confirmation and a reason.</li>
                <li>Use Device activity to compare the available timestamps. The Audit log lets you search actions and export a report.</li>
              </ul>
            </section>
            <section className="help-dialog-section help-dialog-mode">
              <h3>Connection and device sync</h3>
              <p>{isDemoMode
                ? 'Demo Mode: Sample Data is active. Changes are saved only in this browser and aren’t sent to a live service.'
                : isLoading
                  ? 'The portal is connecting to the selected tenant and workspace.'
                  : apiError
                    ? 'Live records could not be loaded. Check the status message at the top of the page.'
                    : 'Your device and activity records are loaded from the connected service.'}</p>
              <p>MDM sync is a demo feature in this build. It updates sample timestamps and does not connect to Microsoft Intune.</p>
            </section>
          </div>
        </section>
      </div>}

      {reviewDevice && <ReviewDialog key={reviewDevice.recordId} device={reviewDevice} isDemoMode={isDemoMode} onClose={() => setReviewDeviceId(null)} onOpenDevice={openDevice} onSubmit={submitDecision} />}
      {remoteCommandDevice && <RemoteCommandDialog device={remoteCommandDevice} initialCommand={remoteCommandInitial} isDemoMode={isDemoMode} onClose={() => setRemoteCommandDevice(null)} onSubmit={runRemoteCommand} />}
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="toast-close" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    </div>
  )
}

type ModuleGuide = {
  purpose: string
  actions: string[]
  why: string
}

const moduleGuidance: Record<string, ModuleGuide> = {
  Dashboard: {
    purpose: 'Summarizes device health, approvals, compliance, and alerts for the selected tenant and workspace.',
    actions: ['Review the workspace at a glance', 'Follow the four-step access workflow', 'Open modules for detailed work'],
    why: 'Administrators can spot urgent work quickly and see where to go next.',
  },
  'Device inventory': {
    purpose: 'Finds devices and shows their owners, approval, compliance, lifecycle, and activity details.',
    actions: ['Search or filter the inventory', 'Compare access and security status', 'Open a device for its full record'],
    why: 'A reliable inventory helps administrators make informed access and support decisions.',
  },
  Approvals: {
    purpose: 'Reviews device requests and records an approve or reject decision with a reason.',
    actions: ['Search requests by device or owner', 'Review device identity and security evidence', 'Record a decision and reason'],
    why: 'Only reviewed devices should be allowed to reach protected company applications.',
  },
  'Pending Approval Queue': {
    purpose: 'Reviews device requests and records an approve or reject decision with a reason.',
    actions: ['Search requests by device or owner', 'Review device identity and security evidence', 'Record a decision and reason'],
    why: 'Only reviewed devices should be allowed to reach protected company applications.',
  },
  Compliance: {
    purpose: 'Shows which devices meet security checks and which need attention or a fresh sync.',
    actions: ['Review the compliance summary', 'Open devices that need attention', 'Check the policies used for evaluation'],
    why: 'Access decisions should use current device-security information, not guesswork.',
  },
  Applications: {
    purpose: 'Lists PWA names, origins, client IDs, and the workspaces allowed to use them.',
    actions: ['Review registered application details', 'Add an application to the local registry', 'Open PWA Access Control to test a device'],
    why: 'The platform needs to know which application is being protected before it can check access.',
  },
  'MDM Integrations': {
    purpose: 'Shows device synchronization health and provides the available inventory refresh action.',
    actions: ['Check the last update and data freshness', 'Review how many devices are in scope', 'Request an inventory sync'],
    why: 'Current MDM data helps keep device inventory and compliance decisions accurate.',
  },
  'Device activity': {
    purpose: 'Shows separate device check-in, sign-in, application-activity, and API-activity signals.',
    actions: ['Choose a device to inspect', 'Compare timestamps and their sources', 'Identify signals that were not recorded'],
    why: 'An MDM check-in is not the same as a person using an application; separate signals avoid confusion.',
  },
  'Audit log': {
    purpose: 'Searches recorded administrative and access events and exports audit evidence.',
    actions: ['Search or filter events by outcome', 'Review the actor, reason, and target', 'Copy a correlation ID or export records'],
    why: 'A clear history helps teams investigate issues and explain who did what and when.',
  },
  Alerts: {
    purpose: 'Collects approval, compliance, synchronization, and security signals that may need review.',
    actions: ['Open an alert to go to its related record', 'Mark notifications as reviewed', 'Use the alert count to prioritize follow-up'],
    why: 'Timely follow-up can reduce access risk and prevent missed device issues.',
  },
  Reports: {
    purpose: 'Exports the selected workspace’s device inventory and audit records for review.',
    actions: ['Download the device inventory as CSV', 'Export audit evidence as CSV or JSON', 'Confirm the selected tenant and workspace'],
    why: 'Consistent evidence makes reviews and operational handoffs easier.',
  },
  Settings: {
    purpose: 'Provides shortcuts to tenant, user, integration, and governance controls.',
    actions: ['Open account and scope controls', 'Review available governance tools', 'Check which settings need server-side setup'],
    why: 'Keeping administration tasks in one place makes the portal easier to navigate.',
  },
  'User and Role Administration': {
    purpose: 'Shows the signed-in administrator and a plain-language summary of permissions.',
    actions: ['Review the active account and workspace', 'See administrator responsibilities', 'Understand which sign-in details are not verified'],
    why: 'Administrators should understand which actions their role is responsible for.',
  },
  'Tenant and Workspace Management': {
    purpose: 'Selects the organization and workspace whose devices and activity are being viewed.',
    actions: ['Choose the tenant and workspace', 'Review which scope is active', 'See whether the displayed portfolio is sample data'],
    why: 'Correct scope helps prevent mixing records from different customer workspaces.',
  },
  'PWA Access Control': {
    purpose: 'Checks whether a device meets access requirements for a selected application.',
    actions: ['Select a device and application', 'Run an access evaluation', 'Review the result and support reference'],
    why: 'A decision can block unapproved, non-compliant, or inactive devices before access.',
  },
  'Remote Command Console': {
    purpose: 'Requests a supported lock, retire, or wipe action and requires an administrator reason.',
    actions: ['Choose a device and action', 'Confirm the request and provide a reason', 'Review the recorded lifecycle change'],
    why: 'Documented device actions help teams respond to lost, retired, or at-risk devices.',
  },
}

function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  const guidance = moduleGuidance[title]
  return <>
    <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>
    {guidance && <section className="module-guidance" aria-label={`${title} module guide`}>
      <div className="module-guide-block"><span className="module-guide-label">PURPOSE</span><p>{guidance.purpose}</p></div>
      <div className="module-guide-block"><span className="module-guide-label">WHAT YOU CAN DO</span><ul>{guidance.actions.map((action) => <li key={action}>{action}</li>)}</ul></div>
      <div className="module-guide-block"><span className="module-guide-label">WHY IT MATTERS</span><p>{guidance.why}</p></div>
    </section>}
  </>
}

const moduleSummaries: Record<Screen, string> = {
  dashboard: 'See workspace health, priority counts, and the device-access workflow.',
  devices: 'Find device owners, access status, security posture, and activity.',
  approvals: 'Review access requests and record decisions with a reason.',
  compliance: 'Check policy results and find devices that need attention.',
  applications: 'Review registered work apps and the workspaces they serve.',
  intune: 'Check device-data freshness and request an inventory sync.',
  signals: 'Compare device check-in, sign-in, app, and API activity.',
  audit: 'Investigate recorded actions, outcomes, reasons, and references.',
  alerts: 'Follow up on issues found in current device and audit records.',
  reports: 'Export workspace-scoped inventory and audit evidence.',
  settings: 'Open available administration controls and setup guidance.',
  identity: 'Review the signed-in profile and administrator responsibilities.',
  scope: 'Choose which company and workspace the portal displays.',
  access: 'Evaluate whether a device meets an app’s access requirements.',
  commands: 'Request a supported lock, retire, or wipe action.',
  detail: 'Inspect one device’s status, activity dates, and identifiers.',
}

function DashboardPage({
  devices,
  audit,
  alertCount,
  tenant,
  workspace,
  onNavigate,
}: {
  devices: Device[]
  audit: AuditEvent[]
  alertCount: number
  tenant: string
  workspace: string
  onNavigate: (screen: Screen, deviceFilter?: DeviceInventoryFilter) => void
}) {
  const pendingCount = devices.filter((device) => device.approval === 'Pending').length
  const needsReviewCount = devices.filter((device) => device.approval === 'Pending' || device.compliance !== 'Compliant').length
  const activeCount = devices.filter((device) => device.lifecycleState === 'Active').length
  return <>
    <PageHeading eyebrow="GOVERNANCE OVERVIEW" title="Dashboard" description={`A clear overview of ${tenant} · ${workspace}.`}>
      <button type="button" className="button button-primary" onClick={() => onNavigate('devices')}><Smartphone size={15} /> View devices</button>
    </PageHeading>
    <div className="manager-metric-grid">
      <button type="button" className="manager-metric" title="Open the full device inventory." onClick={() => onNavigate('devices', 'all')}><span className="manager-metric-icon"><Smartphone size={18} /></span><span>Devices</span><strong>{devices.length}</strong><small>{activeCount} active in this workspace · View inventory</small></button>
      <button type="button" className="manager-metric" title="Filter the inventory to devices waiting for approval." onClick={() => onNavigate('devices', 'pending')}><span className="manager-metric-icon manager-metric-warning"><Clock3 size={18} /></span><span>Pending approvals</span><strong>{pendingCount}</strong><small>Waiting for an administrator · Filter devices</small></button>
      <button type="button" className="manager-metric" title="Filter the inventory to devices pending approval or requiring compliance attention." onClick={() => onNavigate('devices', 'review')}><span className="manager-metric-icon manager-metric-danger"><ShieldAlert size={18} /></span><span>Needs review</span><strong>{needsReviewCount}</strong><small>Pending approval or compliance issue · Filter devices</small></button>
      <button type="button" className="manager-metric" title="Open alerts for the current workspace." onClick={() => onNavigate('alerts')}><span className="manager-metric-icon manager-metric-info"><Bell size={18} /></span><span>Open alerts</span><strong>{alertCount}</strong><small>Based on current workspace signals · View alerts</small></button>
    </div>
    <section className="manager-workflow" aria-label="How device governance works">
      <div className="manager-workflow-heading"><h2>How device access is governed</h2><p>Four steps connect device management to protected application access.</p></div>
      <div className="manager-workflow-steps">
        <button type="button" onClick={() => onNavigate('intune')}><span>01</span><strong>Sync device</strong><small>Bring in managed-device status</small><ChevronRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('approvals')}><span>02</span><strong>Review request</strong><small>Approve or reject with a reason</small><ChevronRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('compliance')}><span>03</span><strong>Check compliance</strong><small>Review device security posture</small><ChevronRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('access')}><span>04</span><strong>Evaluate app access</strong><small>Allow or deny based on the checks</small><ChevronRight size={15} /></button>
      </div>
    </section>
    <section className="module-catalog" aria-labelledby="module-catalog-title">
      <div className="module-catalog-heading"><span className="executive-kicker">PORTAL GUIDE</span><h2 id="module-catalog-title">Explore the modules</h2><p>Choose a section to see the records and actions it provides.</p></div>
      <div className="module-catalog-grid">
        {navSections.map((section) => <section className="module-catalog-group" key={section.title} aria-label={section.title}>
          <h3>{section.title}</h3>
          <div className="module-catalog-links">
            {section.links.map(({ label, screen, icon: Icon }) => <button type="button" className="module-catalog-link" key={screen} onClick={() => onNavigate(screen)}>
              <span className="module-catalog-icon"><Icon size={16} /></span>
              <span className="module-catalog-copy"><strong>{label}</strong><small>{moduleSummaries[screen]}</small></span>
              <ChevronRight size={15} />
            </button>)}
          </div>
        </section>)}
      </div>
    </section>
    <div className="manager-two-column">
      <section className="panel manager-panel">
        <div className="panel-heading"><div><h2>Needs attention</h2><p>Start with pending decisions and device posture issues.</p></div><button type="button" className="button button-secondary" onClick={() => onNavigate('alerts')}>View alerts</button></div>
        {devices.filter((device) => device.approval === 'Pending' || device.compliance !== 'Compliant').slice(0, 5).map((device) =>
          <div className="manager-list-row" key={device.recordId}><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.owner} · {device.workspace}</small></span><span className="manager-row-status">{device.approval === 'Pending' ? 'Approval pending' : device.compliance}</span></div>)}
        {needsReviewCount === 0 && <p className="manager-empty">No devices currently need attention.</p>}
      </section>
      <section className="panel manager-panel">
        <div className="panel-heading"><div><h2>Recent audit activity</h2><p>Administrative and access events for this workspace.</p></div><button type="button" className="button button-secondary" onClick={() => onNavigate('audit')}>Open audit</button></div>
        {audit.slice(0, 5).map((event) => <div className="manager-audit-row" key={event.eventId}><span className="manager-audit-dot" /><span><strong>{friendlyAuditAction(event.action)}</strong><small>{event.target} · {event.actor}</small></span><time>{event.date}</time></div>)}
        {audit.length === 0 && <p className="manager-empty">Audit activity will appear when events are available.</p>}
      </section>
    </div>
  </>
}

function ApplicationsPage({
  applications,
  isDemoMode,
  onAdd,
  onOpenAccessTest,
}: {
  applications: ManagedApplication[]
  isDemoMode: boolean
  onAdd: (application: ManagedApplication) => void
  onOpenAccessTest: () => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')

  function submitApplication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const originInput = String(form.get('origin') ?? '').trim()
    const clientId = String(form.get('clientId') ?? '').trim()
    const workspace = String(form.get('workspace') ?? '').trim()
    let origin: URL
    try {
      origin = new URL(originInput)
    } catch {
      setFormError('Enter a valid application URL, including https://.')
      return
    }
    if (!name || !clientId || !workspace || !['https:', 'http:'].includes(origin.protocol)) {
      setFormError('Complete each field with a valid application URL.')
      return
    }
    onAdd({
      id: `APP-${Date.now()}`,
      name,
      origin: origin.origin,
      clientId,
      workspaces: [workspace],
    })
    event.currentTarget.reset()
    setFormError('')
    setFormOpen(false)
  }

  return <>
    <PageHeading eyebrow="APPLICATION ACCESS" title="Applications" description="Review the PWAs available to this workspace and their registered origins.">
      <button type="button" className="button button-secondary" onClick={onOpenAccessTest}><ShieldCheck size={15} /> Test access</button>
      <button type="button" className="button button-primary" onClick={() => setFormOpen((open) => !open)}><Package size={15} /> Register application</button>
    </PageHeading>
    <div className="manager-demo-note"><AlertTriangle size={16} /><span>{isDemoMode ? 'Sample application registry. New entries stay in this page until it is reloaded and are not sent to a server.' : 'Application registry is a client-side prototype; new entries are not persisted by the service.'}</span></div>
    {formOpen && <form className="panel application-form" onSubmit={submitApplication}>
      <div className="panel-heading"><div><h2>Register a PWA</h2><p>Provide the application identity and the workspace allowed to use it.</p></div><button type="button" className="button button-secondary" onClick={() => { setFormOpen(false); setFormError('') }}>Cancel</button></div>
      <div className="application-form-grid">
        <label className="manager-field"><span>Application name</span><input name="name" required maxLength={80} placeholder="Customer Workspace" /></label>
        <label className="manager-field"><span>Application origin</span><input name="origin" type="url" required placeholder="https://app.example.com" /></label>
        <label className="manager-field"><span>Client ID</span><input name="clientId" required maxLength={120} placeholder="com.example.workspace" /></label>
        <label className="manager-field"><span>Allowed workspace</span><input name="workspace" required maxLength={80} placeholder="Engineering" /></label>
      </div>
      {formError && <p className="friendly-inline-error" role="alert">{formError}</p>}
      <div className="application-form-actions"><span>Use an HTTPS origin for production applications.</span><button type="submit" className="button button-primary">Add to registry</button></div>
    </form>}
    <section className="panel manager-panel">
      <div className="panel-heading"><div><h2>Registered applications</h2><p>{applications.length} application{applications.length === 1 ? '' : 's'} · allowed workspaces and identifiers</p></div><span className="source-chip"><Package size={14} /> Registry</span></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>APPLICATION</th><th>ORIGIN</th><th>CLIENT ID</th><th>ALLOWED WORKSPACES</th></tr></thead>
        <tbody>{applications.map((application) => <tr key={application.id}><td><strong>{application.name}</strong><small className="manager-app-id">{application.id}</small></td><td><code>{application.origin}</code></td><td><code>{application.clientId}</code></td><td>{application.workspaces.join(', ')}</td></tr>)}</tbody>
      </table></div>
      <div className="manager-table-footnote"><Shield size={14} /> Access decisions still require a registered device, approval, and compliant posture.</div>
    </section>
  </>
}

function AlertsPage({
  alerts,
  hasUnread,
  onMarkRead,
  onOpen,
}: {
  alerts: PortalNotification[]
  hasUnread: boolean
  onMarkRead: () => void
  onOpen: (alert: PortalNotification) => void
}) {
  return <>
    <PageHeading eyebrow="WORKSPACE MONITORING" title="Alerts" description="Review approval, compliance, synchronization, and security signals.">
      <button type="button" className="button button-secondary" onClick={onMarkRead} disabled={!hasUnread || alerts.length === 0}>Mark all as read</button>
    </PageHeading>
    <div className="manager-demo-note"><Bell size={16} /><span>Alerts shown here are generated from currently loaded device and audit data. Email delivery and alert policies are not configured in this prototype.</span></div>
    <section className="panel manager-panel">
      <div className="panel-heading"><div><h2>Current alerts</h2><p>{alerts.length} item{alerts.length === 1 ? '' : 's'} need review or acknowledgement.</p></div><span className="source-chip">{hasUnread ? 'Unread' : 'Reviewed'}</span></div>
      {alerts.map((alert) => <button type="button" className="manager-alert-row" key={alert.id} onClick={() => onOpen(alert)}>
        <span className="manager-alert-icon">{alert.icon}</span><span><strong>{alert.title}</strong><small>{alert.description}</small></span><ChevronRight size={17} />
      </button>)}
      {alerts.length === 0 && <p className="manager-empty">You’re all caught up. New workspace alerts will appear here.</p>}
    </section>
  </>
}

function ReportsPage({
  devices,
  audit,
  isDemoMode,
  exportingAudit,
  onExportAudit,
  onExportInventory,
}: {
  devices: Device[]
  audit: AuditEvent[]
  isDemoMode: boolean
  exportingAudit: boolean
  onExportAudit: (format: 'csv' | 'json') => void
  onExportInventory: () => void
}) {
  const compliantCount = devices.filter((device) => device.compliance === 'Compliant').length
  return <>
    <PageHeading eyebrow="GOVERNANCE REPORTING" title="Reports" description="Download scoped inventory and audit evidence for review.">
      <span className="source-chip">{isDemoMode ? 'Sample data' : 'Current workspace'}</span>
    </PageHeading>
    <div className="manager-demo-note"><FileClock size={16} /><span>Exports are limited to the currently selected tenant and workspace. Demo exports contain sample records.</span></div>
    <div className="manager-report-grid">
      <article className="panel manager-report-card"><span className="manager-report-icon"><Smartphone size={19} /></span><h2>Device inventory</h2><p>{devices.length} devices · {compliantCount} compliant. Includes approval, compliance, and lifecycle status.</p><button type="button" className="button button-primary" onClick={onExportInventory}><Download size={15} /> Download inventory CSV</button></article>
      <article className="panel manager-report-card"><span className="manager-report-icon"><FileClock size={19} /></span><h2>Audit evidence</h2><p>{audit.length} events. Download records with actor, action, result, reason, and correlation ID.</p><div className="export-actions"><button type="button" className="button button-secondary" onClick={() => onExportAudit('csv')} disabled={exportingAudit}><Download size={14} /> CSV</button><button type="button" className="button button-secondary" onClick={() => onExportAudit('json')} disabled={exportingAudit}><Download size={14} /> JSON</button></div></article>
    </div>
  </>
}

function SettingsPage({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const links: { title: string; description: string; screen: Screen; icon: LucideIcon }[] = [
    { title: 'Tenant and workspace', description: 'Choose the organization and workspace in scope.', screen: 'scope', icon: MonitorCog },
    { title: 'User and roles', description: 'Review the current administrator profile and permissions.', screen: 'identity', icon: Users },
    { title: 'MDM integration', description: 'Check provider connectivity and sync health.', screen: 'intune', icon: RefreshCw },
    { title: 'PWA access check', description: 'Test a device access decision for a registered app.', screen: 'access', icon: ShieldCheck },
    { title: 'Remote commands', description: 'Request a supported device action and provide a reason.', screen: 'commands', icon: LockKeyhole },
    { title: 'Device activity', description: 'Review the activity signals currently available.', screen: 'signals', icon: Activity },
  ]
  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Settings" description="Manage workspace context and open the available governance controls." />
    <div className="manager-demo-note"><AlertTriangle size={16} /><span>Authentication, role enforcement, provider credentials, retention, and policy configuration require server-side setup; this prototype does not change those settings.</span></div>
    <section className="manager-settings-grid" aria-label="Administration settings">
      {links.map(({ title, description, screen, icon: Icon }) => <button type="button" className="manager-settings-card" key={screen} onClick={() => onNavigate(screen)}>
        <span className="manager-settings-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} />
      </button>)}
    </section>
    <section className="panel manager-panel manager-settings-note"><div className="panel-heading"><div><h2>Privacy and tracking</h2><p>Location history is optional and disabled by default.</p></div><Shield size={17} /></div><p>Activity and last-used signals shown in this portal come from the available sample or service records. Inactivity thresholds, retention periods, and location collection are not configurable here yet.</p></section>
  </>
}

function PwaAccessPage({
  devices,
  applications,
  isDemoMode,
  selectedDeviceId,
  onSelectDevice,
  onEvaluate,
}: {
  devices: Device[]
  applications: ManagedApplication[]
  isDemoMode: boolean
  selectedDeviceId: string
  onSelectDevice: (deviceId: string) => void
  onEvaluate: (device: Device, requestedAppId: string) => Promise<AccessEvaluationResponse>
}) {
  const [requestedAppId, setRequestedAppId] = useState('com.northstar.workspace')
  const [result, setResult] = useState<AccessEvaluationResponse | null>(null)
  const [error, setError] = useState('')
  const [isEvaluating, setIsEvaluating] = useState(false)
  const selected = devices.find((device) => device.recordId === selectedDeviceId) ?? devices[0]

  useEffect(() => {
    setResult(null)
    setError('')
  }, [selectedDeviceId])

  async function evaluate() {
    if (!selected) return
    setIsEvaluating(true)
    setError('')
    setResult(null)
    try {
      setResult(await onEvaluate(selected, requestedAppId))
    } catch (evaluationError) {
      setError('The security check could not be completed. No access change was made.')
    } finally {
      setIsEvaluating(false)
    }
  }

  return <>
    <PageHeading eyebrow="MODULE 7 / APPLICATION ACCESS" title="PWA Access Control" description="Check whether a device meets company security rules before opening a work app." />
    <div className="simulator-layout">
    <section className="panel access-simulator">
      <div className="panel-heading"><div><h2>Check device security</h2><p>Choose a device to see whether it is ready to access the workspace.</p></div><span className="source-chip"><Shield size={14} /> {isDemoMode ? 'Demo check' : 'Security check'}</span></div>
      <div className="access-form">
        <label className="access-field"><span>Device</span><select value={selected?.recordId ?? ''} onChange={(event) => onSelectDevice(event.target.value)} disabled={devices.length === 0 || isEvaluating}>
          {devices.length === 0 && <option value="">No devices available</option>}
          {devices.map((device) => <option key={device.recordId} value={device.recordId}>{device.id} · {device.name} — {device.owner}</option>)}
        </select></label>
        <label className="access-field"><span>Requested application</span><select value={requestedAppId} onChange={(event) => { setRequestedAppId(event.target.value); setResult(null); setError('') }} disabled={isEvaluating}>
          {applications.map((application) => <option key={application.id} value={application.clientId}>{application.name}</option>)}
        </select></label>
        {selected && <div className="access-subject"><DeviceGlyph kind={selected.kind} /><div><strong>{selected.owner}</strong><span>{selected.email} · {selected.workspace}</span></div><span className="access-subject-id">User ID: {selected.ownerUserId}</span></div>}
        <button className="button button-primary access-test-button" title="Check approval, device security, and lifecycle status for this app." onClick={() => void evaluate()} disabled={!selected || isEvaluating}>
          <ShieldCheck size={16} />{isEvaluating ? 'Evaluating access…' : 'Evaluate Access Decision'}
        </button>
      </div>
    </section>
    <aside className="phone-preview" aria-label="PWA mobile preview">
        <div className="phone-frame">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="phone-status"><span>9:41</span><span>•••</span></div>
            <div className="phone-app-brand"><span className="phone-app-icon"><ShieldCheck size={17} /></span><span>GateLogiq<span>WORKSPACE</span></span></div>
            <div className="phone-welcome">Good morning,<strong>{selected?.owner.split(' ')[0] ?? 'there'}</strong></div>
            <div className="phone-workspace"><span>ACTIVE WORKSPACE</span><strong>{selected?.workspace ?? 'Workspace'}</strong><span className="phone-online"><i /> Secure connection</span></div>
            <div className="phone-preview-foot"><LockKeyhole size={13} /> Protected by device posture</div>
          </div>
        </div>
        <span className="phone-caption">{isDemoMode ? 'DEMO APP PREVIEW' : 'SECURE APP PREVIEW'}</span>
    </aside>
    </div>
    {error && <div className="friendly-inline-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
    {result && <section className={`access-result ${result.decision === 'ALLOW' ? 'access-allowed' : 'access-denied'}`} aria-live="polite">
      <div className="access-result-icon">{result.decision === 'ALLOW' ? <ShieldCheck size={27} /> : <ShieldAlert size={27} />}</div>
      <div className="access-result-content">
        <div className="access-result-heading"><span className="eyebrow">PWA ACCESS CHECK</span><strong>{result.decision === 'ALLOW' ? 'Access Authorized' : 'Access Blocked'}</strong></div>
        <p>{result.decision === 'ALLOW'
          ? 'Device identity and compliance checks passed.'
          : result.reasonCode === 'DEVICE_NOT_APPROVED'
            ? 'Access Blocked: This device requires IT administrator approval before accessing this workspace.'
            : result.reasonCode === 'DEVICE_NON_COMPLIANT'
              ? 'Access Blocked: This device does not meet the workspace security requirements.'
              : result.reasonCode === 'COMPLIANCE_DATA_STALE'
                ? 'Access Blocked: Device security information is out of date. Sync the device and try again.'
                : result.reasonCode === 'DEVICE_LIFECYCLE_INACTIVE'
                  ? 'Access Blocked: This device is inactive and cannot access the workspace.'
                  : 'Access was blocked because this device does not meet the workspace access requirements.'}</p>
        {result.decision === 'DENY' && <div className="access-reason-code" title="Share this reference with your administrator to identify why access was blocked."><span>Support reference</span><code>{result.reasonCode}</code></div>}
        {result.grant && <div className="access-grant">
          <div title="A temporary demo token returned by the access check."><span>Demo access token</span><code>{result.grant.token}</code></div>
          <div title="The time this temporary token stops being valid."><span>Expires</span><strong>{new Date(result.grant.expiresAt).toLocaleTimeString()}</strong></div>
          <div className="access-scopes"><span>Valid scopes</span><div>{result.grant.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div></div>
        </div>}
        <div className="access-correlation">Correlation ID <code>{result.correlationId}</code></div>
      </div>
    </section>}
  </>
}

function IdentityRolesPage({
  email,
  tenant,
  workspace,
  isDemoMode,
}: {
  email: string
  tenant: string
  workspace: string
  isDemoMode: boolean
}) {
  return <>
    <PageHeading eyebrow="MODULE 1 / IDENTITY AND ACCESS" title="User and Role Administration" description="See who is signed in and what they can manage, so access stays accountable." />
    <section className="executive-user-card">
      <div className="executive-user-avatar"><Users size={24} /></div>
      <div className="executive-user-main">
        <span className="executive-kicker">SIGNED IN AS</span>
        <h2>Customer IT Administrator</h2>
        <p>{email || 'Administrator account'} <span>·</span> {tenant}</p>
      </div>
      <span className={`executive-status ${isDemoMode ? 'executive-status-demo' : ''}`} title={isDemoMode ? 'Sample profile only; no real multi-factor check was performed.' : 'Multi-factor sign-in status was not provided by the sign-in service.'}>
        <CheckCircle2 size={16} /> {isDemoMode ? 'Demo profile · sample security' : 'Sign-in security not reported'}
      </span>
      <div className="executive-user-facts">
        <div title="Workspaces this account can view."><span>Assigned workspaces</span><strong>{isDemoMode ? 'All' : workspace}</strong></div>
        <div title={isDemoMode ? 'Sample only; the portal does not verify multi-factor sign-in.' : 'This information is not supplied by the sign-in service.'}><span>Multi-factor sign-in</span><strong>{isDemoMode ? 'Sample only' : 'Not reported'}</strong></div>
        <div title="The current profile is active in this portal session."><span>Account status</span><strong>Active</strong></div>
      </div>
    </section>
    <section className="executive-permissions">
      <div className="executive-section-heading"><div><span className="executive-kicker">ACCESS AT A GLANCE</span><h2>Permissions breakdown</h2><p>What this role can do in plain English.</p></div><span className="source-chip"><LockKeyhole size={14} /> Administrator</span></div>
      <ul className="executive-permission-list">
        <li><CheckCircle2 size={18} /><span><strong>Review access requests</strong><small>Approve or reject devices requesting workspace access.</small></span></li>
        <li><CheckCircle2 size={18} /><span><strong>Monitor device safety</strong><small>See whether managed devices meet company security rules.</small></span></li>
        <li><CheckCircle2 size={18} /><span><strong>Protect company devices</strong><small>Request a lock, retirement, or wipe with a recorded reason.</small></span></li>
        <li><CheckCircle2 size={18} /><span><strong>Keep an audit trail</strong><small>Review administrative activity and export evidence.</small></span></li>
      </ul>
    </section>
    <p className="demo-data-note"><Shield size={15} />This profile is informational; this build does not authenticate users or enforce role-based permissions.</p>
  </>
}

function WorkspaceTenantsPage({
  tenant,
  workspace,
  isDemoMode,
  demoWorkspace,
  onTenantChange,
  onWorkspaceChange,
}: {
  tenant: string
  workspace: string
  isDemoMode: boolean
  demoWorkspace: DemoWorkspace
  onTenantChange: (tenant: string) => void
  onWorkspaceChange: (workspace: string) => void
}) {
  const demoWorkspaceCards: { name: DemoWorkspace; devices: string; teams: string; icon: LucideIcon }[] = [
    { name: 'Engineering', devices: '1,192', teams: 'Product & engineering', icon: MonitorCog },
    { name: 'Operations UAE', devices: '74', teams: 'Regional operations', icon: Users },
    { name: 'Field Logistics', devices: '18', teams: 'Field teams', icon: Smartphone },
  ]
  return <>
    <PageHeading eyebrow="MODULE 2 / TENANT AND WORKSPACE" title="Tenant and Workspace Management" description="Choose a company and workspace to see the right devices and access requests." />
    <section className="workspace-tenant-bar">
      <label><span>Tenant</span><select value={tenant} onChange={(event) => onTenantChange(event.target.value)} aria-label="Select tenant">
        <option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option>
      </select></label>
      <span title={isDemoMode ? 'The counts on this screen are representative samples.' : 'The selected tenant controls which records are shown.'}><span className="workspace-indicator" />{isDemoMode ? 'Sample portfolio' : 'Selected company'}</span>
    </section>
    {isDemoMode
      ? <section className="executive-workspace-grid" aria-label="Available workspaces">
        {demoWorkspaceCards.map(({ name, devices, teams, icon: Icon }) => {
          const isActive = demoWorkspace === name
          return <article className={`executive-workspace-card ${isActive ? 'workspace-card-active' : ''}`} key={name}>
            <div className="workspace-card-top"><span className="workspace-card-icon"><Icon size={20} /></span>{isActive && <span className="workspace-active-badge" title="This is the workspace currently shown throughout the portal."><Check size={13} /> Active</span>}</div>
            <h2>{name}</h2><p>{teams}</p>
            <div className="workspace-card-count" title="Representative device count for this sample workspace."><strong>{devices}</strong><span>managed devices</span></div>
            <button type="button" className={`button ${isActive ? 'button-secondary' : 'button-primary'}`} title={isActive ? 'This workspace is already selected.' : `Show devices and requests for ${name}.`} disabled={isActive} onClick={() => onWorkspaceChange(name)}>
              {isActive ? 'Current workspace' : 'Switch workspace'}
            </button>
          </article>
        })}
        <p className="demo-data-note"><Shield size={15} /> Portfolio totals are representative sample figures. Switching updates this local demo view only.</p>
      </section>
      : <section className="live-scope-grid">
        <article className="live-scope-card"><span className="scope-card-icon"><Users size={20} /></span><span className="executive-kicker">TENANT</span><h2>{tenant}</h2><label>Switch tenant<select value={tenant} onChange={(event) => onTenantChange(event.target.value)} aria-label="Select tenant">
          <option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option>
        </select></label></article>
        <article className="live-scope-card"><span className="scope-card-icon"><MonitorCog size={20} /></span><span className="executive-kicker">WORKSPACE</span><h2>{workspace}</h2><label>Switch workspace<select value={workspace} onChange={(event) => onWorkspaceChange(event.target.value)} aria-label="Select workspace">
          <option>Production</option><option>Engineering</option><option>Corporate</option>
        </select></label></article>
        <p className="demo-data-note"><LockKeyhole size={15} /> Device and audit records are loaded for the selected tenant and workspace.</p>
      </section>}
  </>
}

function IntunePage({
  devices,
  latestSyncAt,
  syncIsFresh,
  isSyncing,
  isDemoMode,
  onSync,
}: {
  devices: Device[]
  latestSyncAt: string | null
  syncIsFresh: boolean
  isSyncing: boolean
  isDemoMode: boolean
  onSync: () => void
}) {
  const isHealthy = syncIsFresh && !isDemoMode
  return <>
    <PageHeading eyebrow="MODULE 5 / DEVICE MANAGEMENT" title="MDM Integrations" description="Check when the device list was updated and refresh it when needed." />
    <section className={`executive-sync-hero ${isHealthy ? 'sync-hero-healthy' : ''}`} aria-label="Intune connection status">
      <div className="sync-hero-top">
        <span className="sync-hero-icon"><MonitorCog size={24} /></span>
        <div title="This status reflects the API connection; sample data does not confirm a live Intune connection."><span className="executive-kicker">MICROSOFT INTUNE CONNECTION</span>
          <h2>{isDemoMode ? 'Demo preview · connection not verified' : isHealthy ? 'Healthy & online' : 'Needs attention'}</h2>
        </div>
        <span className={`executive-status ${isDemoMode ? 'executive-status-demo' : isHealthy ? '' : 'executive-status-attention'}`} title={isDemoMode ? 'These are sample device records; no live Intune sync was checked.' : isHealthy ? 'The latest live device sync is within the expected freshness window.' : 'The latest device sync is missing or more than 60 minutes old.'}>
          <span className="workspace-indicator" />{isDemoMode ? 'Sample data' : isHealthy ? 'Connected' : 'Check sync'}
        </span>
      </div>
      <div className="sync-hero-stats">
        <div title="How recently the device records were updated."><span>Last updated</span><strong>{formatRelativeTime(latestSyncAt) ?? 'Not recorded'}</strong></div>
        <div title="Number of device records in the selected workspace."><span>Devices in inventory</span><strong>{devices.length.toLocaleString()}</strong></div>
        <div title="Device records should be updated at least once every 60 minutes."><span>Data freshness</span><strong>{isDemoMode ? 'Sample data' : syncIsFresh ? 'Within 60 minutes' : 'Over 60 minutes'}</strong></div>
      </div>
      <div className="sync-hero-actions">
        <button className="button button-primary" title={isDemoMode ? 'Refreshes sample timestamps only; it does not contact Microsoft Intune.' : 'Request a device inventory refresh.'} onClick={onSync} disabled={isSyncing}>
          <RefreshCw size={16} className={isSyncing ? 'sync-spinning' : ''} />{isSyncing ? 'Syncing…' : 'Sync with Intune Now'}
        </button>
        <span>{isDemoMode ? 'This button updates sample timestamps locally.' : 'Sync requests are sent through the governance service.'}</span>
      </div>
    </section>
  </>
}

function CompliancePage({ devices, isDemoMode, onOpenDevice }: { devices: Device[]; isDemoMode: boolean; onOpenDevice: (device: Device) => void }) {
  const compliantCount = devices.filter((device) => device.compliance === 'Compliant').length
  const nonCompliantCount = devices.filter((device) => device.compliance === 'Non-compliant').length
  const staleCount = devices.filter((device) => device.compliance === 'Stale').length
  const complianceRate = devices.length ? `${Math.round(compliantCount / devices.length * 100)}%` : '—'
  const prioritizedDevices = [...devices].sort((first, second) =>
    Number(first.compliance === 'Compliant') - Number(second.compliance === 'Compliant'))
  const policies = [
    { title: 'Operating system version', detail: 'Example criterion: iOS 17+ and Windows 11.' },
    { title: 'Device encryption', detail: 'Example criterion: BitLocker or FileVault evidence.' },
    { title: 'MDM data freshness', detail: 'Example criterion: device records update within 60 minutes.' },
  ]

  return <>
    <PageHeading eyebrow="MODULE 6 / DEVICE SAFETY" title="Compliance" description="See which devices meet company security rules and which need attention." />
    <section className="compliance-summary">
      <div title="Share of device records that meet the current security rules."><span className="compliance-summary-icon"><ShieldCheck size={20} /></span><span>Devices meeting policy</span><strong>{complianceRate}</strong><small>{compliantCount} of {devices.length} records</small></div>
      <div title="Devices that do not meet policy or have out-of-date security information."><span className="compliance-summary-icon compliance-summary-warning"><AlertTriangle size={20} /></span><span>Needs attention</span><strong>{(nonCompliantCount + staleCount).toLocaleString()}</strong><small>Non-compliant or out of date</small></div>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">DEVICE CHECKS</span><h2>Devices by security status</h2><p>Devices needing attention appear first. Select one to see details.</p></div><span className="source-chip" title={isDemoMode ? 'These are sample device checks.' : 'These results were reported by the connected service.'}><ShieldCheck size={14} />{isDemoMode ? 'Sample checks' : 'Reported results'}</span></div>
      {prioritizedDevices.map((device) => <button type="button" className="executive-device-row" key={device.recordId} title="Open this device’s details and recent activity." onClick={() => void onOpenDevice(device)}>
        <DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.owner} · Last checked {formatRelativeTime(device.lastMdmSyncAt) ?? 'not recorded'}</small></span><CompliancePill state={device.compliance} /><ChevronRight size={17} />
      </button>)}
      {devices.length === 0 && <p className="executive-empty">Device posture will appear here when records are available.</p>}
    </section>
    <section className="policy-card-grid" aria-label="Example security policy checks">
      {policies.map((policy) => <article className="policy-card" key={policy.title} title={policy.detail}>
        <span className="policy-check"><CircleHelp size={18} /></span><div><h2>{policy.title}</h2><p>{policy.detail}</p></div><span className="policy-state">Example rule</span>
      </article>)}
    </section>
    <p className="demo-data-note"><CircleHelp size={15} />The policy criteria above are examples for context; policy configuration is not available in this portal.</p>
  </>
}

function SignalsPage({
  devices,
  selectedDeviceId,
  onSelectDevice,
}: {
  devices: Device[]
  selectedDeviceId: string
  onSelectDevice: (deviceId: string) => void
}) {
  const selected = devices.find((device) => device.recordId === selectedDeviceId) ?? devices[0]

  return <>
    <PageHeading eyebrow="MODULE 8 / DEVICE ACTIVITY" title="Device activity" description="See when this device last connected, checked in, and reported activity.">
      <label className="module-device-picker" title="Choose which device’s activity dates to view."><span>Device</span><select value={selected?.recordId ?? ''} onChange={(event) => onSelectDevice(event.target.value)} disabled={devices.length === 0}>
        {devices.length === 0 && <option value="">No devices available</option>}
        {devices.map((device) => <option key={device.recordId} value={device.recordId}>{device.name} · {device.owner}</option>)}
      </select></label>
    </PageHeading>
    {selected
      ? <>
        <section className="module-selected-device"><DeviceGlyph kind={selected.kind} /><div><span className="eyebrow">SELECTED DEVICE</span><strong>{selected.name}</strong><small>{selected.owner} · {selected.workspace} · {selected.platform} {selected.version}</small></div><ApprovalPill state={selected.approval} /><CompliancePill state={selected.compliance} /></section>
        <section className="signal-grid module-signal-grid" aria-label="Seven device activity signals">
          {selected.signals.map((signal, index) => {
            const Icon = signal.icon
            return <article className={`signal-card ${index === 6 ? 'signal-logout' : ''}`} key={signal.label} title={signal.note ? `${signal.source}: ${signal.note}` : `${friendlySignalTitle(signal.label)} reported by ${signal.source}.`}>
              <div className="signal-card-head"><span className="signal-icon"><Icon size={16} /></span><span className="signal-index">0{index + 1}</span></div>
              <h3>{friendlySignalTitle(signal.label)}</h3>
              <strong className={signal.occurredAt ? '' : 'signal-null'}>{signal.occurredAt ? new Date(signal.occurredAt).toLocaleString() : 'Not recorded'}</strong>
              <div className="signal-source"><span>Source</span><span>{signal.source}</span></div>
              {signal.note && signal.occurredAt && <small className="signal-note">{signal.note}</small>}
            </article>
          })}
        </section>
        <div className="signal-disclaimer"><Shield size={15} /><span>These seven activity dates are separate signals. A missing event does not automatically mean a device is unsafe.</span></div>
      </>
      : <div className="empty-devices">No device signals are available in this workspace.</div>}
  </>
}

function RemoteCommandsPage({
  devices,
  isDemoMode,
  onRemoteCommand,
}: {
  devices: Device[]
  isDemoMode: boolean
  onRemoteCommand: (device: Device, command?: RemoteCommand) => void
}) {
  return <>
    <PageHeading eyebrow="MODULE 9 / DEVICE CARE" title="Remote Command Console" description="Choose a device action and record why it is needed." />
    <section className="remote-device-grid">
      {devices.map((device) => <article className="remote-device-card" key={device.recordId}>
        <div className="remote-device-heading"><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.owner} · {device.workspace}</small></span><span className={`lifecycle-pill lifecycle-${device.lifecycleState.toLowerCase()}`} title={lifecycleHelp(device.lifecycleState)}>{device.lifecycleState}</span></div>
        <p>Choose an action for this device:</p>
        <div className="remote-action-grid">
          <button type="button" className="remote-action-lock" title={isDemoMode ? 'Demo only: records a lock action; it does not lock the physical device.' : 'Record a lock action and block workspace access.'} onClick={() => onRemoteCommand(device, 'LOCK')}><LockKeyhole size={16} />Lock</button>
          <button type="button" className="remote-action-retire" title={isDemoMode ? 'Demo only: marks this sample device as retired.' : 'Mark the device as retired and block workspace access.'} onClick={() => onRemoteCommand(device, 'RETIRE')}><Package size={16} />Retire</button>
          <button type="button" className="remote-action-wipe" title={isDemoMode ? 'Demo only: records a wipe action; it does not erase the physical device.' : 'Record a wipe action. This build does not erase a physical device.'} onClick={() => onRemoteCommand(device, 'WIPE')}><AlertTriangle size={16} />Wipe</button>
        </div>
      </article>)}
      {devices.length === 0 && <p className="executive-empty">Device actions will appear here when records are available.</p>}
    </section>
    <p className="demo-data-note"><LockKeyhole size={15} />{isDemoMode ? 'Demo actions update only the sample view. No device command is sent.' : 'Commands require confirmation and are sent through the configured governance service.'}</p>
  </>
}

function ApprovalsPage({ devices, workspace, isDemoMode, onReview }: {
  devices: Device[]
  workspace: string
  isDemoMode: boolean
  onReview: (device: Device) => void
}) {
  const [search, setSearch] = useState('')
  const searchTerm = search.trim().toLowerCase()
  const pending = devices.filter((device) => device.approval === 'Pending')
  const filteredPending = pending.filter((device) =>
    `${device.name} ${device.owner} ${device.email} ${device.id} ${device.workspace} ${device.platform} ${device.version}`
      .toLowerCase().includes(searchTerm))
  const approvedCount = devices.filter((device) => device.approval === 'Approved').length
  const attentionCount = devices.filter((device) => device.compliance !== 'Compliant').length

  return <>
    <PageHeading eyebrow="MODULE 4 / ACCESS REQUESTS" title="Pending Approval Queue" description="Review access requests and record a reason for each decision." />
    <section className="executive-summary-grid approval-summary">
      <article title="Requests in this workspace that still need a decision."><span className="summary-icon summary-amber"><Clock3 size={18} /></span><span>Waiting for review</span><strong>{pending.length}</strong><small>Requests in {workspace}</small></article>
      <article title="Devices approved to request access; they must still meet security rules."><span className="summary-icon summary-green"><CheckCircle2 size={18} /></span><span>Approved devices</span><strong>{approvedCount}</strong><small>Approval does not replace security checks</small></article>
      <article title="Devices that are waiting for approval or have a security issue."><span className="summary-icon summary-amber"><ShieldAlert size={18} /></span><span>Posture needs attention</span><strong>{attentionCount}</strong><small>Review the device safety details</small></article>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">ACTION REQUIRED</span><h2>Access requests</h2><p>Approval changes require a short reason and are added to the audit history.</p></div></div>
      <div className="approval-request-toolbar">
        <label className="executive-search" title="Find requests by device, owner, or workspace."><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests or people" /></label>
        <span className="source-chip" title={isDemoMode ? 'Representative requests for the demo.' : 'Requests in the selected workspace.'}><span className="workspace-indicator" />{isDemoMode ? 'Sample requests' : 'Current requests'}</span>
      </div>
      <div className="approval-card-grid">
        {filteredPending.map((device) => {
          const age = formatRelativeTime(device.signals.find((signal) => signal.label === 'PWA authentication')?.occurredAt ?? null) ?? 'Recently'
          return <article className="approval-request-card" key={device.recordId}>
            <div className="approval-card-top"><span className="approval-request-icon"><Smartphone size={21} /></span><span className="approval-request-age"><Clock3 size={14} />Requested {age}</span></div>
            <h3>{device.name}</h3><p>{device.owner} requested access to {device.workspace}.</p>
            <div className="approval-evidence"><span><strong>Device safety</strong><CompliancePill state={device.compliance} /></span><span><strong>Platform</strong><small>{device.platform} {device.version}</small></span></div>
            <div className="approval-card-actions">
              <button type="button" className="button button-primary" title="Review the device details and record an approval decision with a reason." onClick={() => onReview(device)}><CheckCircle2 size={16} />Review &amp; Decide</button>
            </div>
          </article>
        })}
        {filteredPending.length === 0 && <div className="executive-empty">{search ? 'No requests match your search.' : 'You’re all caught up. No devices are waiting for approval.'}</div>}
      </div>
    </section>
    <p className="demo-data-note"><ShieldCheck size={15} />{isDemoMode ? 'Approval actions in demo mode update this sample view only.' : 'Access is granted only after both approval and device-safety requirements are satisfied.'}</p>
  </>
}

function CompliancePill({ state }: { state: ComplianceState }) {
  const tone = state === 'Compliant' ? 'compliant' : state === 'Stale' ? 'stale' : 'noncompliant'
  const Icon = state === 'Compliant' ? CheckCircle2 : state === 'Stale' ? Clock3 : AlertTriangle
  const title = state === 'Compliant'
    ? 'The device meets the current security rules.'
    : state === 'Stale'
      ? 'The device security information may be out of date.'
      : 'The device does not meet one or more security rules.'
  return <span className={`compliance-pill compliance-${tone}`} title={title}><Icon size={13} />{state}</span>
}

function DevicesPage({ devices, isDemoMode, initialFilter, onOpenDevice }: {
  devices: Device[]
  isDemoMode: boolean
  initialFilter: DeviceInventoryFilter
  onOpenDevice: (device: Device) => void
}) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('All approval states')
  const [filter, setFilter] = useState(initialFilter)
  useEffect(() => setFilter(initialFilter), [initialFilter])
  const readyCount = devices.filter((device) =>
    device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active').length
  const reviewCount = devices.filter((device) =>
    device.approval === 'Pending' || device.compliance !== 'Compliant').length
  const filtered = devices.filter((device) =>
    `${device.name} ${device.owner} ${device.email} ${device.id} ${device.intuneId} ${device.platform} ${device.version} ${device.approval}`
      .toLowerCase().includes(search.toLowerCase())
      && (state === 'All approval states' || device.approval === state)
      && (filter !== 'pending' || device.approval === 'Pending')
      && (filter !== 'review' || device.approval === 'Pending' || device.compliance !== 'Compliant')
      && (filter !== 'ready' || (device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active')))
  return <>
    <PageHeading eyebrow="MODULE 3 / MANAGED DEVICES" title="Device inventory" description="Find company devices and check their owners, approvals, and security status." />
    <section className="executive-summary-grid">
      <button type="button" className={`inventory-summary-card ${filter === 'all' ? 'inventory-summary-active' : ''}`} aria-pressed={filter === 'all'} title="Show every device in the selected workspace." onClick={() => setFilter('all')}><span className="summary-icon summary-blue"><Smartphone size={18} /></span><span>Devices in view</span><strong>{devices.length}</strong><small>{isDemoMode ? 'Representative sample · Show all' : 'Current workspace · Show all'}</small></button>
      <button type="button" className={`inventory-summary-card ${filter === 'ready' ? 'inventory-summary-active' : ''}`} aria-pressed={filter === 'ready'} title="Show devices approved, compliant, and active for access." onClick={() => setFilter('ready')}><span className="summary-icon summary-green"><ShieldCheck size={18} /></span><span>Ready for access</span><strong>{readyCount}</strong><small>Approved and meeting policy · Quick filter</small></button>
      <button type="button" className={`inventory-summary-card ${filter === 'review' ? 'inventory-summary-active' : ''}`} aria-pressed={filter === 'review'} title="Show devices awaiting approval or requiring compliance attention." onClick={() => setFilter('review')}><span className="summary-icon summary-amber"><Clock3 size={18} /></span><span>Needs review</span><strong>{reviewCount}</strong><small>Approval or safety action needed · Quick filter</small></button>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">DEVICE OVERVIEW</span><h2>Your managed devices</h2><p>Owner, model, and access readiness at a glance.</p></div><span className="source-chip" title={isDemoMode ? 'Representative sample records for this workspace.' : 'Live records for the selected workspace.'}><MonitorCog size={14} />{isDemoMode ? 'Sample inventory' : 'Current inventory'}</span></div>
      <div className="table-toolbar executive-device-toolbar"><label className="search-field" title="Find devices by name, owner, email, platform, or ID."><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search devices or owners" /></label><label className="filter-select" title="Show devices with a selected approval status."><ListFilter size={15} /><select value={state} onChange={(event) => setState(event.target.value)} aria-label="Filter by approval state"><option>All approval states</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Suspended</option><option>Revoked</option></select><ChevronDown size={14} /></label></div>
      <div className="device-card-grid">{filtered.map((device) => {
        const latestActivity = device.signals.reduce<string | null>((latest, signal) =>
          signal.occurredAt && (!latest || new Date(signal.occurredAt) > new Date(latest)) ? signal.occurredAt : latest, null)
        const initials = device.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
        const isAuthorized = device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active'
        return <article className="device-card" key={device.recordId}>
          <div className="device-card-top"><DeviceGlyph kind={device.kind} /><span className="device-platform-tag">{device.platform} {device.version}</span></div>
          <div className="device-card-title"><strong>{device.name}</strong><span>{device.hardwareModel ?? 'Hardware model not provided'} · {device.id}</span></div>
          <div className="device-card-owner"><span className="owner-avatar">{initials}</span><span><strong>{device.owner}</strong><small>{device.email}</small></span></div>
          <div className="device-card-status">{isAuthorized ? <span className="authorized-pill" title="Approved, compliant, and active in this workspace."><CheckCircle2 size={14} />Ready for access</span> : <><ApprovalPill state={device.approval} /><CompliancePill state={device.compliance} /></>}</div>
          <details className="device-signals-disclosure">
            <summary title="Expand to see the individual device activity dates."><span>Recent activity</span><ChevronDown size={14} /></summary>
            <div className="device-signals-list">{device.signals.map((signal) => <div className="device-signal-item" key={signal.label}><span>{friendlySignalTitle(signal.label)}</span><strong>{signal.value ?? 'Not recorded'}</strong></div>)}</div>
          </details>
          <div className="device-card-footer"><span className="device-last-activity" title="Most recent activity reported for this device."><Activity size={14} />{formatRelativeTime(latestActivity) ?? 'No recent activity'}</span><button className="button button-tertiary" title="See the device status, activity dates, and identifiers." onClick={() => onOpenDevice(device)}>View details <ChevronRight size={14} /></button></div>
        </article>
      })}{filtered.length === 0 && <div className="empty-devices">No devices match these filters.</div>}</div>
      <div className="table-footer"><span>Showing <strong>{filtered.length}</strong> device records {isDemoMode ? 'from the sample inventory' : 'in this workspace'}</span></div>
    </section>
  </>
}

function ApprovalPill({ state }: { state: ApprovalState }) {
  const tone = state === 'Approved' ? 'approved' : state === 'Pending' ? 'pending' : 'rejected'
  const title = state === 'Approved'
    ? statusHelp.approved
    : state === 'Pending'
      ? statusHelp.pending
      : state === 'Rejected'
        ? statusHelp.rejected
        : state === 'Suspended'
          ? 'Workspace access is temporarily blocked for this device.'
          : 'Workspace access has been revoked for this device.'
  return <StatusPill tone={tone} title={title}>{state}</StatusPill>
}

function DeviceDetail({ device, onBack, onRemoteCommand }: { device: Device; onBack: () => void; onRemoteCommand: (device: Device, command?: RemoteCommand) => void }) {
  const [tab, setTab] = useState<'overview' | 'activity' | 'identifiers'>('activity')
  return <>
    <button className="back-link" title="Return to the full device list." onClick={onBack}><ArrowLeft size={15} /> Back to device inventory</button>
    <div className="detail-title-row"><div className="detail-identity"><DeviceGlyph kind={device.kind} /><div><div className="eyebrow">DEVICE RECORD / {device.id}</div><h1>{device.name}</h1><p>{device.owner} <i /> {device.email}</p><p className="detail-purpose">Review this device’s status, activity, and identifiers.</p></div></div><button className="button button-secondary" title="Choose Lock, Retire, or Wipe for this device." onClick={() => onRemoteCommand(device)}><MoreHorizontal size={16} /> Remote command <ChevronDown size={14} /></button></div>
    <section className="device-status-strip"><div className="device-status-intro"><span className="mini-label">DEVICE STATUS</span><span>Approval and security checks are separate.</span><span className={`lifecycle-pill lifecycle-${device.lifecycleState.toLowerCase()}`} title={lifecycleHelp(device.lifecycleState)}>{device.lifecycleState}</span></div><div className="state-pair"><div title="Whether the access request was approved."><span className="mini-label">APPROVAL</span><ApprovalPill state={device.approval} /></div><div title="Whether the device meets company security rules."><span className="mini-label">SECURITY</span><CompliancePill state={device.compliance} /></div></div><div className="workspace-status"><span className="mini-label">WORKSPACE</span><strong title="The workspace this device belongs to."><span className="workspace-indicator" />{device.workspace}</strong></div></section>
    <section className="panel detail-panel"><div className="detail-tabs" role="tablist" aria-label="Device information"><button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'tab-active' : ''} title="See the device owner, setup, and workspace." onClick={() => setTab('overview')}>Overview</button><button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'tab-active' : ''} title="See the seven individual activity dates." onClick={() => setTab('activity')}>Activity dates <span className="tab-count">7</span></button><button role="tab" aria-selected={tab === 'identifiers'} className={tab === 'identifiers' ? 'tab-active' : ''} title="See the device IDs and masked serial number." onClick={() => setTab('identifiers')}>Identifiers</button></div>
      {tab === 'activity' && <div className="activity-content"><div className="section-title-row"><div><h2>Recent device activity</h2><p>Each date comes from a separate system. A missing date does not automatically mean something is wrong.</p></div><span className="freshness-label" title="These dates come from separate device activity sources."><span className="freshness-dot" />Activity dates</span></div><div className="signal-grid">{device.signals.map((signal, index) => {
        const Icon = signal.icon
        return <article className={`signal-card ${index === 6 ? 'signal-logout' : ''}`} key={signal.label} title={signal.note ? `${signal.source}: ${signal.note}` : `${friendlySignalTitle(signal.label)} reported by ${signal.source}.`}><div className="signal-card-head"><span className="signal-icon"><Icon size={16} /></span><span className="signal-index">0{index + 1}</span></div><h3>{friendlySignalTitle(signal.label)}</h3><strong className={signal.value ? '' : 'signal-null'}>{signal.value ?? 'Not recorded'}</strong><div className="signal-source"><span>Source</span><span>{signal.source}</span></div>{signal.note && signal.value && <small className="signal-note">{signal.note}</small>}</article>
      })}</div><div className="signal-disclaimer"><Shield size={15} /><span>Hardware inventory and remote management data are provided by Intune. A browser PWA cannot read physical MAC addresses or issue OS-level commands.</span></div></div>}
      {tab === 'overview' && <div className="overview-content"><div className="section-title-row"><div><h2>Device overview</h2><p>Ownership and setup details reported by Microsoft Intune.</p></div><span className="source-chip"><MonitorCog size={14} /> Microsoft Intune</span></div><div className="overview-grid"><InfoField label="Device ID" value={device.id} /><InfoField label="Intune device ID" value={device.intuneId} /><InfoField label="Assigned owner" value={device.owner} /><InfoField label="Platform" value={`${device.platform} ${device.version}`} /><InfoField label="Serial number (masked)" value={device.serial} /><InfoField label="Enrollment date" value={device.enrolled} /><InfoField label="Workspace" value={device.workspace} /><InfoField label="Device manager" value="Microsoft Intune" /></div></div>}
      {tab === 'identifiers' && <div className="overview-content"><div className="section-title-row"><div><h2>Identifiers</h2><p>Sensitive identifiers are masked in the console.</p></div><span className="source-chip" title="Device identifiers are protected when stored."><Fingerprint size={14} /> Protected identifiers</span></div><div className="overview-grid"><InfoField label="Device ID" value={device.id} /><InfoField label="Intune device ID" value={device.intuneId} /><InfoField label="Serial number" value={device.serial} /><InfoField label="Physical MAC address" value="Not available in this portal" /></div><div className="signal-disclaimer"><LockKeyhole size={15} /><span>Some device details come from Microsoft Intune. This portal can’t read a device’s physical MAC address or directly control its operating system.</span></div></div>}
    </section>
  </>
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="info-field"><span>{label}</span><strong>{value}</strong></div>
}

function AuditPage({ events, isDemoMode, onExport, exporting, initialSearch, searchRequestVersion }: {
  events: AuditEvent[]
  isDemoMode: boolean
  onExport: (format: 'csv' | 'json') => void
  exporting: boolean
  initialSearch: string
  searchRequestVersion: number
}) {
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('All outcomes')
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch)
  }, [initialSearch, searchRequestVersion])
  const filtered = useMemo(() => events.filter((event) => {
    const matchesSearch = `${event.actor} ${event.action} ${event.target} ${event.correlationId} ${event.eventId} ${event.reason} ${event.scope ?? ''}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (outcome === 'All outcomes' || event.outcome.toLowerCase() === outcome.toLowerCase())
  }), [events, outcome, search])

  async function copyCorrelation(id: string) {
    try { await navigator.clipboard.writeText(id); setCopied(id); window.setTimeout(() => setCopied(''), 1500) } catch { setCopied('unavailable') }
  }

  return <>
    <PageHeading eyebrow="MODULE 10 / ACCOUNTABILITY" title="Audit log" description="Review past decisions and export a report for follow-up.">
      <button className="button bg-blue-600 hover:bg-blue-700 text-white fill-white stroke-white" title="Download the activity history as a CSV spreadsheet." style={{ color: '#ffffff' }} onClick={() => onExport('csv')} disabled={exporting}>
        <Download size={16} style={{ color: '#ffffff', stroke: '#ffffff' }} />{exporting ? 'Preparing file…' : 'Export to Excel / CSV'}
      </button>
      <button className="button button-secondary text-slate-700 stroke-slate-700" title="Download the activity history as a JSON file." style={{ color: '#334155' }} onClick={() => onExport('json')} disabled={exporting}>
        <Download size={16} style={{ color: '#334155', stroke: '#334155' }} />JSON
      </button>
    </PageHeading>
    <section className="executive-summary-grid audit-summary">
      <article title="Number of activity records in the selected workspace."><span className="summary-icon summary-blue"><Activity size={18} /></span><span>Events in workspace</span><strong>{events.length}</strong><small>{isDemoMode ? 'Representative sample' : 'Current workspace'}</small></article>
      <article title="Actions recorded as completed successfully."><span className="summary-icon summary-green"><CheckCircle2 size={18} /></span><span>Completed successfully</span><strong>{events.filter((event) => event.outcome === 'Success' || event.outcome === 'SUCCESS').length}</strong><small>Recorded governance actions</small></article>
      <article title="Events that were blocked or still need review."><span className="summary-icon summary-amber"><AlertTriangle size={18} /></span><span>Needs attention</span><strong>{events.filter((event) => event.outcome === 'Denied' || event.outcome === 'Review').length}</strong><small>Review outcomes and exceptions</small></article>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">RECENT ACTIVITY</span><h2>Security event history</h2><p>Review the action, its reason, and who recorded it.</p></div><span className="source-chip" title={isDemoMode ? 'Sample events and local demo actions; not an official audit record.' : 'Recorded events for the selected workspace.'}><LockKeyhole size={14} />{isDemoMode ? 'Sample history' : 'Activity history'}</span></div>
      <div className="table-toolbar audit-toolbar"><label className="search-field" title="Find activity by person, action, device, or reference ID."><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, events, or devices" /></label><label className="filter-select" title="Show activity with the selected result."><ListFilter size={15} /><select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter by outcome"><option>All outcomes</option><option>Success</option><option>Denied</option><option>Review</option></select><ChevronDown size={14} /></label></div>
      <div className="audit-event-list">{filtered.map((event) => <article className="audit-event-card" key={event.eventId}>
        <span className={`audit-event-icon ${event.outcome === 'Success' || event.outcome === 'SUCCESS' ? 'audit-event-success' : 'audit-event-attention'}`}>
          {event.outcome === 'Success' || event.outcome === 'SUCCESS' ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
        </span>
        <div className="audit-event-main"><div><strong title={event.action}>{friendlyAuditAction(event.action)}</strong><StatusPill tone={event.outcome.toLowerCase() === 'success' ? 'success' : event.outcome.toLowerCase() as 'denied' | 'review'}>{event.outcome}</StatusPill></div>
          <p>{event.reason}</p><small>{event.actor} · {event.role} · {event.date} at {event.time}{event.scope ? ` · ${event.scope}` : ''}</small>
        </div>
        <div className="audit-event-target"><span>Related to</span><strong>{event.target}</strong><button className="correlation-copy" title="Copy reference ID" onClick={() => void copyCorrelation(event.correlationId)}><span>{copied === event.correlationId ? 'Copied' : event.correlationId}</span>{copied === event.correlationId ? <Check size={14} /> : <Copy size={14} />}</button></div>
      </article>)}
      {filtered.length === 0 && <div className="executive-empty">No events match these filters.</div>}</div>
    </section>
    <p className="demo-data-note"><ShieldCheck size={15} />{isDemoMode ? 'This history contains sample and local demo actions; it is not an authoritative audit record.' : 'Audit events are scoped to the selected tenant and workspace.'}</p>
  </>
}

function ReviewDialog({ device, isDemoMode, onClose, onOpenDevice, onSubmit }: {
  device: Device
  isDemoMode: boolean
  onClose: () => void
  onOpenDevice: (device: Device) => void | Promise<void>
  onSubmit: (decision: 'Approved' | 'Rejected', justification: string) => Promise<void>
}) {
  const [decision, setDecision] = useState<'Approved' | 'Rejected'>('Approved')
  const [justification, setJustification] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit = justification.trim().length >= 12
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) { setError('Enter a reason with at least 12 characters.'); return }
    setIsSubmitting(true)
    setError('')
    try {
      await onSubmit(decision, justification)
    } catch (submitError) {
      setError('We couldn’t complete the decision. No change was confirmed; please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
    <div className="dialog-header"><div><span className="eyebrow">DEVICE REVIEW / {device.id}</span><h2 id="review-title">Review access request</h2></div><button className="icon-button" aria-label="Close review" onClick={onClose}><X size={18} /></button></div>
    <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div><button className="text-link" type="button" onClick={() => void onOpenDevice(device)}>Details <ArrowUpRight size={13} /></button></div>
    <div className="evidence-grid"><div title="Device identifier from Microsoft Intune."><span>Intune device ID</span><strong className="mono-id">{device.intuneId}</strong></div><div><span>Serial number (masked)</span><strong>{device.serial}</strong></div><div><span>Approval status</span><ApprovalPill state={device.approval} /></div><div><span>Security status</span><CompliancePill state={device.compliance} /></div></div>
    <div className="evidence-note"><MonitorCog size={15} /><span>{isDemoMode ? 'Demo review: this action changes sample data locally and is not an authoritative approval.' : 'Review the device identity and posture before making a decision.'}</span></div>
    <form onSubmit={submit}>
      <fieldset className="decision-fieldset"><legend>Decision</legend><div className="decision-options"><label className={`decision-option ${decision === 'Approved' ? 'decision-selected approve-selected' : ''}`}><input type="radio" name="decision" value="Approved" checked={decision === 'Approved'} onChange={() => setDecision('Approved')} /><span className="decision-icon"><CheckCircle2 size={17} /></span><span><strong>Approve</strong><small>Mark device approved</small></span></label><label className={`decision-option ${decision === 'Rejected' ? 'decision-selected reject-selected' : ''}`}><input type="radio" name="decision" value="Rejected" checked={decision === 'Rejected'} onChange={() => setDecision('Rejected')} /><span className="decision-icon"><X size={17} /></span><span><strong>Reject</strong><small>Deny this registration</small></span></label></div></fieldset>
      <label className="justification-label" htmlFor="justification">Reason for decision <span>Required</span></label><textarea id="justification" value={justification} onChange={(event) => { setJustification(event.target.value); setError('') }} placeholder="Briefly explain why you’re approving or rejecting this request…" rows={3} maxLength={500} required /><div className="textarea-meta"><span>{error || 'This reason is added to the activity history.'}</span><span>{justification.length}/500</span></div>
      <div className="dialog-footer"><span><LockKeyhole size={14} /> Decision is recorded</span><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="submit" className={`button ${decision === 'Rejected' ? 'button-danger' : 'button-primary'}`} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Submitting…' : decision === 'Approved' ? 'Approve device' : 'Reject device'}</button></div>
    </form>
  </section></div>
}

function RemoteCommandDialog({
  device,
  initialCommand,
  isDemoMode,
  onClose,
  onSubmit,
}: {
  device: Device
  initialCommand: RemoteCommand
  isDemoMode: boolean
  onClose: () => void
  onSubmit: (command: RemoteCommand, reason: string) => Promise<void>
}) {
  const [command, setCommand] = useState<RemoteCommand>(initialCommand)
  const [reason, setReason] = useState('')
  const [wipeConfirmed, setWipeConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit = reason.trim().length > 0 && (command !== 'WIPE' || wipeConfirmed)
  const commandName = command === 'LOCK' ? 'Lock access' : command === 'RETIRE' ? 'Retire device' : 'Record wipe request'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      setError(command === 'WIPE' && !wipeConfirmed ? 'Confirm the wipe request before submitting.' : 'Enter a reason for this action.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await onSubmit(command, reason.trim())
    } catch (submitError) {
      setError('We couldn’t complete the device action. No change was confirmed; please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
    <section className="review-dialog remote-command-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-command-title">
      <div className="dialog-header"><div><span className="eyebrow">DEVICE ACTION / {device.id}</span><h2 id="remote-command-title">Confirm device action</h2></div><button className="icon-button" aria-label="Close device action" title="Close without making a change." onClick={onClose} disabled={isSubmitting}><X size={18} /></button></div>
      <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div></div>
      <div className="evidence-note"><MonitorCog size={15} /><span>{isDemoMode ? 'Demo action: only the sample device state changes; no device command is sent.' : 'This request is recorded by the governance service. It does not send an operating-system command directly from the browser.'}</span></div>
      <form onSubmit={submit}>
        <label className="access-field remote-command-select" title="Choose the action to record for this device."><span>Action</span><select value={command} onChange={(event) => { setCommand(event.target.value as RemoteCommand); setError(''); setWipeConfirmed(false) }} disabled={isSubmitting}>
          <option value="LOCK">Lock access — temporarily block this device</option>
          <option value="RETIRE">Retire device — remove it from active use</option>
          <option value="WIPE">Record wipe request — no physical erase in this build</option>
        </select></label>
        {command === 'WIPE' && <label className="wipe-confirm"><input type="checkbox" checked={wipeConfirmed} onChange={(event) => { setWipeConfirmed(event.target.checked); setError('') }} /><span>I understand this records a wipe request; it does not erase the physical device in this build.</span></label>}
        <label className="justification-label remote-reason-label" htmlFor="remote-command-reason">Why is this action needed? <span>Required</span></label>
        <textarea id="remote-command-reason" value={reason} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Briefly explain why this action is needed…" rows={3} maxLength={500} required disabled={isSubmitting} />
        <div className="textarea-meta"><span>{error || 'Your reason and the action result are added to Activity History.'}</span><span>{reason.length}/500</span></div>
        <div className="dialog-footer"><span><LockKeyhole size={14} /> Action is recorded</span><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="submit" className={`button ${command === 'WIPE' ? 'button-danger' : 'button-primary'}`} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Submitting…' : commandName}</button></div>
      </form>
    </section>
  </div>
}

export default App