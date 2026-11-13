using DeviceGovernancePlatform.Server.Models;

namespace DeviceGovernancePlatform.Server.Services;

public sealed class InMemoryDeviceGovernanceStore : IDeviceGovernanceStore
{
    public static readonly Guid AcmeTenantId = Guid.Parse("11111111-1111-4111-8111-111111111111");
    public static readonly Guid NorthwindTenantId = Guid.Parse("22222222-2222-4222-8222-222222222222");
    public static readonly Guid ContosoTenantId = Guid.Parse("33333333-3333-4333-8333-333333333333");
    public static readonly Guid ProductionWorkspaceId = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    public static readonly Guid EngineeringWorkspaceId = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    public static readonly Guid CorporateWorkspaceId = Guid.Parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    private static readonly Guid DemoActorId = Guid.Parse("99999999-9999-4999-8999-999999999999");
    private readonly object _gate = new();
    private readonly List<DeviceMasterRecord> _devices = SeedDevices();
    private readonly List<AuditRecord> _auditRecords = SeedAuditRecords();

    public IReadOnlyList<DeviceMasterRecord> GetDevices(Guid tenantId, Guid workspaceId)
    {
        lock (_gate)
        {
            return _devices
                .Where(device => device.TenantId == tenantId && device.WorkspaceId == workspaceId)
                .OrderBy(device => device.DisplayId)
                .ToArray();
        }
    }

    public DeviceMasterRecord? GetDevice(Guid tenantId, Guid workspaceId, Guid deviceId)
    {
        lock (_gate)
        {
            return _devices.FirstOrDefault(device =>
                device.Id == deviceId && device.TenantId == tenantId && device.WorkspaceId == workspaceId);
        }
    }

    public IReadOnlyList<AuditRecord> GetAuditRecords(Guid tenantId, Guid workspaceId)
    {
        lock (_gate)
        {
            return _auditRecords
                .Where(record => record.TenantId == tenantId && record.WorkspaceId == workspaceId)
                .OrderByDescending(record => record.OccurredAt)
                .ToArray();
        }
    }

