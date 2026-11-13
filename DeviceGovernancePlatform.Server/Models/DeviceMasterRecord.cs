namespace DeviceGovernancePlatform.Server.Models;

public enum DeviceApprovalState
{
    Pending,
    Approved,
    Rejected,
    Suspended,
    Revoked
}

public enum DeviceComplianceState
{
    Compliant,
    NonCompliant,
    Stale
}

public enum DeviceLifecycleState
{
    Active,
    Suspended,
    Retired,
    WipeIssued
}

public sealed record DeviceMasterRecord
{
    public required Guid Id { get; init; }
    public required string DisplayId { get; init; }
    public required Guid TenantId { get; init; }
    public required string TenantName { get; init; }
    public required Guid WorkspaceId { get; init; }
    public required string WorkspaceName { get; init; }
    public required string DeviceName { get; init; }
    public required string DeviceType { get; init; }
    public required Guid OwnerUserId { get; init; }
    public required string OwnerDisplayName { get; init; }
    public required string OwnerEmail { get; init; }
    public required string MdmProvider { get; init; }
    public required string MdmDeviceId { get; init; }
    public required string MaskedSerialNumber { get; init; }
    public required string OperatingSystem { get; init; }
    public required string OperatingSystemVersion { get; init; }
    public required DateTimeOffset EnrolledAt { get; init; }
    public required DeviceApprovalState ApprovalState { get; init; }
    public required DeviceComplianceState ComplianceState { get; init; }
    public DeviceLifecycleState LifecycleState { get; init; } = DeviceLifecycleState.Active;
    public DateTimeOffset? ComplianceEvaluatedAt { get; init; }
    public required DeviceLastUsedSignals LastUsedSignals { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset UpdatedAt { get; init; }
}