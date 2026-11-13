using DeviceGovernancePlatform.Server.Models;

namespace DeviceGovernancePlatform.Server.Services;

public enum DeviceDecisionResult
{
    Updated,
    NotFound,
    NotPending
}

public interface IDeviceGovernanceStore
{
    IReadOnlyList<DeviceMasterRecord> GetDevices(Guid tenantId, Guid workspaceId);
    DeviceMasterRecord? GetDevice(Guid tenantId, Guid workspaceId, Guid deviceId);
    IReadOnlyList<AuditRecord> GetAuditRecords(Guid tenantId, Guid workspaceId);
    DeviceDecisionResult Decide(
        Guid tenantId,
        Guid workspaceId,
        Guid deviceId,
        DeviceApprovalState decision,
        string reason,
        out DeviceMasterRecord? updatedDevice);
}