using DeviceGovernancePlatform.Server.Services;
using Microsoft.EntityFrameworkCore;

namespace DeviceGovernancePlatform.Server.Data;

public sealed class DemoDataSeeder(DataContext dataContext, IDeviceGovernanceStore demoStore)
{
    private static readonly Guid[] TenantIds =
    [
        InMemoryDeviceGovernanceStore.AcmeTenantId,
        InMemoryDeviceGovernanceStore.NorthwindTenantId,
        InMemoryDeviceGovernanceStore.ContosoTenantId
    ];

    private static readonly Guid[] WorkspaceIds =
    [
        InMemoryDeviceGovernanceStore.ProductionWorkspaceId,
        InMemoryDeviceGovernanceStore.EngineeringWorkspaceId,
        InMemoryDeviceGovernanceStore.CorporateWorkspaceId
    ];

    public async Task SeedIfEmptyAsync(CancellationToken cancellationToken = default)
    {
        var hasDevices = await dataContext.DeviceMasterRecords.AnyAsync(cancellationToken);
        var hasAuditRecords = await dataContext.AuditRecords.AnyAsync(cancellationToken);
        if (hasDevices || hasAuditRecords)
        {
            return;
        }

        var devices = TenantIds
            .SelectMany(tenantId => WorkspaceIds.SelectMany(workspaceId =>
                demoStore.GetDevices(tenantId, workspaceId)))
            .ToArray();
        var auditRecords = TenantIds
            .SelectMany(tenantId => WorkspaceIds.SelectMany(workspaceId =>
                demoStore.GetAuditRecords(tenantId, workspaceId)))
            .ToArray();

        dataContext.DeviceMasterRecords.AddRange(devices);
        dataContext.AuditRecords.AddRange(auditRecords);
        await dataContext.SaveChangesAsync(cancellationToken);
    }
}