    public DeviceDecisionResult Decide(
        Guid tenantId,
        Guid workspaceId,
        Guid deviceId,
        DeviceApprovalState decision,
        string reason,
        out DeviceMasterRecord? updatedDevice)
    {
        lock (_gate)
        {
            var index = _devices.FindIndex(device =>
                device.Id == deviceId && device.TenantId == tenantId && device.WorkspaceId == workspaceId);
            if (index < 0)
            {
                updatedDevice = null;
                return DeviceDecisionResult.NotFound;
            }

            var existing = _devices[index];
            if (existing.ApprovalState != DeviceApprovalState.Pending)
            {
                updatedDevice = null;
                return DeviceDecisionResult.NotPending;
            }

            var now = DateTimeOffset.UtcNow;
            updatedDevice = existing with { ApprovalState = decision, UpdatedAt = now };
            _devices[index] = updatedDevice;
            _auditRecords.Add(new AuditRecord
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                WorkspaceId = workspaceId,
                CorrelationId = Guid.NewGuid(),
                OccurredAt = now,
                ActorUserId = DemoActorId,
                ActorDisplayName = "Mina Patel",
                ActorRole = "Customer Admin",
                Action = decision == DeviceApprovalState.Approved ? "Device approved" : "Device rejected",
                TargetType = "Device",
                TargetId = updatedDevice.Id,
                TargetDisplayName = $"{updatedDevice.DisplayId} · {updatedDevice.DeviceName}",
                Outcome = "Success",
                Reason = reason.Trim()
            });

            return DeviceDecisionResult.Updated;
        }
    }

    private static List<DeviceMasterRecord> SeedDevices()
    {
        var now = DateTimeOffset.UtcNow;
        return
        [
            CreateDevice("00000000-0000-4000-8000-000000000001", "DV-20481", AcmeTenantId, "Acme Corporation", ProductionWorkspaceId, "Production", "MacBook Pro 14", "Laptop", "Avery Morgan", "avery.morgan@acme.io", "INT-8F2A-119C", "C02•••7Q6L", "macOS", "15.1.1", DeviceApprovalState.Pending, DeviceComplianceState.Compliant, now, 18),
            CreateDevice("00000000-0000-4000-8000-000000000002", "DV-20479", AcmeTenantId, "Acme Corporation", ProductionWorkspaceId, "Production", "iPhone 15 Pro", "Phone", "Jordan Rivera", "jordan.rivera@acme.io", "INT-7A31-56D0", "F2L•••9P3M", "iOS", "18.1", DeviceApprovalState.Pending, DeviceComplianceState.NonCompliant, now, 22),
            CreateDevice("00000000-0000-4000-8000-000000000003", "DV-20468", AcmeTenantId, "Acme Corporation", ProductionWorkspaceId, "Production", "iPad Air", "Tablet", "Taylor Brooks", "taylor.brooks@acme.io", "INT-2B60-AD81", "G6T•••8W1K", "iPadOS", "18.1", DeviceApprovalState.Pending, DeviceComplianceState.Compliant, now, 68),
            CreateDevice("00000000-0000-4000-8000-000000000004", "DV-20475", AcmeTenantId, "Acme Corporation", CorporateWorkspaceId, "Corporate", "Surface Laptop 6", "Laptop", "Sam Chen", "sam.chen@acme.io", "INT-4C18-220A", "PF4•••2MX9", "Windows", "11 24H2", DeviceApprovalState.Pending, DeviceComplianceState.Stale, now, 83),
            CreateDevice("00000000-0000-4000-8000-000000000005", "DV-20459", AcmeTenantId, "Acme Corporation", EngineeringWorkspaceId, "Engineering", "ThinkPad X1 Carbon", "Laptop", "Riley Patel", "riley.patel@acme.io", "INT-91EF-7B03", "PF5•••0RK4", "Windows", "11 24H2", DeviceApprovalState.Approved, DeviceComplianceState.Compliant, now, 95),
            CreateDevice("00000000-0000-4000-8000-000000000006", "DV-30112", NorthwindTenantId, "Northwind Health", ProductionWorkspaceId, "Production", "Dell Latitude 7450", "Laptop", "Morgan Lee", "morgan.lee@northwind.example", "INT-0AE1-77C1", "8JH•••2F90", "Windows", "11 24H2", DeviceApprovalState.Pending, DeviceComplianceState.Compliant, now, 14),
            CreateDevice("00000000-0000-4000-8000-000000000007", "DV-40107", ContosoTenantId, "Contoso Group", ProductionWorkspaceId, "Production", "iPhone 16", "Phone", "Casey Kim", "casey.kim@contoso.example", "INT-78B4-3C2A", "H8Q•••6Y1C", "iOS", "18.1", DeviceApprovalState.Pending, DeviceComplianceState.Stale, now, 61)
        ];
    }

    private static DeviceMasterRecord CreateDevice(
        string id,
        string displayId,
        Guid tenantId,
        string tenantName,
        Guid workspaceId,
        string workspaceName,
        string deviceName,
        string deviceType,
        string ownerName,
        string ownerEmail,
        string mdmDeviceId,
        string maskedSerial,
        string operatingSystem,
        string operatingSystemVersion,
        DeviceApprovalState approval,
        DeviceComplianceState compliance,
        DateTimeOffset now,
        int signalOffsetMinutes)
    {
        var enrolledAt = now.AddDays(-1);
        return new DeviceMasterRecord
        {
            Id = Guid.Parse(id),
            DisplayId = displayId,
            TenantId = tenantId,
            TenantName = tenantName,
            WorkspaceId = workspaceId,
            WorkspaceName = workspaceName,
            DeviceName = deviceName,
            DeviceType = deviceType,
            OwnerUserId = Guid.NewGuid(),
            OwnerDisplayName = ownerName,
            OwnerEmail = ownerEmail,
            MdmProvider = "Microsoft Intune",
            MdmDeviceId = mdmDeviceId,
            MaskedSerialNumber = maskedSerial,
            OperatingSystem = operatingSystem,
            OperatingSystemVersion = operatingSystemVersion,
            EnrolledAt = enrolledAt,
            ApprovalState = approval,
            ComplianceState = compliance,
            ComplianceEvaluatedAt = compliance == DeviceComplianceState.Stale ? null : now.AddMinutes(-12),
            LastUsedSignals = new DeviceLastUsedSignals
            {
                LastMdmCloudSyncAt = now.AddMinutes(-signalOffsetMinutes),
                LastMdmCloudSyncSource = "Microsoft Intune",
                LastHardwareDeviceCheckInAt = now.AddMinutes(-(signalOffsetMinutes + 24)),
                LastHardwareDeviceCheckInSource = "Microsoft Intune",
                LastPwaAuthenticationAt = now.AddMinutes(-(signalOffsetMinutes - 7)),
                LastPwaAuthenticationSource = "Corporate identity provider",
                LastPwaForegroundActivityAt = now.AddMinutes(-(signalOffsetMinutes - 15)),
                LastPwaForegroundActivitySource = "PWA heartbeat",
                LastProtectedApiRequestAt = now.AddMinutes(-(signalOffsetMinutes - 16)),
                LastProtectedApiRequestSource = "API gateway",
                LastSessionStartAt = now.AddMinutes(-(signalOffsetMinutes - 7)),
                LastSessionStartSource = "Session service",
                LastExplicitLogoutAt = null,
                LastExplicitLogoutSource = "PWA session event"
            },
            CreatedAt = enrolledAt,
            UpdatedAt = now
        };
    }

    private static List<AuditRecord> SeedAuditRecords()
    {
        var now = DateTimeOffset.UtcNow;
        return
        [
            new AuditRecord
            {
                Id = Guid.NewGuid(), TenantId = AcmeTenantId, WorkspaceId = EngineeringWorkspaceId,
                CorrelationId = Guid.NewGuid(), OccurredAt = now.AddMinutes(-3), ActorUserId = DemoActorId,
                ActorDisplayName = "Mina Patel", ActorRole = "Customer Admin", Action = "Device approved",
                TargetType = "Device", TargetId = Guid.Parse("00000000-0000-4000-8000-000000000005"),
                TargetDisplayName = "DV-20459 · ThinkPad X1 Carbon", Outcome = "Success",
                Reason = "Corporate-owned device verified against Intune."
            },
            new AuditRecord
            {
                Id = Guid.NewGuid(), TenantId = AcmeTenantId, WorkspaceId = ProductionWorkspaceId,
                CorrelationId = Guid.NewGuid(), OccurredAt = now.AddMinutes(-8), ActorUserId = Guid.Empty,
                ActorDisplayName = "Policy Engine", ActorRole = "System", Action = "Access request denied",
                TargetType = "Device", TargetId = Guid.Parse("00000000-0000-4000-8000-000000000002"),
                TargetDisplayName = "DV-20479 · iPhone 15 Pro", Outcome = "Denied",
                Reason = "Device has a non-compliant posture."
            },
            new AuditRecord
            {
                Id = Guid.NewGuid(), TenantId = AcmeTenantId, WorkspaceId = ProductionWorkspaceId,
                CorrelationId = Guid.NewGuid(), OccurredAt = now.AddMinutes(-15), ActorUserId = Guid.Empty,
                ActorDisplayName = "Intune Connector", ActorRole = "Integration", Action = "Device sync completed",
                TargetType = "Workspace", TargetId = ProductionWorkspaceId,
                TargetDisplayName = "Production workspace", Outcome = "Success",
                Reason = "48 managed-device records synchronized."
            }
        ];
    }
}