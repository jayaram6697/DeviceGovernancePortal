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
type Screen = 'identity' | 'scope' | 'approvals' | 'devices' | 'intune' | 'compliance' | 'access' | 'signals' | 'commands' | 'audit' | 'detail'
type DeviceKind = 'Laptop' | 'Phone' | 'Tablet'
type DemoWorkspace = 'Engineering' | 'Operations UAE' | 'Field Logistics'

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

type PersistedDemoState = {
  approvals: Record<string, ApprovalState>
  audit: AuditEvent[]
}

function demoStateStorageKey(tenant: string, workspace: DemoWorkspace): string {
  return `gatelogiq-demo-v1:${encodeURIComponent(tenant)}:${encodeURIComponent(workspace)}`
}

function isApprovalState(value: unknown): value is ApprovalState {
  return value === 'Pending' || value === 'Approved' || value === 'Rejected'
    || value === 'Suspended' || value === 'Revoked'
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
  const storedApprovals = value.approvals
  if (typeof storedApprovals !== 'object' || storedApprovals === null || Array.isArray(storedApprovals)
    || !Array.isArray(value.audit) || !value.audit.every(isAuditEvent)) {
    throw new Error('Stored demo data is incomplete or invalid.')
  }
  const approvals = Object.create(null) as Record<string, ApprovalState>
  for (const [deviceId, approval] of Object.entries(storedApprovals as Record<string, unknown>)) {
    if (!isApprovalState(approval)) throw new Error('Stored demo approval state is invalid.')
    approvals[deviceId] = approval
  }
  return { approvals, audit: value.audit }
}

