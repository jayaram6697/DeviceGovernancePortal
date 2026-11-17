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
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
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
  const [isLoading, setIsLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [exportingAudit, setExportingAudit] = useState(false)
  const [remoteCommandDevice, setRemoteCommandDevice] = useState<Device | null>(null)
  const [remoteCommandInitial, setRemoteCommandInitial] = useState<RemoteCommand>('LOCK')
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const scope = getApiScope(tenant, workspace)
    setIsLoading(true)
    setApiError('')
    setDevices([])
    setAudit([])
    Promise.all([getDevices(scope), getAuditRecords(scope)])
      .then(([deviceRecords, auditRecords]) => {
        if (cancelled) return
        const mappedDevices = deviceRecords.map(mapDevice)
        setDevices(mappedDevices)
        setAudit(auditRecords.map(mapAuditRecord))
        setSelectedDeviceId((current) => mappedDevices.some((device) => device.recordId === current)
          ? current
          : mappedDevices[0]?.recordId ?? '')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setApiError(error instanceof Error ? error.message : 'Unable to load device governance data.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [isAuthenticated, tenant, workspace, reloadToken])

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

  const pendingCount = devices.filter((device) => device.approval === 'Pending').length
  const selectedDevice = devices.find((device) => device.recordId === selectedDeviceId) ?? devices[0]
  const reviewDevice = devices.find((device) => device.id === reviewDeviceId) ?? null
  const latestMdmSyncAt = devices.reduce<string | null>((latest, device) => {
    const current = device.lastMdmSyncAt
    return current && (!latest || new Date(current) > new Date(latest)) ? current : latest
  }, null)
  const isMdmSyncFresh = devices.length > 0 && devices.every((device) =>
    device.lastMdmSyncAt !== null && Date.now() - new Date(device.lastMdmSyncAt).getTime() <= 60 * 60_000)
  const screenTitle: Record<Screen, string> = {
    identity: 'Authentication & Roles',
    scope: 'Workspace & Tenants',
    approvals: 'Approval queue',
    devices: 'Device registry',
    intune: 'Intune sync',
    compliance: 'Compliance posture',
    access: 'PWA gatekeeper',
    signals: 'Activity signals',
    commands: 'Remote commands',
    audit: 'Audit & evidence',
    detail: 'Device details',
  }

  async function openDevice(device: Device) {
    setReviewDeviceId(null)
    setSelectedDeviceId(device.recordId)
    setScreen('detail')
    setDetailLoading(true)
    try {
      const record = await getDevice(getApiScope(tenant, workspace), device.recordId)
      const detailedDevice = mapDevice(record)
      setDevices((current) => current.map((item) => item.recordId === detailedDevice.recordId ? detailedDevice : item))
      setSelectedDeviceId(detailedDevice.recordId)
      setApiError('')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to load device details.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function submitDecision(decision: 'Approved' | 'Rejected', justification: string) {
    if (!reviewDevice || !justification.trim()) return
    await submitDeviceDecision(getApiScope(tenant, workspace), reviewDevice.recordId, decision, justification.trim())
    setReviewDeviceId(null)
    setNotice(`${reviewDevice.name} ${decision.toLowerCase()}. Audit event recorded.`)
    setReloadToken((current) => current + 1)
    window.setTimeout(() => setNotice(''), 4200)
  }

  async function testPwaAccess(device: Device, requestedAppId: string): Promise<AccessEvaluationResponse> {
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
      const result = await syncIntune(getApiScope(tenant, workspace))
      setNotice(`Intune sync completed. ${result.devicesSynced} device(s) refreshed; audit event recorded.`)
      setReloadToken((current) => current + 1)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Intune synchronization failed.')
    } finally {
      setIsSyncing(false)
    }
  }

  async function runRemoteCommand(command: RemoteCommand, reason: string) {
    if (!remoteCommandDevice) return
    const device = remoteCommandDevice
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
      await downloadAuditExport(getApiScope(tenant, workspace), format)
      setNotice(`Audit ${format.toUpperCase()} export downloaded. Export event recorded.`)
      setReloadToken((current) => current + 1)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Audit export failed.')
    } finally {
      setExportingAudit(false)
    }
  }

  function openRemoteCommand(device: Device, initialCommand: RemoteCommand = 'LOCK') {
    setRemoteCommandDevice(device)
    setRemoteCommandInitial(initialCommand)
  }

  function navigate(next: Screen) {
    setScreen(next)
    setMobileNavOpen(false)
  }

  function signOut() {
    setProfileMenuOpen(false)
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
        <div className="tenant-switcher">
          <span className="tenant-avatar">AC</span>
          <label className="select-stack"><span>Tenant</span><select value={tenant} onChange={(event) => setTenant(event.target.value)} aria-label="Tenant"><option>Acme Corporation</option><option>Northwind Health</option><option>Contoso Group</option></select></label>
          <ChevronDown size={15} className="select-chevron" />
        </div>
        <div className="workspace-switcher">
          <span className="workspace-label">WORKSPACE</span>
          <label className="workspace-select"><span className="workspace-indicator" /><select value={workspace} onChange={(event) => setWorkspace(event.target.value)} aria-label="Workspace"><option>Production</option><option>Engineering</option><option>Corporate</option></select><ChevronDown size={14} /></label>
        </div>
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
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
                {badge && <span className="nav-badge">{pendingCount}</span>}
              </button>
            })}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-mini ${isMdmSyncFresh ? 'sync-mini-current' : ''}`}><span className="sync-mini-dot" /><span>{isMdmSyncFresh ? 'Intune sync current' : 'Intune sync delayed'}</span><span className="sync-mini-time">{formatRelativeTime(latestMdmSyncAt) ?? '—'}</span></div>
          <div className="profile-menu-wrapper" ref={profileMenuRef}>
            <button type="button" className="profile-row" aria-label="Open user profile menu" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
              <span className="profile-avatar">IT</span><span className="profile-copy"><strong>{userEmail}</strong><small>Customer IT Administrator</small></span><MoreHorizontal size={18} />
            </button>
            {profileMenuOpen && <div className="profile-popover" role="menu" aria-label="User profile options">
              <div className="profile-popover-details"><span className="profile-popover-avatar">IT</span><span className="profile-popover-copy"><strong>{userEmail}</strong><small>Active demo session</small><span className="profile-role-badge">Customer IT Administrator</span></span></div>
              <div className="profile-popover-divider" />
              <button type="button" className="profile-signout" role="menuitem" onClick={signOut}><LogOut size={16} />Sign Out</button>
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
            <button className="button button-secondary sync-button" title="Simulated sync; no live Intune connection is configured." onClick={() => void runIntuneSync()} disabled={isSyncing || isLoading}><RefreshCw size={14} className={isSyncing ? 'sync-spinning' : ''} />{isSyncing ? 'Syncing…' : 'Sync with Intune'}</button>
            <button className="global-search" onClick={() => document.getElementById('page-search')?.focus()}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
            <button className="icon-button topbar-help" aria-label="Help"><CircleHelp size={18} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><span /></button>
            <div className="topbar-account"><span className="profile-avatar">IT</span><button className="sign-out-button" onClick={signOut}><LogOut size={14} />Sign Out</button></div>
          </div>
        </header>

        <main className="page-content">
          <div className="security-banner" role="status">
            <span className="banner-icon"><AlertTriangle size={18} /></span>
            <div className="banner-copy"><strong>{isMdmSyncFresh ? 'MDM sync is current' : 'MDM sync needs attention'}</strong><span>Last successful Intune sync: {formatRelativeTime(latestMdmSyncAt) ?? (isLoading ? 'Loading' : 'Not recorded')}.</span></div>
            <button className="banner-action" onClick={() => void runIntuneSync()} disabled={isSyncing}>Sync now <ArrowUpRight size={15} /></button>
            <button className="banner-dismiss" aria-label="Dismiss alert" onClick={(event) => event.currentTarget.closest('.security-banner')?.classList.add('banner-dismissed')}><X size={16} /></button>
          </div>

          {apiError && <div className="api-error" role="alert"><span>{apiError}</span><button onClick={() => setReloadToken((current) => current + 1)}>Retry</button></div>}
          {isLoading && <div className="loading-state" role="status">Loading devices for {workspace}…</div>}

          {screen === 'identity' && <IdentityRolesPage email={userEmail} tenant={tenant} workspace={workspace} onSignOut={signOut} />}
          {screen === 'scope' && <WorkspaceTenantsPage tenant={tenant} workspace={workspace} onTenantChange={setTenant} onWorkspaceChange={setWorkspace} />}
          {screen === 'approvals' && <ApprovalsPage devices={devices} tenant={tenant} workspace={workspace} onOpenDevice={openDevice} onReview={(device) => setReviewDeviceId(device.id)} />}
          {screen === 'devices' && <DevicesPage devices={devices} onOpenDevice={openDevice} onRemoteCommand={openRemoteCommand} />}
          {screen === 'intune' && <IntunePage devices={devices} latestSyncAt={latestMdmSyncAt} syncIsFresh={isMdmSyncFresh} isSyncing={isSyncing} onSync={() => void runIntuneSync()} />}
          {screen === 'compliance' && <CompliancePage devices={devices} onOpenDevice={openDevice} />}
          {screen === 'detail' && detailLoading && <div className="loading-state" role="status">Loading device details…</div>}
          {screen === 'detail' && !detailLoading && selectedDevice && <DeviceDetail device={selectedDevice} onBack={() => navigate('devices')} onRemoteCommand={openRemoteCommand} />}
          {screen === 'audit' && <AuditPage events={audit} onExport={exportAudit} exporting={exportingAudit} />}
          {screen === 'access' && <PwaAccessPage devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} onEvaluate={testPwaAccess} />}
          {screen === 'signals' && <SignalsPage devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />}
          {screen === 'commands' && <RemoteCommandsPage devices={devices} onRemoteCommand={openRemoteCommand} />}
        </main>
        <footer className="page-footer"><span>GateLogiq Device Governance</span><span>Tenant scope: {tenant} <i /> Workspace: {workspace}</span></footer>
      </div>

      {reviewDevice && <ReviewDialog device={reviewDevice} onClose={() => setReviewDeviceId(null)} onOpenDevice={openDevice} onSubmit={submitDecision} />}
      {remoteCommandDevice && <RemoteCommandDialog device={remoteCommandDevice} initialCommand={remoteCommandInitial} onClose={() => setRemoteCommandDevice(null)} onSubmit={runRemoteCommand} />}
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="toast-close" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>
}

function PwaAccessPage({
  devices,
  selectedDeviceId,
  onSelectDevice,
  onEvaluate,
}: {
  devices: Device[]
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
      setError(evaluationError instanceof Error ? evaluationError.message : 'The access request could not be evaluated.')
    } finally {
      setIsEvaluating(false)
    }
  }

  return <>
    <PageHeading eyebrow="ACCESS CONTROL / ZERO-TRUST EVALUATION" title="PWA Access Simulator" description="Evaluate the selected user's device posture before granting access to a PWA." />
    <div className="simulator-layout">
    <section className="panel access-simulator">
      <div className="panel-heading"><div><h2>Simulate an access request</h2><p>Each test records an access decision in the workspace audit log.</p></div><span className="source-chip"><Shield size={14} /> Zero trust</span></div>
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
          <ShieldCheck size={16} />{isEvaluating ? 'Evaluating…' : 'Test PWA Access'}
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
        <span className="phone-caption">LIVE PWA PREVIEW</span>
    </aside>
    </div>
    {error && <div className="api-error access-error" role="alert"><span>{error}</span></div>}
    {result && <section className={`access-result ${result.decision === 'ALLOW' ? 'access-allowed' : 'access-denied'}`} aria-live="polite">
      <div className="access-result-icon">{result.decision === 'ALLOW' ? <ShieldCheck size={27} /> : <ShieldAlert size={27} />}</div>
      <div className="access-result-content">
        <div className="access-result-heading"><span className="eyebrow">PWA ACCESS DECISION</span><strong>{result.decision === 'ALLOW' ? 'Access Authorized' : 'Access Denied'}</strong></div>
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
  onSignOut,
}: {
  email: string
  tenant: string
  workspace: string
  onSignOut: () => void
}) {
  return <>
    <PageHeading eyebrow="MODULE 1 / IDENTITY AND ACCESS" title="Authentication & Roles" description="Review the signed-in profile, current session, and role capabilities.">
      <button className="button button-secondary" onClick={onSignOut}><LogOut size={15} />Sign out</button>
    </PageHeading>
    <div className="identity-overview-grid">
      <section className="panel identity-profile-panel">
        <div className="panel-heading"><div><h2>User profile</h2><p>Identity associated with this console session.</p></div><span className="profile-avatar identity-avatar">IT</span></div>
        <div className="module-info-list">
          <InfoField label="Signed-in email" value={email || 'Not available'} />
          <InfoField label="Assigned role" value="Customer IT Administrator" />
          <InfoField label="Tenant scope" value={tenant} />
          <InfoField label="Workspace scope" value={workspace} />
        </div>
      </section>
      <section className="panel identity-session-panel">
        <div className="panel-heading"><div><h2>Session</h2><p>Current browser authentication state.</p></div><span className="status-pill status-approved"><span className="status-dot" />Active</span></div>
        <div className="module-info-list">
          <InfoField label="Session status" value="Signed in" />
          <InfoField label="Authentication mode" value="Demo sign-in" />
          <InfoField label="Authorization scope" value={`${tenant} / ${workspace}`} />
        </div>
      </section>
    </div>
    <section className="panel identity-permissions-panel">
      <div className="panel-heading"><div><h2>Role permissions</h2><p>Console capabilities shown for the Customer IT Administrator role.</p></div><span className="source-chip"><LockKeyhole size={14} /> Backend enforced</span></div>
      <ul className="identity-permission-list">
        <li><CheckCircle2 size={16} /><span>Review device approvals and submit an audited decision.</span></li>
        <li><CheckCircle2 size={16} /><span>View devices and their reported compliance posture and activity signals.</span></li>
        <li><CheckCircle2 size={16} /><span>Request Intune synchronization and evaluate PWA access through the governance API.</span></li>
        <li><CheckCircle2 size={16} /><span>Submit remote device commands and export audit evidence.</span></li>
      </ul>
      <p className="module-disclaimer"><Shield size={16} /> This demo view describes console features, not a verified identity-provider claim. The backend remains authoritative for authorization.</p>
    </section>
  </>
}

function WorkspaceTenantsPage({
  tenant,
  workspace,
  onTenantChange,
  onWorkspaceChange,
}: {
  tenant: string
  workspace: string
  onTenantChange: (tenant: string) => void
  onWorkspaceChange: (workspace: string) => void
}) {
  return <>
    <PageHeading eyebrow="MODULE 2 / TENANT AND ENVIRONMENT SCOPE" title="Workspace & Tenants" description="Select the tenant boundary and workspace used for governance data and actions." />
    <section className="scope-control-grid">
      <label className="scope-control-card">
        <span className="scope-control-icon"><Users size={19} /></span>
        <span className="scope-control-label">Tenant boundary</span>
        <strong>{tenant}</strong>
        <select value={tenant} onChange={(event) => onTenantChange(event.target.value)} aria-label="Select tenant">
          <option>Acme Corporation</option>
          <option>Northwind Health</option>
          <option>Contoso Group</option>
        </select>
        <small>Device and audit requests are scoped to this tenant.</small>
      </label>
      <label className="scope-control-card">
        <span className="scope-control-icon"><MonitorCog size={19} /></span>
        <span className="scope-control-label">Workspace environment</span>
        <strong>{workspace}</strong>
        <select value={workspace} onChange={(event) => onWorkspaceChange(event.target.value)} aria-label="Select workspace">
          <option>Production</option>
          <option>Engineering</option>
          <option>Corporate</option>
        </select>
        <small>Changing the workspace reloads the records within the selected tenant.</small>
      </label>
    </section>
    <section className="panel scope-boundary-panel">
      <div className="panel-heading"><div><h2>Active governance boundary</h2><p>Every device and audit operation uses both selected scope values.</p></div><span className="source-chip"><ShieldCheck size={14} /> Scoped requests</span></div>
      <div className="scope-boundary-value"><span>{tenant}</span><ChevronRight size={17} /><strong>{workspace}</strong></div>
      <p className="module-disclaimer"><LockKeyhole size={16} /> Switching tenants or workspaces refreshes the API-backed inventory and audit records for the new boundary.</p>
    </section>
  </>
}

function IntunePage({
  devices,
  latestSyncAt,
  syncIsFresh,
  isSyncing,
  onSync,
}: {
  devices: Device[]
  latestSyncAt: string | null
  syncIsFresh: boolean
  isSyncing: boolean
  onSync: () => void
}) {
  return <>
    <PageHeading eyebrow="MODULE 5 / MDM PROVIDER INTEGRATION" title="Microsoft Intune sync" description="Review provider sync health and reconcile the active workspace inventory.">
      <button className="button button-primary" onClick={onSync} disabled={isSyncing}>
        <RefreshCw size={16} className={isSyncing ? 'sync-spinning' : ''} />{isSyncing ? 'Syncing…' : 'Sync with Intune'}
      </button>
    </PageHeading>
    <section className="metrics-grid compact-metrics" aria-label="Intune sync status">
      <Metric label="Managed devices" value={devices.length.toLocaleString()} note="Current workspace inventory" icon={Smartphone} accent="blue" />
      <Metric label="Provider" value="Intune" note="Microsoft device management" icon={MonitorCog} accent="green" />
      <Metric label="Latest sync" value={formatRelativeTime(latestSyncAt) ?? 'Not recorded'} note={latestSyncAt ? new Date(latestSyncAt).toLocaleString() : 'No sync timestamp is available'} icon={RefreshCw} accent={syncIsFresh ? 'green' : 'amber'} />
      <Metric label="Sync health" value={syncIsFresh ? 'Current' : 'Needs review'} note="Freshness window: 60 minutes" icon={syncIsFresh ? CheckCircle2 : AlertTriangle} accent={syncIsFresh ? 'green' : 'amber'} />
    </section>
    <section className="panel module-status-panel">
      <div className="panel-heading"><div><h2>Provider integration</h2><p>Sync results are supplied by the device governance API for this tenant and workspace.</p></div><span className={`status-pill ${syncIsFresh ? 'status-approved' : 'status-pending'}`}><span className="status-dot" />{syncIsFresh ? 'Current' : 'Attention required'}</span></div>
      <div className="module-info-list">
        <InfoField label="MDM provider" value="Microsoft Intune" />
        <InfoField label="Devices in scope" value={devices.length.toLocaleString()} />
        <InfoField label="Most recent device sync" value={latestSyncAt ? new Date(latestSyncAt).toLocaleString() : 'Not recorded'} />
        <InfoField label="Connection model" value="Governance API integration" />
      </div>
      <p className="module-disclaimer"><Shield size={16} /> This console does not connect directly to Microsoft Graph. Sync status and outcomes are reported by the configured backend.</p>
    </section>
  </>
}

function CompliancePage({ devices, onOpenDevice }: { devices: Device[]; onOpenDevice: (device: Device) => void }) {
  const compliantCount = devices.filter((device) => device.compliance === 'Compliant').length
  const nonCompliantCount = devices.filter((device) => device.compliance === 'Non-compliant').length
  const staleCount = devices.filter((device) => device.compliance === 'Stale').length
  const complianceRate = devices.length ? `${Math.round(compliantCount / devices.length * 100)}%` : '—'

  return <>
    <PageHeading eyebrow="MODULE 6 / DEVICE POSTURE" title="Compliance posture" description="Review the compliance state reported for managed devices in this workspace." />
    <section className="metrics-grid compact-metrics" aria-label="Compliance summary">
      <Metric label="Compliant" value={compliantCount.toLocaleString()} note="Reported by the MDM provider" icon={CheckCircle2} accent="green" />
      <Metric label="Non-compliant" value={nonCompliantCount.toLocaleString()} note="Requires remediation" icon={ShieldAlert} accent="coral" />
      <Metric label="Stale posture" value={staleCount.toLocaleString()} note="Compliance data needs refresh" icon={Clock3} accent="amber" />
      <Metric label="Compliance rate" value={complianceRate} note="Compliant devices in current scope" icon={ShieldCheck} accent="blue" />
    </section>
    <section className="panel queue-panel">
      <div className="panel-heading"><div><h2>Device posture by record</h2><p>Approval and compliance are independent controls; only the backend evaluates access policy.</p></div></div>
      <div className="table-scroll"><table className="data-table module-table"><thead><tr><th>DEVICE</th><th>OWNER</th><th>COMPLIANCE</th><th>LAST MDM SYNC</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {devices.map((device) => <tr key={device.recordId}>
          <td><button className="device-cell" onClick={() => void onOpenDevice(device)}><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.id} <i /> {device.platform}</small></span></button></td>
          <td><span className="owner-cell"><strong>{device.owner}</strong><small>{device.email}</small></span></td>
          <td><CompliancePill state={device.compliance} /></td>
          <td className="date-cell">{formatRelativeTime(device.lastMdmSyncAt) ?? 'Not recorded'}</td>
          <td><button className="button button-secondary" onClick={() => void onOpenDevice(device)}>View details <ChevronRight size={14} /></button></td>
        </tr>)}
        {devices.length === 0 && <tr><td className="empty-cell" colSpan={5}>No device posture records are available in this workspace.</td></tr>}
      </tbody></table></div>
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
              <h3>{signal.label}</h3>
              <strong className={signal.value ? '' : 'signal-null'}>{signal.value ?? 'Not recorded'}</strong>
              <div className="signal-source"><span>Source</span><span>{signal.source}</span></div>
              {signal.note && <small className="signal-note">{signal.note}</small>}
            </article>
          })}
        </section>
        <div className="signal-disclaimer"><Shield size={15} /><span>Signal timestamps are shown independently. A missing signal is not treated as a substitute for a device check-in or compliance result.</span></div>
      </>
      : <div className="empty-devices">No device signals are available in this workspace.</div>}
  </>
}

function RemoteCommandsPage({
  devices,
  onRemoteCommand,
}: {
  devices: Device[]
  onRemoteCommand: (device: Device, command?: RemoteCommand) => void
}) {
  return <>
    <PageHeading eyebrow="MODULE 9 / REMOTE DEVICE MANAGEMENT" title="Remote commands" description="Issue an auditable device lifecycle command with a required justification." />
    <section className="panel queue-panel">
      <div className="panel-heading"><div><h2>Commandable devices</h2><p>Lock, retire, and wipe actions require confirmation and are recorded in the audit log.</p></div></div>
      <div className="table-scroll"><table className="data-table module-table"><thead><tr><th>DEVICE</th><th>OWNER</th><th>LIFECYCLE</th><th>AVAILABLE COMMANDS</th></tr></thead><tbody>
        {devices.map((device) => <tr key={device.recordId}>
          <td><span className="device-cell"><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.id} <i /> {device.platform}</small></span></span></td>
          <td><span className="owner-cell"><strong>{device.owner}</strong><small>{device.email}</small></span></td>
          <td><span className={`lifecycle-pill lifecycle-${device.lifecycleState.toLowerCase()}`}>{device.lifecycleState}</span></td>
          <td><div className="module-command-actions">
            <button className="button button-secondary" onClick={() => onRemoteCommand(device, 'LOCK')}>Lock</button>
            <button className="button button-secondary" onClick={() => onRemoteCommand(device, 'RETIRE')}>Retire</button>
            <button className="button button-danger" onClick={() => onRemoteCommand(device, 'WIPE')}>Wipe</button>
          </div></td>
        </tr>)}
        {devices.length === 0 && <tr><td className="empty-cell" colSpan={4}>No devices are available for remote commands.</td></tr>}
      </tbody></table></div>
    </section>
    <p className="module-disclaimer"><LockKeyhole size={16} /> Commands are submitted through the configured governance API; this development environment does not issue live Intune device actions.</p>
  </>
}

function Metric({ label, value, note, icon: Icon, accent }: { label: string; value: string; note: string; icon: LucideIcon; accent: string }) {
  return <div className="metric"><div className={`metric-icon metric-${accent}`}><Icon size={17} /></div><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>
}

function ApprovalsPage({ devices, tenant, workspace, onOpenDevice, onReview }: { devices: Device[]; tenant: string; workspace: string; onOpenDevice: (device: Device) => void; onReview: (device: Device) => void }) {
  const [search, setSearch] = useState('')
  const [compliance, setCompliance] = useState('All posture states')
  const [approval, setApproval] = useState('Pending')
  const pending = devices.filter((device) => device.approval === 'Pending')
  const filtered = devices.filter((device) => {
    const matchesText = `${device.name} ${device.owner} ${device.email} ${device.id} ${device.intuneId} ${device.platform} ${device.version} ${device.approval}`.toLowerCase().includes(search.toLowerCase())
    return matchesText
      && (approval === 'All approval states' || device.approval === approval)
      && (compliance === 'All posture states' || device.compliance === compliance)
  })
  const nonCompliant = pending.filter((device) => device.compliance === 'Non-compliant' || device.compliance === 'Stale').length
  const compliantCount = devices.filter((device) => device.compliance === 'Compliant').length
  const complianceRate = devices.length ? (compliantCount / devices.length * 100).toFixed(1) : '0.0'
  const today = new Date().toDateString()
  const activeToday = devices.filter((device) => {
    const session = device.signals.find((signal) => signal.label === 'Session start')
    return session?.occurredAt && new Date(session.occurredAt).toDateString() === today
  }).length

  return <>
    <header className="executive-header">
      <div><span className="eyebrow">YOUR SECURITY OVERVIEW</span><h1>Device Governance Control Center</h1><p>A clear view of your managed device posture and access decisions.</p></div>
      <div className="scope-tags"><span><span className="scope-tag-label">TENANT</span>{tenant}</span><span><span className="scope-tag-label">WORKSPACE</span><span className="workspace-indicator" />{workspace}</span></div>
    </header>
    <section className="executive-metrics" aria-label="Executive device governance overview">
      <article className="executive-metric"><span className="executive-metric-icon metric-blue"><Smartphone size={18} /></span><div><span>Total managed devices</span><strong>{devices.length.toLocaleString()}</strong><small><TrendingUp size={13} /> Live inventory in this workspace</small></div></article>
      <article className="executive-metric"><span className="executive-metric-icon metric-green"><ShieldCheck size={18} /></span><div><span>Posture compliance rate</span><strong>{complianceRate}<small>%</small></strong><small>Devices meeting security policy</small></div></article>
      <article className={`executive-metric ${pending.length > 0 ? 'executive-metric-alert' : ''}`}><span className="executive-metric-icon metric-amber"><Clock3 size={18} /></span><div><span>Pending IT review</span><strong>{pending.length.toLocaleString()}</strong><small>{pending.length > 0 ? 'Requires administrator attention' : 'All caught up'}</small></div></article>
      <article className="executive-metric"><span className="executive-metric-icon metric-violet"><Users size={18} /></span><div><span>Active today</span><strong>{activeToday.toLocaleString()}</strong><small>Devices with a PWA session today</small></div></article>
    </section>
    {pending.length > 0 && <section className="attention-banner" role="status"><span className="attention-icon"><AlertTriangle size={19} /></span><div><strong>Needs Your Attention</strong><span>{pending.length} device{pending.length === 1 ? '' : 's'} {pending.length === 1 ? 'is' : 'are'} waiting for IT approval.</span></div><button className="button button-review" onClick={() => onReview(pending[0])}>Review Now <ChevronRight size={15} /></button></section>}
    <div className="page-heading approvals-heading"><div><div className="eyebrow">ACCESS CONTROL / REVIEW QUEUE</div><h2>Device approvals</h2><p>Review device identity and posture before making an access decision.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => setSearch('')}><Download size={16} /> Export queue</button></div></div>
    <section className="metrics-grid" aria-label="Approval queue summary">
      <Metric label="Awaiting review" value={String(pending.length).padStart(2, '0')} note="Across all workspaces" icon={Clock3} accent="coral" />
      <Metric label="Posture needs attention" value={String(nonCompliant).padStart(2, '0')} note="Non-compliant or stale" icon={ShieldAlert} accent="amber" />
      <Metric label="Reviewed today" value="08" note="6 approved · 2 rejected" icon={CheckCircle2} accent="green" />
      <Metric label="Median review time" value="14m" note="Today · all administrators" icon={Activity} accent="blue" />
    </section>
    <section className="panel queue-panel">
      <div className="panel-heading"><div><h2>Devices by approval state</h2><p>Approval does not override device compliance or grant access by itself.</p></div><span className="count-label">{pending.length} pending</span></div>
      <div className="table-toolbar">
        <label className="search-field"><Search size={16} /><input id="page-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, OS, approval state, or ID" /></label>
        <label className="filter-select"><ListFilter size={15} /><select value={approval} onChange={(event) => setApproval(event.target.value)} aria-label="Filter by approval state"><option>All approval states</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Suspended</option><option>Revoked</option></select><ChevronDown size={14} /></label>
        <label className="filter-select"><ListFilter size={15} /><select value={compliance} onChange={(event) => setCompliance(event.target.value)} aria-label="Filter by compliance"><option>All posture states</option><option>Compliant</option><option>Non-compliant</option><option>Stale</option></select><ChevronDown size={14} /></label>
      </div>
      <div className="table-scroll"><table className="data-table approvals-table"><thead><tr><th>DEVICE</th><th>OWNER</th><th>WORKSPACE</th><th>APPROVAL</th><th>COMPLIANCE</th><th>ENROLLED</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {filtered.map((device) => <tr key={device.id}>
          <td><button className="device-cell" onClick={() => onOpenDevice(device)}><DeviceGlyph kind={device.kind} /><span><strong>{device.name}</strong><small>{device.id} <i /> {device.platform}</small></span></button></td>
          <td><span className="owner-cell"><strong>{device.owner}</strong><small>{device.email}</small></span></td>
          <td><span className="workspace-cell"><span className="workspace-indicator" />{device.workspace}</span></td>
          <td><ApprovalPill state={device.approval} /></td>
          <td><CompliancePill state={device.compliance} /></td>
          <td className="date-cell">{device.enrolled}</td>
          <td><div className="row-actions">{device.approval === 'Pending' && <button className="button button-review" onClick={() => onReview(device)}>Review <ChevronRight size={14} /></button>}<button className="icon-button row-more" aria-label={`More actions for ${device.name}`}><MoreHorizontal size={17} /></button></div></td>
        </tr>)}
        {filtered.length === 0 && <tr><td className="empty-cell" colSpan={7}>No devices match these filters.</td></tr>}
      </tbody></table></div>
      <div className="table-footer"><span>Showing <strong>{filtered.length}</strong> of <strong>{devices.length}</strong> devices in current scope</span><div className="pagination"><button disabled aria-label="Previous page"><ArrowLeft size={14} /></button><span>1</span><button disabled aria-label="Next page"><ChevronRight size={14} /></button></div></div>
    </section>
    <div className="queue-footnote"><ShieldCheck size={15} /><span>Every decision requires a justification and is written to the append-only audit log.</span></div>
  </>
}

function CompliancePill({ state }: { state: ComplianceState }) {
  const tone = state === 'Compliant' ? 'compliant' : state === 'Stale' ? 'stale' : 'noncompliant'
  const Icon = state === 'Compliant' ? CheckCircle2 : state === 'Stale' ? Clock3 : AlertTriangle
  return <span className={`compliance-pill compliance-${tone}`}><Icon size={13} />{state}</span>
}

function DevicesPage({ devices, onOpenDevice, onRemoteCommand }: { devices: Device[]; onOpenDevice: (device: Device) => void; onRemoteCommand: (device: Device, command?: RemoteCommand) => void }) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('All approval states')
  const filtered = devices.filter((device) =>
    `${device.name} ${device.owner} ${device.email} ${device.id} ${device.intuneId} ${device.platform} ${device.version} ${device.approval}`
      .toLowerCase().includes(search.toLowerCase())
      && (state === 'All approval states' || device.approval === state))
  return <>
    <PageHeading eyebrow="ACCESS CONTROL / INVENTORY" title="Device inventory" description="Managed devices correlated through Microsoft Intune."><button className="button button-secondary"><Download size={16} /> Export inventory</button></PageHeading>
    <section className="metrics-grid compact-metrics"><Metric label="Total devices" value={devices.length.toLocaleString()} note="In the active workspace" icon={Smartphone} accent="blue" /><Metric label="Approved" value={devices.filter((device) => device.approval === 'Approved').length.toLocaleString()} note="Access still posture-gated" icon={ShieldCheck} accent="green" /><Metric label="Needs review" value={String(devices.filter((device) => device.approval === 'Pending').length).padStart(2, '0')} note="Pending admin decision" icon={Clock3} accent="coral" /><Metric label="Non-compliant" value={devices.filter((device) => device.compliance !== 'Compliant').length.toLocaleString()} note="Non-compliant or stale" icon={ShieldAlert} accent="amber" /></section>
    <section className="panel queue-panel"><div className="panel-heading"><div><h2>All devices</h2><p>Approval and compliance are tracked as independent lifecycle states.</p></div></div>
      <div className="table-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, OS, approval state, or ID" /></label><label className="filter-select"><ListFilter size={15} /><select value={state} onChange={(event) => setState(event.target.value)} aria-label="Filter by approval state"><option>All approval states</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Suspended</option><option>Revoked</option></select><ChevronDown size={14} /></label></div>
      <div className="device-card-grid">{filtered.map((device) => {
        const latestActivity = device.signals.reduce<string | null>((latest, signal) =>
          signal.occurredAt && (!latest || new Date(signal.occurredAt) > new Date(latest)) ? signal.occurredAt : latest, null)
        const initials = device.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
        return <article className="device-card" key={device.recordId}>
          <div className="device-card-top"><DeviceGlyph kind={device.kind} /><span className="device-platform-tag">{device.platform} {device.version}</span><button className="icon-button" aria-label={`Remote actions for ${device.name}`} onClick={() => onRemoteCommand(device)}><MoreHorizontal size={17} /></button></div>
          <button className="device-card-title" onClick={() => onOpenDevice(device)}><strong>{device.name}</strong><span>{device.id}</span></button>
          <div className="device-card-owner"><span className="owner-avatar">{initials}</span><span><strong>{device.owner}</strong><small>{device.email}</small></span></div>
          <div className="device-card-status"><ApprovalPill state={device.approval} /><CompliancePill state={device.compliance} /></div>
          <details className="device-signals-disclosure">
            <summary><span>7 last-used signals</span><ChevronDown size={14} /></summary>
            <div className="device-signals-list">{device.signals.map((signal) => <div className="device-signal-item" key={signal.label}><span>{signal.label}</span><strong>{signal.value ?? 'Not recorded'}</strong></div>)}</div>
          </details>
          <div className="device-card-footer"><span className="device-last-activity"><Activity size={14} />{formatRelativeTime(latestActivity) ?? 'No recent activity'}</span><button className="button button-tertiary" onClick={() => onOpenDevice(device)}>Quick action <ChevronRight size={14} /></button></div>
        </article>
      })}{filtered.length === 0 && <div className="empty-devices">No devices match these filters.</div>}</div>
      <div className="table-footer"><span>Showing <strong>{filtered.length}</strong> device records in current scope</span><span>Updated just now</span></div>
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
        return <article className={`signal-card ${index === 6 ? 'signal-logout' : ''}`} key={signal.label}><div className="signal-card-head"><span className="signal-icon"><Icon size={16} /></span><span className="signal-index">0{index + 1}</span></div><h3>{signal.label}</h3><strong className={signal.value ? '' : 'signal-null'}>{signal.value ?? 'Not recorded'}</strong><div className="signal-source"><span>Source</span><span>{signal.source}</span></div>{signal.note && <small className="signal-note">{signal.note}</small>}</article>
      })}</div><div className="signal-disclaimer"><Shield size={15} /><span>Hardware inventory and remote management data are provided by Intune. A browser PWA cannot read physical MAC addresses or issue OS-level commands.</span></div></div>}
      {tab === 'overview' && <div className="overview-content"><div className="section-title-row"><div><h2>Device overview</h2><p>Identity and enrollment details synchronized from the MDM provider.</p></div><span className="source-chip"><MonitorCog size={14} /> Microsoft Intune</span></div><div className="overview-grid"><InfoField label="Device record" value={device.id} /><InfoField label="Intune managed-device ID" value={device.intuneId} /><InfoField label="Assigned owner" value={device.owner} /><InfoField label="Platform" value={`${device.platform} ${device.version}`} /><InfoField label="Masked serial number" value={device.serial} /><InfoField label="Enrollment date" value={device.enrolled} /><InfoField label="Workspace" value={device.workspace} /><InfoField label="MDM source" value="Microsoft Intune" /></div></div>}
      {tab === 'identifiers' && <div className="overview-content"><div className="section-title-row"><div><h2>Identifiers</h2><p>Sensitive identifiers are masked in the console.</p></div><span className="source-chip"><Fingerprint size={14} /> HMAC lookup enabled</span></div><div className="overview-grid"><InfoField label="Device UUID" value={device.id} /><InfoField label="Intune managed-device ID" value={device.intuneId} /><InfoField label="Serial number" value={device.serial} /><InfoField label="MAC address" value="Not collected by PWA" /></div><div className="signal-disclaimer"><LockKeyhole size={15} /><span>MAC and hardware identifiers are sourced from Intune telemetry and stored as protected lookup values where configured.</span></div></div>}
    </section>
  </>
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="info-field"><span>{label}</span><strong>{value}</strong></div>
}

function AuditPage({ events, onExport, exporting }: { events: AuditEvent[]; onExport: (format: 'csv' | 'json') => void; exporting: boolean }) {
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('All outcomes')
  const [copied, setCopied] = useState('')
  const filtered = useMemo(() => events.filter((event) => {
    const matchesSearch = `${event.actor} ${event.action} ${event.target} ${event.correlationId} ${event.eventId} ${event.reason}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (outcome === 'All outcomes' || event.outcome === outcome)
  }), [events, outcome, search])

  async function copyCorrelation(id: string) {
    try { await navigator.clipboard.writeText(id); setCopied(id); window.setTimeout(() => setCopied(''), 1500) } catch { setCopied('unavailable') }
  }

  return <>
    <PageHeading eyebrow="OBSERVABILITY / APPEND-ONLY RECORDS" title="Security audit log" description="Trace administrative decisions and access enforcement across this workspace."><div className="export-actions"><button className="button button-secondary" onClick={() => onExport('csv')} disabled={exporting}><Download size={16} /> {exporting ? 'Exporting…' : 'Export Audited CSV'}</button><button className="button button-secondary" onClick={() => onExport('json')} disabled={exporting}><Download size={16} /> JSON</button></div></PageHeading>
    <div className="audit-notice"><span className="audit-notice-icon"><LockKeyhole size={16} /></span><span><strong>Append-only record</strong> Events are immutable and tenant-scoped. Each record includes a correlation ID for end-to-end investigation.</span><span className="audit-retention">Retention: 365 days</span></div>
    <section className="audit-stats"><Metric label="Events today" value="246" note="+18% vs. previous day" icon={Activity} accent="blue" /><Metric label="Access denied" value="18" note="7.3% of access attempts" icon={ShieldAlert} accent="coral" /><Metric label="Admin decisions" value="08" note="All with justification" icon={Users} accent="green" /></section>
    <section className="panel audit-panel"><div className="panel-heading"><div><h2>Event stream</h2><p>Newest events first · timestamps shown in your local timezone.</p></div><span className="live-indicator"><span /> Live</span></div>
      <div className="table-toolbar audit-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actor, event, or correlation ID" /></label><label className="filter-select"><ListFilter size={15} /><select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter by outcome"><option>All outcomes</option><option>Success</option><option>SUCCESS</option><option>Denied</option><option>Review</option></select><ChevronDown size={14} /></label><button className="button button-tertiary"><Clock3 size={15} /> Last 24 hours <ChevronDown size={14} /></button></div>
      <div className="table-scroll"><table className="data-table audit-table"><thead><tr><th>TIMESTAMP</th><th>ACTOR</th><th>EVENT</th><th>TARGET</th><th>OUTCOME</th><th>CORRELATION ID</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.eventId}><td><span className="audit-time">{event.date}<small>{event.time}</small></span></td><td><span className="audit-actor"><strong>{event.actor}</strong><small>{event.role}</small></span></td><td><span className="audit-action"><strong>{event.action}</strong><small>{event.eventId}</small></span></td><td><span className="audit-target"><strong>{event.target}</strong><small>{event.reason}</small></span></td><td><StatusPill tone={event.outcome.toLowerCase() === 'success' ? 'success' : event.outcome.toLowerCase() as 'denied' | 'review'}>{event.outcome}</StatusPill></td><td><button className="correlation-copy" title="Copy correlation ID" onClick={() => void copyCorrelation(event.correlationId)}><span>{event.correlationId}</span>{copied === event.correlationId ? <Check size={14} /> : <Copy size={14} />}</button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-audit">No audit events match the current filters.</div>}</div>
      <div className="table-footer"><span>Showing <strong>{filtered.length}</strong> of <strong>{events.length}</strong> events</span><div className="pagination"><button disabled aria-label="Previous page"><ArrowLeft size={14} /></button><span>1</span><button disabled aria-label="Next page"><ChevronRight size={14} /></button></div></div>
    </section>
    <div className="audit-integrity"><ShieldCheck size={15} /><span>Audit integrity verified</span><span className="integrity-dot" /><span>Last chain verification: 2 minutes ago</span><button onClick={() => setSearch('correlation')}>Learn about event integrity <ArrowUpRight size={13} /></button></div>
  </>
}