function persistDemoState(storageKey: string, devices: Device[], audit: AuditEvent[]): void {
  const approvals = Object.create(null) as Record<string, ApprovalState>
  for (const device of devices) approvals[device.recordId] = device.approval
  window.localStorage.setItem(storageKey, JSON.stringify({ approvals, audit } satisfies PersistedDemoState))
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
      ? seededDevices.map((device) => ({ ...device, approval: persisted.approvals[device.recordId] ?? device.approval }))
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

const navSections: { title: string; links: { label: string; screen: Screen; icon: LucideIcon; badge?: string }[] }[] = [
  {
    title: 'Modules 1–10',
    links: [
      { label: '1. Authentication & Roles', screen: 'identity', icon: Fingerprint },
      { label: '2. Workspace & Tenants', screen: 'scope', icon: MonitorCog },
      { label: '3. Device Registry', screen: 'devices', icon: Smartphone },
      { label: '4. Approval Queue', screen: 'approvals', icon: CheckCircle2, badge: 'pending' },
      { label: '5. Intune Sync', screen: 'intune', icon: RefreshCw },
      { label: '6. Compliance Posture', screen: 'compliance', icon: ShieldAlert },
      { label: '7. PWA Gatekeeper', screen: 'access', icon: ShieldCheck },
      { label: '8. Activity Signals', screen: 'signals', icon: Activity },
      { label: '9. Remote Commands', screen: 'commands', icon: LockKeyhole },
      { label: '10. Audit & Evidence', screen: 'audit', icon: FileClock },
    ],
  },
]

function StatusPill({ children, tone }: { children: string; tone: 'pending' | 'approved' | 'rejected' | 'compliant' | 'noncompliant' | 'stale' | 'success' | 'denied' | 'review' }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{children}</span>
}

function DeviceGlyph({ kind }: { kind: DeviceKind }) {
  const Icon = kind === 'Laptop' ? Laptop : kind === 'Phone' ? Smartphone : MonitorCog
  return <span className={`device-glyph glyph-${kind.toLowerCase()}`}><Icon size={18} strokeWidth={1.8} /></span>
}

function LoginPage({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState('')
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
      <div className="login-heading"><h1 id="login-title">Sign in to your account</h1><p>Use your enterprise email and password to continue.</p></div>
      <form className="login-form" onSubmit={submit}>
        <label className="login-field"><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="username" required /></label>
        <label className="login-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /></label>
        <div className="login-options">
          <button type="button" className="forgot-password" onClick={() => setHelpMessage('Password resets are not configured in demo mode.')}>Forgot password?</button>
        </div>
        {helpMessage && <p className="login-help-message" role="status">{helpMessage}</p>}
        <button className="login-submit" type="submit">Sign In</button>
      </form>
      <p className="login-demo-notice">Demo sign-in · Identity provider is not configured.</p>
    </section>
  </main>
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(true)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [demoWorkspace, setDemoWorkspace] = useState<DemoWorkspace>('Engineering')
  const demoWorkspaceRef = useRef<DemoWorkspace>('Engineering')
  demoWorkspaceRef.current = demoWorkspace
  const [demoDataScope, setDemoDataScope] = useState<{ tenant: string; workspace: DemoWorkspace } | null>(null)
  const [screen, setScreen] = useState<Screen>('approvals')
  const [devices, setDevices] = useState<Device[]>([])
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
            sampleDevices = createDemoDevices(demoWorkspace)
            sampleAudit = createDemoAudit()
            setApiError('Saved demo data could not be restored; the initial sample data is shown.')
          }
          setDevices(sampleDevices)
          setAudit(sampleAudit)
          setDemoDataScope({ tenant, workspace: fallbackWorkspace })
          setSelectedDeviceId(sampleDevices[0]?.recordId ?? '')
          setIsDemoMode(true)
          setConnectionRetryMessage(reloadToken > 0 ? 'The backend is still offline. Demo mode remains available.' : '')
        } else {
          setIsDemoMode(false)
          setDemoDataScope(null)
          setConnectionRetryMessage(reloadToken > 0 ? 'The live service returned an error. See the status message below.' : '')
          setApiError('Live governance records could not be loaded. No sample data was substituted for a server error.')
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
  const visibleWorkspace = isDemoMode ? demoWorkspace : workspace
  const screenTitle: Record<Screen, string> = {
    identity: 'Authentication & Roles',
    scope: 'Workspace & Tenants',
    approvals: 'Approval Queue',
    devices: 'Device registry',
    intune: 'Intune sync',
    compliance: 'Compliance posture',
    access: 'PWA gatekeeper',
    signals: 'Activity signals',
    commands: 'Remote commands',
    audit: 'Audit & evidence',
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
      setApiError('The sync request could not be completed. No successful synchronization was confirmed.')
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
      setApiError('The audit file could not be downloaded. No export was confirmed.')
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

  function navigate(next: Screen) {
    setScreen(next)
    setMobileNavOpen(false)
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
            <span className="tenant-avatar">AC</span>
            <label className="select-stack"><span>Tenant</span><select value={tenant} onChange={(event) => setTenant(event.target.value)} aria-label="Tenant"><option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option></select></label>
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
                {badge && <span className="nav-badge">{pendingCount}</span>}
              </button>
            })}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-mini ${isMdmSyncFresh ? 'sync-mini-current' : ''}`} role="status">
            <span className="sync-mini-dot" aria-hidden="true" />
            <span>{`Intune Sync: ${isMdmSyncFresh ? 'Healthy' : 'Delayed'} (${formatCompactRelativeTime(latestMdmSyncAt) ?? '—'})`}</span>
          </div>
          <div className="profile-menu-wrapper" ref={profileMenuRef}>
            <button type="button" className="profile-row" aria-label="Open user profile details" aria-haspopup="dialog" aria-expanded={profileMenuOpen} aria-controls="profile-details" onClick={() => setProfileMenuOpen((open) => !open)}>
              <span className="profile-avatar">IT</span><span className="profile-copy"><strong>{userEmail}</strong><small>Customer IT Administrator</small></span><MoreHorizontal size={18} />
            </button>
            {profileMenuOpen && <div className="profile-popover" id="profile-details" role="dialog" aria-label="User profile details">
              <div className="profile-popover-details"><span className="profile-popover-avatar">IT</span><span className="profile-popover-copy"><strong>{userEmail}</strong><small>Active demo session</small><span className="profile-role-badge">Customer IT Administrator</span></span></div>
            </div>}
          </div>
        </div>
      </aside>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>{tenant}</span><ChevronRight size={14} /><strong>{screenTitle[screen]}</strong></div>
          <div className="topbar-actions">
            <button className="global-search" type="button" onClick={() => { setSearchQuery(''); setIsSearchOpen(true) }} aria-label="Search devices, users, and modules"><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
            <button className="icon-button topbar-help" aria-label="Help"><CircleHelp size={18} /></button>
            <div className="notification-anchor" ref={notificationMenuRef}>
              <button
                className="icon-button notification-button"
                type="button"
                aria-label="Notifications"
                aria-haspopup="dialog"
                aria-expanded={isNotificationsOpen}
                aria-controls="notification-menu"
                onClick={() => setIsNotificationsOpen((open) => !open)}
              >
                <Bell size={18} />
                {hasUnreadNotifications && <span />}
              </button>
              {isNotificationsOpen && <section className="notification-menu" id="notification-menu" role="dialog" aria-label="Notifications">
                <header className="notification-menu-header">
                  <h2>Notifications</h2>
                  <button type="button" onClick={() => setHasUnreadNotifications(false)} disabled={!hasUnreadNotifications}>Mark as read</button>
                </header>
                <div className="notification-list">
                  <article className="notification-item">
                    <span className="notification-emoji" aria-hidden="true">⚠️</span>
                    <span><strong>Intune sync delayed</strong><small>Last synchronization was 45 minutes ago.</small></span>
                  </article>
                  <button type="button" className="notification-item notification-action" onClick={() => { navigate('approvals'); setIsNotificationsOpen(false) }}>
                    <span className="notification-emoji" aria-hidden="true">📱</span>
                    <span><strong>Approval required</strong><small>Sarah&apos;s Corporate iPad Pro requested PWA access.</small></span>
                    <ChevronRight size={16} />
                  </button>
                  <article className="notification-item">
                    <span className="notification-emoji" aria-hidden="true">🛡️</span>
                    <span><strong>Compliance posture alert</strong><small>Samsung Galaxy Tab Active4 failed disk encryption rule.</small></span>
                  </article>
                </div>
              </section>}
            </div>
            <div className="topbar-account"><span className="profile-avatar">IT</span><button className="sign-out-button" aria-label="Sign Out" onClick={signOut}><LogOut size={14} /><span>Sign Out</span></button></div>
          </div>
        </header>

        <main className="page-content">
          <div className={`connection-banner ${isDemoMode ? 'connection-banner-demo' : ''}`} role="status">
            <span className="connection-banner-icon">{isDemoMode ? <MonitorCog size={18} /> : <ShieldCheck size={18} />}</span>
            <div><strong>{isLoading ? 'Connecting to governance data…' : connectionRetryMessage ? (isDemoMode ? 'Live connection unavailable · demo mode active' : 'Live connection unavailable') : isDemoMode ? 'Demo mode · backend offline' : 'Governance data connected'}</strong>
              <span>{connectionRetryMessage || (isDemoMode ? 'Showing representative sample records. Changes are local only and are not sent to connected services.' : isLoading ? 'Loading the selected tenant and workspace.' : `Last device synchronization: ${formatRelativeTime(latestMdmSyncAt) ?? 'not recorded'}.`)}</span>
            </div>
            {isDemoMode && <div className="connection-banner-actions">
              <button className="button button-secondary" onClick={() => setReloadToken((current) => current + 1)} disabled={isLoading}>Retry live connection</button>
              <button className="button button-secondary" onClick={resetDemoData}>Reset Demo Data</button>
            </div>}
          </div>

          {apiError && <div className="friendly-error" role="alert"><AlertTriangle size={17} /><span>{apiError}</span><button type="button" aria-label="Dismiss message" onClick={() => setApiError('')}><X size={15} /></button></div>}
          {isLoading && <div className="loading-state" role="status">Loading devices for {visibleWorkspace}…</div>}

          {screen === 'identity' && <IdentityRolesPage email={userEmail} tenant={tenant} workspace={visibleWorkspace} isDemoMode={isDemoMode} />}
          {screen === 'scope' && <WorkspaceTenantsPage tenant={tenant} workspace={visibleWorkspace} isDemoMode={isDemoMode} demoWorkspace={demoWorkspace} onTenantChange={setTenant} onWorkspaceChange={(next) => isDemoMode ? switchDemoWorkspace(next as DemoWorkspace) : setWorkspace(next)} />}
          {screen === 'approvals' && <ApprovalsPage devices={devices} workspace={visibleWorkspace} isDemoMode={isDemoMode} onReview={(device) => setReviewDeviceId(device.id)} />}
          {screen === 'devices' && <DevicesPage devices={devices} isDemoMode={isDemoMode} onOpenDevice={openDevice} />}
          {screen === 'intune' && <IntunePage devices={devices} latestSyncAt={latestMdmSyncAt} syncIsFresh={isMdmSyncFresh} isSyncing={isSyncing} isDemoMode={isDemoMode} onSync={() => void runIntuneSync()} />}
          {screen === 'compliance' && <CompliancePage devices={devices} isDemoMode={isDemoMode} onOpenDevice={openDevice} />}
          {screen === 'detail' && detailLoading && <div className="loading-state" role="status">Loading device details…</div>}
          {screen === 'detail' && !detailLoading && selectedDevice && <DeviceDetail device={selectedDevice} onBack={() => navigate('devices')} onRemoteCommand={openRemoteCommand} />}
          {screen === 'audit' && <AuditPage events={audit} isDemoMode={isDemoMode} onExport={exportAudit} exporting={exportingAudit} />}
          {screen === 'access' && <PwaAccessPage devices={devices} isDemoMode={isDemoMode} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} onEvaluate={testPwaAccess} />}
          {screen === 'signals' && <SignalsPage devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />}
          {screen === 'commands' && <RemoteCommandsPage devices={devices} isDemoMode={isDemoMode} onRemoteCommand={openRemoteCommand} />}
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
              placeholder="Search devices, assigned users, or modules..."
              aria-label="Search devices, assigned users, or modules"
            />
            <kbd>ESC</kbd>
          </label>
          <div className="global-search-results" aria-live="polite">
            {!searchTerm && <p className="global-search-hint">Type to find a device, assigned user, or governance module.</p>}
            {searchTerm && matchingModules.length === 0 && matchingDevices.length === 0 && <p className="global-search-hint">No devices or modules match “{searchQuery.trim()}”.</p>}
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
          </div>
        </section>
      </div>}

      {reviewDevice && <ReviewDialog key={reviewDevice.recordId} device={reviewDevice} isDemoMode={isDemoMode} onClose={() => setReviewDeviceId(null)} onOpenDevice={openDevice} onSubmit={submitDecision} />}
      {remoteCommandDevice && <RemoteCommandDialog device={remoteCommandDevice} initialCommand={remoteCommandInitial} isDemoMode={isDemoMode} onClose={() => setRemoteCommandDevice(null)} onSubmit={runRemoteCommand} />}
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="toast-close" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>
}

function PwaAccessPage({
  devices,
  isDemoMode,
  selectedDeviceId,
  onSelectDevice,
  onEvaluate,
}: {
  devices: Device[]
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
    <PageHeading eyebrow="MODULE 7 / APPLICATION ACCESS" title="PWA Gatekeeper" description="Check whether a device meets the safeguards for GateLogiq Workspace." />
    <div className="simulator-layout">
    <section className="panel access-simulator">
      <div className="panel-heading"><div><h2>Check device security</h2><p>Choose a device to see whether it is ready to access the workspace.</p></div><span className="source-chip"><Shield size={14} /> {isDemoMode ? 'Demo check' : 'Security check'}</span></div>
      <div className="access-form">
        <label className="access-field"><span>Device</span><select value={selected?.recordId ?? ''} onChange={(event) => onSelectDevice(event.target.value)} disabled={devices.length === 0 || isEvaluating}>
          {devices.length === 0 && <option value="">No devices available</option>}
          {devices.map((device) => <option key={device.recordId} value={device.recordId}>{device.id} · {device.name} — {device.owner}</option>)}
        </select></label>
        <label className="access-field"><span>Requested application</span><select value={requestedAppId} onChange={(event) => { setRequestedAppId(event.target.value); setResult(null); setError('') }} disabled={isEvaluating}>
          <option value="com.northstar.workspace">GateLogiq Workspace</option>
          <option value="com.northstar.support">GateLogiq Support</option>
          <option value="com.northstar.analytics">GateLogiq Analytics</option>
        </select></label>
        {selected && <div className="access-subject"><DeviceGlyph kind={selected.kind} /><div><strong>{selected.owner}</strong><span>{selected.email} · {selected.workspace}</span></div><span className="access-subject-id">User ID: {selected.ownerUserId}</span></div>}
        <button className="button button-primary access-test-button" onClick={() => void evaluate()} disabled={!selected || isEvaluating}>
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
        {result.decision === 'DENY' && <div className="access-reason-code"><span>Reason code</span><code>{result.reasonCode}</code></div>}
        {result.grant && <div className="access-grant">
          <div><span>Mock grant token</span><code>{result.grant.token}</code></div>
          <div><span>Expires</span><strong>{new Date(result.grant.expiresAt).toLocaleTimeString()}</strong></div>
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
    <PageHeading eyebrow="MODULE 1 / IDENTITY AND ACCESS" title="Authentication & Roles" description="A clear view of your account, security status, and what you can manage." />
    <section className="executive-user-card">
      <div className="executive-user-avatar"><Users size={24} /></div>
      <div className="executive-user-main">
        <span className="executive-kicker">SIGNED IN AS</span>
        <h2>Customer IT Administrator</h2>
        <p>{email || 'Administrator account'} <span>·</span> {tenant}</p>
      </div>
      <span className={`executive-status ${isDemoMode ? 'executive-status-demo' : ''}`}>
        <CheckCircle2 size={16} /> {isDemoMode ? 'MFA Verified · demo profile' : 'MFA status not provided'}
      </span>
      <div className="executive-user-facts">
        <div><span>Assigned workspaces</span><strong>{isDemoMode ? 'All' : workspace}</strong></div>
        <div><span>Security posture</span><strong>{isDemoMode ? 'MFA Verified' : 'Not available from sign-in provider'}</strong></div>
        <div><span>Account status</span><strong>Active</strong></div>
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
    <PageHeading eyebrow="MODULE 2 / TENANT AND WORKSPACE" title="Workspace & Tenants" description="Choose the team workspace whose devices and access requests you want to review." />
    <section className="workspace-tenant-bar">
      <label><span>Tenant</span><select value={tenant} onChange={(event) => onTenantChange(event.target.value)} aria-label="Select tenant">
        <option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option>
      </select></label>
      <span><span className="workspace-indicator" />{isDemoMode ? 'Sample portfolio' : 'Live tenant scope'}</span>
    </section>
    {isDemoMode
      ? <section className="executive-workspace-grid" aria-label="Available workspaces">
        {demoWorkspaceCards.map(({ name, devices, teams, icon: Icon }) => {
          const isActive = demoWorkspace === name
          return <article className={`executive-workspace-card ${isActive ? 'workspace-card-active' : ''}`} key={name}>
            <div className="workspace-card-top"><span className="workspace-card-icon"><Icon size={20} /></span>{isActive && <span className="workspace-active-badge"><Check size={13} /> Active</span>}</div>
            <h2>{name}</h2><p>{teams}</p>
            <div className="workspace-card-count"><strong>{devices}</strong><span>managed devices</span></div>
            <button type="button" className={`button ${isActive ? 'button-secondary' : 'button-primary'}`} disabled={isActive} onClick={() => onWorkspaceChange(name)}>
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
    <PageHeading eyebrow="MODULE 5 / DEVICE MANAGEMENT" title="Intune Sync" description="Keep your company device inventory up to date." />
    <section className={`executive-sync-hero ${isHealthy ? 'sync-hero-healthy' : ''}`} aria-label="Intune connection status">
      <div className="sync-hero-top">
        <span className="sync-hero-icon"><MonitorCog size={24} /></span>
        <div><span className="executive-kicker">MICROSOFT INTUNE CONNECTION</span>
          <h2>{isDemoMode ? 'Demo preview · connection not verified' : isHealthy ? 'Healthy & online' : 'Needs attention'}</h2>
        </div>
        <span className={`executive-status ${isDemoMode ? 'executive-status-demo' : isHealthy ? '' : 'executive-status-attention'}`}>
          <span className="workspace-indicator" />{isDemoMode ? 'Sample data' : isHealthy ? 'Connected' : 'Check sync'}
        </span>
      </div>
      <div className="sync-hero-stats">
        <div><span>Last synchronized</span><strong>{formatRelativeTime(latestSyncAt) ?? 'Not recorded'}</strong></div>
        <div><span>Total cloud devices</span><strong>{isDemoMode ? '1,284' : devices.length.toLocaleString()}</strong></div>
        <div><span>Sync freshness</span><strong>{isDemoMode ? 'Sample' : syncIsFresh ? 'Within 60 minutes' : 'Over 60 minutes'}</strong></div>
      </div>
      <div className="sync-hero-actions">
        <button className="button button-primary" onClick={onSync} disabled={isSyncing}>
          <RefreshCw size={16} className={isSyncing ? 'sync-spinning' : ''} />{isSyncing ? 'Syncing…' : 'Sync with Intune Now'}
        </button>
        <span>{isDemoMode ? 'This button updates sample timestamps locally.' : 'Sync requests are sent through the governance service.'}</span>
      </div>
    </section>
    <section className="executive-summary-grid">
      <article><span className="summary-icon summary-blue"><Smartphone size={18} /></span><span>In this workspace</span><strong>{devices.length.toLocaleString()}</strong><small>Representative device records</small></article>
      <article><span className="summary-icon summary-green"><CheckCircle2 size={18} /></span><span>Last sync</span><strong>{latestSyncAt ? new Date(latestSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</strong><small>{latestSyncAt ? new Date(latestSyncAt).toLocaleDateString() : 'No timestamp available'}</small></article>
      <article><span className="summary-icon summary-blue"><ShieldCheck size={18} /></span><span>Provider</span><strong>Microsoft Intune</strong><small>Managed device inventory</small></article>
    </section>
  </>
}

function CompliancePage({ devices, isDemoMode, onOpenDevice }: { devices: Device[]; isDemoMode: boolean; onOpenDevice: (device: Device) => void }) {
  const compliantCount = devices.filter((device) => device.compliance === 'Compliant').length
  const nonCompliantCount = devices.filter((device) => device.compliance === 'Non-compliant').length
  const staleCount = devices.filter((device) => device.compliance === 'Stale').length
  const complianceRate = devices.length ? `${Math.round(compliantCount / devices.length * 100)}%` : '—'
  const policies = [
    { title: 'Operating system policy', detail: 'iOS 17+ and Windows 11 devices are supported.', status: 'Policy active' },
    { title: 'Disk encryption', detail: 'BitLocker and FileVault evidence is required.', status: 'Policy active' },
    { title: 'Freshness SLA', detail: 'Device records should sync within 60 minutes.', status: 'Policy active' },
  ]

  return <>
    <PageHeading eyebrow="MODULE 6 / DEVICE SAFETY" title="Compliance Posture" description="See the safeguards your organization expects and which devices may need attention." />
    <section className="compliance-summary">
      <div><span className="compliance-summary-icon"><ShieldCheck size={20} /></span><span>Devices meeting policy</span><strong>{complianceRate}</strong><small>{compliantCount} of {devices.length} records</small></div>
      <div><span className="compliance-summary-icon compliance-summary-warning"><AlertTriangle size={20} /></span><span>Needs attention</span><strong>{(nonCompliantCount + staleCount).toLocaleString()}</strong><small>Non-compliant or out of date</small></div>
    </section>
    <section className="policy-card-grid" aria-label="Active security policies">
      {policies.map((policy) => <article className="policy-card" key={policy.title}>
        <span className="policy-check"><Check size={18} /></span><div><h2>{policy.title}</h2><p>{policy.detail}</p></div><span className="policy-state">{policy.status}</span>
      </article>)}
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">DEVICE CHECKS</span><h2>Posture by device</h2><p>Policy settings are active; these are the current device results.</p></div><span className="source-chip"><ShieldCheck size={14} />{isDemoMode ? 'Sample checks' : 'Reported posture'}</span></div>
      {devices.map((device) => <button type="button" className="executive-device-row" key={device.recordId} onClick={() => void onOpenDevice(device)}>
        <DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.owner} · Last checked {formatRelativeTime(device.lastMdmSyncAt) ?? 'not recorded'}</small></span><CompliancePill state={device.compliance} /><ChevronRight size={17} />
      </button>)}
      {devices.length === 0 && <p className="executive-empty">Device posture will appear here when records are available.</p>}
    </section>
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
    <PageHeading eyebrow="MODULE 8 / SOURCED TELEMETRY" title="Activity signals" description="Inspect the seven independently sourced activity timestamps for a managed device.">
      <label className="module-device-picker"><span>Device</span><select value={selected?.recordId ?? ''} onChange={(event) => onSelectDevice(event.target.value)} disabled={devices.length === 0}>
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
            return <article className={`signal-card ${index === 6 ? 'signal-logout' : ''}`} key={signal.label}>
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
    <PageHeading eyebrow="MODULE 9 / DEVICE CARE" title="Remote Commands" description="Choose a device action. Every command requires a reason and a final confirmation." />
    <section className="remote-device-grid">
      {devices.map((device) => <article className="remote-device-card" key={device.recordId}>
        <div className="remote-device-heading"><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.owner} · {device.workspace}</small></span><span className={`lifecycle-pill lifecycle-${device.lifecycleState.toLowerCase()}`}>{device.lifecycleState}</span></div>
        <p>Choose an action for this device:</p>
        <div className="remote-action-grid">
          <button type="button" className="remote-action-lock" onClick={() => onRemoteCommand(device, 'LOCK')}><LockKeyhole size={16} />Lock</button>
          <button type="button" className="remote-action-retire" onClick={() => onRemoteCommand(device, 'RETIRE')}><Package size={16} />Retire</button>
          <button type="button" className="remote-action-wipe" onClick={() => onRemoteCommand(device, 'WIPE')}><AlertTriangle size={16} />Wipe</button>
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
    <PageHeading eyebrow="MODULE 4 / ACCESS REQUESTS" title="Approval Queue" description="Review devices that are waiting for secure workspace access." />
    <section className="executive-summary-grid approval-summary">
      <article><span className="summary-icon summary-amber"><Clock3 size={18} /></span><span>Waiting for review</span><strong>{pending.length}</strong><small>Requests in {workspace}</small></article>
      <article><span className="summary-icon summary-green"><CheckCircle2 size={18} /></span><span>Approved devices</span><strong>{approvedCount}</strong><small>Approval does not replace security checks</small></article>
      <article><span className="summary-icon summary-amber"><ShieldAlert size={18} /></span><span>Posture needs attention</span><strong>{attentionCount}</strong><small>Review the device safety details</small></article>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">ACTION REQUIRED</span><h2>Access requests</h2><p>Approval changes require a short reason and are added to the audit history.</p></div></div>
      <div className="approval-request-toolbar">
        <label className="executive-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests or people" /></label>
        <span className="source-chip"><span className="workspace-indicator" />{isDemoMode ? 'Sample requests' : 'Current requests'}</span>
      </div>
      <div className="approval-card-grid">
        {filteredPending.map((device) => {
          const age = formatRelativeTime(device.signals.find((signal) => signal.label === 'PWA authentication')?.occurredAt ?? null) ?? 'Recently'
          return <article className="approval-request-card" key={device.recordId}>
            <div className="approval-card-top"><span className="approval-request-icon"><Smartphone size={21} /></span><span className="approval-request-age"><Clock3 size={14} />Requested {age}</span></div>
            <h3>{device.name}</h3><p>{device.owner} requested access to {device.workspace}.</p>
            <div className="approval-evidence"><span><strong>Device safety</strong><CompliancePill state={device.compliance} /></span><span><strong>Platform</strong><small>{device.platform} {device.version}</small></span></div>
            <div className="approval-card-actions">
              <button type="button" className="button button-primary" onClick={() => onReview(device)}><CheckCircle2 size={16} />Review &amp; Decide</button>
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
  return <span className={`compliance-pill compliance-${tone}`}><Icon size={13} />{state}</span>
}

function DevicesPage({ devices, isDemoMode, onOpenDevice }: {
  devices: Device[]
  isDemoMode: boolean
  onOpenDevice: (device: Device) => void
}) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('All approval states')
  const filtered = devices.filter((device) =>
    `${device.name} ${device.owner} ${device.email} ${device.id} ${device.intuneId} ${device.platform} ${device.version} ${device.approval}`
      .toLowerCase().includes(search.toLowerCase())
      && (state === 'All approval states' || device.approval === state))
  return <>
    <PageHeading eyebrow="MODULE 3 / MANAGED DEVICES" title="Device Registry" description="A simple view of the devices connected to your organization." />
    <section className="executive-summary-grid">
      <article><span className="summary-icon summary-blue"><Smartphone size={18} /></span><span>Devices in view</span><strong>{devices.length}</strong><small>{isDemoMode ? 'Representative sample' : 'Current workspace'}</small></article>
      <article><span className="summary-icon summary-green"><ShieldCheck size={18} /></span><span>Authorized</span><strong>{devices.filter((device) => device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active').length}</strong><small>Approved and meeting policy</small></article>
      <article><span className="summary-icon summary-amber"><Clock3 size={18} /></span><span>Needs review</span><strong>{devices.filter((device) => device.approval === 'Pending' || device.compliance !== 'Compliant').length}</strong><small>Approval or safety action needed</small></article>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">DEVICE OVERVIEW</span><h2>Your managed devices</h2><p>Owner, model, and access readiness at a glance.</p></div><span className="source-chip"><MonitorCog size={14} />{isDemoMode ? 'Sample inventory' : 'Current inventory'}</span></div>
      <div className="table-toolbar executive-device-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search devices or owners" /></label><label className="filter-select"><ListFilter size={15} /><select value={state} onChange={(event) => setState(event.target.value)} aria-label="Filter by approval state"><option>All approval states</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Suspended</option><option>Revoked</option></select><ChevronDown size={14} /></label></div>
      <div className="device-card-grid">{filtered.map((device) => {
        const latestActivity = device.signals.reduce<string | null>((latest, signal) =>
          signal.occurredAt && (!latest || new Date(signal.occurredAt) > new Date(latest)) ? signal.occurredAt : latest, null)
        const initials = device.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
        const isAuthorized = device.approval === 'Approved' && device.compliance === 'Compliant' && device.lifecycleState === 'Active'
        return <article className="device-card" key={device.recordId}>
          <div className="device-card-top"><DeviceGlyph kind={device.kind} /><span className="device-platform-tag">{device.platform} {device.version}</span></div>
          <div className="device-card-title"><strong>{device.name}</strong><span>{device.hardwareModel ?? 'Hardware model not provided'} · {device.id}</span></div>
          <div className="device-card-owner"><span className="owner-avatar">{initials}</span><span><strong>{device.owner}</strong><small>{device.email}</small></span></div>
          <div className="device-card-status">{isAuthorized ? <span className="authorized-pill"><CheckCircle2 size={14} />Authorized</span> : <><ApprovalPill state={device.approval} /><CompliancePill state={device.compliance} /></>}</div>
          <details className="device-signals-disclosure">
            <summary><span>Recent activity</span><ChevronDown size={14} /></summary>
            <div className="device-signals-list">{device.signals.map((signal) => <div className="device-signal-item" key={signal.label}><span>{friendlySignalTitle(signal.label)}</span><strong>{signal.value ?? 'Not recorded'}</strong></div>)}</div>
          </details>
          <div className="device-card-footer"><span className="device-last-activity"><Activity size={14} />{formatRelativeTime(latestActivity) ?? 'No recent activity'}</span><button className="button button-tertiary" onClick={() => onOpenDevice(device)}>View details <ChevronRight size={14} /></button></div>
        </article>
      })}{filtered.length === 0 && <div className="empty-devices">No devices match these filters.</div>}</div>
      <div className="table-footer"><span>Showing <strong>{filtered.length}</strong> device records {isDemoMode ? 'from the sample inventory' : 'in this workspace'}</span></div>
    </section>
  </>
}

function ApprovalPill({ state }: { state: ApprovalState }) {
  const tone = state === 'Approved' ? 'approved' : state === 'Pending' ? 'pending' : 'rejected'
  return <StatusPill tone={tone}>{state}</StatusPill>
}

function DeviceDetail({ device, onBack, onRemoteCommand }: { device: Device; onBack: () => void; onRemoteCommand: (device: Device, command?: RemoteCommand) => void }) {
  const [tab, setTab] = useState<'overview' | 'activity' | 'identifiers'>('activity')
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Back to device inventory</button>
    <div className="detail-title-row"><div className="detail-identity"><DeviceGlyph kind={device.kind} /><div><div className="eyebrow">DEVICE RECORD / {device.id}</div><h1>{device.name}</h1><p>{device.owner} <i /> {device.email}</p></div></div><button className="button button-secondary" onClick={() => onRemoteCommand(device)}><MoreHorizontal size={16} /> Remote command <ChevronDown size={14} /></button></div>
    <section className="device-status-strip"><div className="device-status-intro"><span className="mini-label">LIFECYCLE STATUS</span><span>Access decision and security posture are independent.</span><span className={`lifecycle-pill lifecycle-${device.lifecycleState.toLowerCase()}`}>{device.lifecycleState}</span></div><div className="state-pair"><div><span className="mini-label">APPROVAL</span><ApprovalPill state={device.approval} /></div><div><span className="mini-label">COMPLIANCE</span><CompliancePill state={device.compliance} /></div></div><div className="workspace-status"><span className="mini-label">WORKSPACE</span><strong><span className="workspace-indicator" />{device.workspace}</strong></div></section>
    <section className="panel detail-panel"><div className="detail-tabs" role="tablist" aria-label="Device information"><button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'tab-active' : ''} onClick={() => setTab('overview')}>Overview</button><button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'tab-active' : ''} onClick={() => setTab('activity')}>Activity signals <span className="tab-count">7</span></button><button role="tab" aria-selected={tab === 'identifiers'} className={tab === 'identifiers' ? 'tab-active' : ''} onClick={() => setTab('identifiers')}>Identifiers</button></div>
      {tab === 'activity' && <div className="activity-content"><div className="section-title-row"><div><h2>Last-used activity signals</h2><p>Independent timestamps from their authoritative sources. No combined “last used” value.</p></div><span className="freshness-label"><span className="freshness-dot" />Signal timestamps</span></div><div className="signal-grid">{device.signals.map((signal, index) => {
        const Icon = signal.icon
        return <article className={`signal-card ${index === 6 ? 'signal-logout' : ''}`} key={signal.label}><div className="signal-card-head"><span className="signal-icon"><Icon size={16} /></span><span className="signal-index">0{index + 1}</span></div><h3>{signal.label}</h3><strong className={signal.value ? '' : 'signal-null'}>{signal.value ?? 'Not recorded'}</strong><div className="signal-source"><span>Source</span><span>{signal.source}</span></div>{signal.note && signal.value && <small className="signal-note">{signal.note}</small>}</article>
      })}</div><div className="signal-disclaimer"><Shield size={15} /><span>Hardware inventory and remote management data are provided by Intune. A browser PWA cannot read physical MAC addresses or issue OS-level commands.</span></div></div>}
      {tab === 'overview' && <div className="overview-content"><div className="section-title-row"><div><h2>Device overview</h2><p>Identity and enrollment details synchronized from the MDM provider.</p></div><span className="source-chip"><MonitorCog size={14} /> Microsoft Intune</span></div><div className="overview-grid"><InfoField label="Device record" value={device.id} /><InfoField label="Intune managed-device ID" value={device.intuneId} /><InfoField label="Assigned owner" value={device.owner} /><InfoField label="Platform" value={`${device.platform} ${device.version}`} /><InfoField label="Masked serial number" value={device.serial} /><InfoField label="Enrollment date" value={device.enrolled} /><InfoField label="Workspace" value={device.workspace} /><InfoField label="MDM source" value="Microsoft Intune" /></div></div>}
      {tab === 'identifiers' && <div className="overview-content"><div className="section-title-row"><div><h2>Identifiers</h2><p>Sensitive identifiers are masked in the console.</p></div><span className="source-chip"><Fingerprint size={14} /> HMAC lookup enabled</span></div><div className="overview-grid"><InfoField label="Device UUID" value={device.id} /><InfoField label="Intune managed-device ID" value={device.intuneId} /><InfoField label="Serial number" value={device.serial} /><InfoField label="MAC address" value="Not collected by PWA" /></div><div className="signal-disclaimer"><LockKeyhole size={15} /><span>MAC and hardware identifiers are sourced from Intune telemetry and stored as protected lookup values where configured.</span></div></div>}
    </section>
  </>
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="info-field"><span>{label}</span><strong>{value}</strong></div>
}

function AuditPage({ events, isDemoMode, onExport, exporting }: {
  events: AuditEvent[]
  isDemoMode: boolean
  onExport: (format: 'csv' | 'json') => void
  exporting: boolean
}) {
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('All outcomes')
  const [copied, setCopied] = useState('')
  const filtered = useMemo(() => events.filter((event) => {
    const matchesSearch = `${event.actor} ${event.action} ${event.target} ${event.correlationId} ${event.eventId} ${event.reason} ${event.scope ?? ''}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (outcome === 'All outcomes' || event.outcome === outcome)
  }), [events, outcome, search])

  async function copyCorrelation(id: string) {
    try { await navigator.clipboard.writeText(id); setCopied(id); window.setTimeout(() => setCopied(''), 1500) } catch { setCopied('unavailable') }
  }

  return <>
    <PageHeading eyebrow="MODULE 10 / ACCOUNTABILITY" title="Audit & Evidence" description="A clear history of important device and access decisions.">
      <button className="button bg-blue-600 hover:bg-blue-700 text-white fill-white stroke-white" style={{ color: '#ffffff' }} onClick={() => onExport('csv')} disabled={exporting}>
        <Download size={16} style={{ color: '#ffffff', stroke: '#ffffff' }} />{exporting ? 'Preparing file…' : 'Export to Excel / CSV'}
      </button>
      <button className="button button-secondary text-slate-700 stroke-slate-700" style={{ color: '#334155' }} onClick={() => onExport('json')} disabled={exporting}>
        <Download size={16} style={{ color: '#334155', stroke: '#334155' }} />JSON
      </button>
    </PageHeading>
    <section className="executive-summary-grid audit-summary">
      <article><span className="summary-icon summary-blue"><Activity size={18} /></span><span>Events in this view</span><strong>{events.length}</strong><small>{isDemoMode ? 'Representative sample' : 'Current workspace'}</small></article>
      <article><span className="summary-icon summary-green"><CheckCircle2 size={18} /></span><span>Completed successfully</span><strong>{events.filter((event) => event.outcome === 'Success' || event.outcome === 'SUCCESS').length}</strong><small>Recorded governance actions</small></article>
      <article><span className="summary-icon summary-amber"><AlertTriangle size={18} /></span><span>Needs attention</span><strong>{events.filter((event) => event.outcome === 'Denied' || event.outcome === 'Review').length}</strong><small>Review outcomes and exceptions</small></article>
    </section>
    <section className="executive-list-panel">
      <div className="executive-section-heading"><div><span className="executive-kicker">RECENT ACTIVITY</span><h2>Security event history</h2><p>Every decision includes a reason and a reference ID.</p></div><span className="source-chip"><LockKeyhole size={14} />{isDemoMode ? 'Sample history' : 'Audit records'}</span></div>
      <div className="table-toolbar audit-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, events, or devices" /></label><label className="filter-select"><ListFilter size={15} /><select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter by outcome"><option>All outcomes</option><option>Success</option><option>SUCCESS</option><option>Denied</option><option>Review</option></select><ChevronDown size={14} /></label></div>
      <div className="audit-event-list">{filtered.map((event) => <article className="audit-event-card" key={event.eventId}>
        <span className={`audit-event-icon ${event.outcome === 'Success' || event.outcome === 'SUCCESS' ? 'audit-event-success' : 'audit-event-attention'}`}>
          {event.outcome === 'Success' || event.outcome === 'SUCCESS' ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
        </span>
        <div className="audit-event-main"><div><strong>{event.action.replace(/_/g, ' ')}</strong><StatusPill tone={event.outcome.toLowerCase() === 'success' ? 'success' : event.outcome.toLowerCase() as 'denied' | 'review'}>{event.outcome}</StatusPill></div>
          <p>{event.reason}</p><small>{event.actor} · {event.role} · {event.date} at {event.time}{event.scope ? ` · ${event.scope}` : ''}</small>
        </div>
        <div className="audit-event-target"><span>Related to</span><strong>{event.target}</strong><button className="correlation-copy" title="Copy reference ID" onClick={() => void copyCorrelation(event.correlationId)}>{copied === event.correlationId ? 'Copied' : event.correlationId}{copied === event.correlationId ? <Check size={14} /> : <Copy size={14} />}</button></div>
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
    if (!canSubmit) { setError('Enter at least 12 characters to provide an actionable audit reason.'); return }
    setIsSubmitting(true)
    setError('')
    try {
      await onSubmit(decision, justification)
    } catch (submitError) {
      setError('The decision could not be completed. No server-side approval was confirmed.')
    } finally {
      setIsSubmitting(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
    <div className="dialog-header"><div><span className="eyebrow">DEVICE REVIEW / {device.id}</span><h2 id="review-title">Review access request</h2></div><button className="icon-button" aria-label="Close review" onClick={onClose}><X size={18} /></button></div>
    <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div><button className="text-link" type="button" onClick={() => void onOpenDevice(device)}>Details <ArrowUpRight size={13} /></button></div>
    <div className="evidence-grid"><div><span>Intune managed ID</span><strong className="mono-id">{device.intuneId}</strong></div><div><span>Masked serial</span><strong>{device.serial}</strong></div><div><span>Approval state</span><ApprovalPill state={device.approval} /></div><div><span>Compliance posture</span><CompliancePill state={device.compliance} /></div></div>
    <div className="evidence-note"><MonitorCog size={15} /><span>{isDemoMode ? 'Demo review: this action changes sample data locally and is not an authoritative approval.' : 'Review the device identity and posture before making a decision.'}</span></div>
    <form onSubmit={submit}>
      <fieldset className="decision-fieldset"><legend>Decision</legend><div className="decision-options"><label className={`decision-option ${decision === 'Approved' ? 'decision-selected approve-selected' : ''}`}><input type="radio" name="decision" value="Approved" checked={decision === 'Approved'} onChange={() => setDecision('Approved')} /><span className="decision-icon"><CheckCircle2 size={17} /></span><span><strong>Approve</strong><small>Mark device approved</small></span></label><label className={`decision-option ${decision === 'Rejected' ? 'decision-selected reject-selected' : ''}`}><input type="radio" name="decision" value="Rejected" checked={decision === 'Rejected'} onChange={() => setDecision('Rejected')} /><span className="decision-icon"><X size={17} /></span><span><strong>Reject</strong><small>Deny this registration</small></span></label></div></fieldset>
      <label className="justification-label" htmlFor="justification">Audit justification <span>Required</span></label><textarea id="justification" value={justification} onChange={(event) => { setJustification(event.target.value); setError('') }} placeholder="Describe the evidence and reason for this decision…" rows={3} maxLength={500} required /><div className="textarea-meta"><span>{error || 'This reason will be stored in the append-only audit log.'}</span><span>{justification.length}/500</span></div>
      <div className="dialog-footer"><span><LockKeyhole size={14} /> Decision is auditable</span><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="submit" className={`button ${decision === 'Rejected' ? 'button-danger' : 'button-primary'}`} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Submitting…' : decision === 'Approved' ? 'Approve device' : 'Reject device'}</button></div>
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
  const commandName = command === 'LOCK' ? 'Lock Device' : command === 'RETIRE' ? 'Retire Device' : 'Remote Wipe'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      setError(command === 'WIPE' && !wipeConfirmed ? 'Confirm the remote wipe before submitting.' : 'A reason is required.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await onSubmit(command, reason.trim())
    } catch (submitError) {
      setError('The command could not be completed. No successful device action was confirmed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
    <section className="review-dialog remote-command-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-command-title">
      <div className="dialog-header"><div><span className="eyebrow">REMOTE DEVICE MANAGEMENT / {device.id}</span><h2 id="remote-command-title">Confirm remote command</h2></div><button className="icon-button" aria-label="Close remote command" onClick={onClose} disabled={isSubmitting}><X size={18} /></button></div>
      <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div></div>
      <div className="evidence-note"><MonitorCog size={15} /><span>{isDemoMode ? 'Demo action: only the sample device state changes; no device command is sent.' : 'This request is recorded by the governance service. It does not send an operating-system command directly from the browser.'}</span></div>
      <form onSubmit={submit}>
        <label className="access-field remote-command-select"><span>Command</span><select value={command} onChange={(event) => { setCommand(event.target.value as RemoteCommand); setError(''); setWipeConfirmed(false) }} disabled={isSubmitting}>
          <option value="LOCK">Lock Device — set lifecycle to Suspended</option>
          <option value="RETIRE">Retire Device — set lifecycle to Retired</option>
          <option value="WIPE">Remote Wipe — set lifecycle to Wipe Issued</option>
        </select></label>
        {command === 'WIPE' && <label className="wipe-confirm"><input type="checkbox" checked={wipeConfirmed} onChange={(event) => { setWipeConfirmed(event.target.checked); setError('') }} /><span>I confirm issuing a remote wipe for this device.</span></label>}
        <label className="justification-label remote-reason-label" htmlFor="remote-command-reason">Command reason <span>Required</span></label>
        <textarea id="remote-command-reason" value={reason} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Explain why this command is necessary…" rows={3} maxLength={500} required disabled={isSubmitting} />
        <div className="textarea-meta"><span>{error || 'The reason and command outcome are recorded in the audit log.'}</span><span>{reason.length}/500</span></div>
        <div className="dialog-footer"><span><LockKeyhole size={14} /> Command is auditable</span><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="submit" className={`button ${command === 'WIPE' ? 'button-danger' : 'button-primary'}`} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Submitting…' : commandName}</button></div>
      </form>
    </section>
  </div>
}

export default App