function ReviewDialog({ device, onClose, onOpenDevice, onSubmit }: { device: Device; onClose: () => void; onOpenDevice: (device: Device) => void | Promise<void>; onSubmit: (decision: 'Approved' | 'Rejected', justification: string) => Promise<void> }) {
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
      setError(submitError instanceof Error ? submitError.message : 'The decision could not be submitted.')
    } finally {
      setIsSubmitting(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title">
    <div className="dialog-header"><div><span className="eyebrow">DEVICE REVIEW / {device.id}</span><h2 id="review-title">Review access request</h2></div><button className="icon-button" aria-label="Close review" onClick={onClose}><X size={18} /></button></div>
    <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div><button className="text-link" type="button" onClick={() => void onOpenDevice(device)}>Details <ArrowUpRight size={13} /></button></div>
    <div className="evidence-grid"><div><span>Intune managed ID</span><strong className="mono-id">{device.intuneId}</strong></div><div><span>Masked serial</span><strong>{device.serial}</strong></div><div><span>Approval state</span><ApprovalPill state={device.approval} /></div><div><span>Compliance posture</span><CompliancePill state={device.compliance} /></div></div>
    <div className="evidence-note"><MonitorCog size={15} /><span>Identity and posture evidence sourced from Microsoft Intune. Last cloud sync: 45 minutes ago.</span></div>
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
  onClose,
  onSubmit,
}: {
  device: Device
  initialCommand: RemoteCommand
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
      setError(submitError instanceof Error ? submitError.message : 'The remote command could not be submitted.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
    <section className="review-dialog remote-command-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-command-title">
      <div className="dialog-header"><div><span className="eyebrow">REMOTE DEVICE MANAGEMENT / {device.id}</span><h2 id="remote-command-title">Confirm remote command</h2></div><button className="icon-button" aria-label="Close remote command" onClick={onClose} disabled={isSubmitting}><X size={18} /></button></div>
      <div className="review-device"><DeviceGlyph kind={device.kind} /><div><strong>{device.name}</strong><span>{device.owner} <i /> {device.workspace}</span></div></div>
      <div className="evidence-note"><MonitorCog size={15} /><span>Development simulation: this updates the governance lifecycle state and audit log; no live Intune command is sent.</span></div>
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