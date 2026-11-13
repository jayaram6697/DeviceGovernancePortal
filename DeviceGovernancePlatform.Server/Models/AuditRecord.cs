namespace DeviceGovernancePlatform.Server.Models;

public sealed record AuditRecord
{
    public required Guid Id { get; init; }
    public required Guid TenantId { get; init; }
    public required Guid WorkspaceId { get; init; }
    public required Guid CorrelationId { get; init; }
    public required DateTimeOffset OccurredAt { get; init; }
    public required Guid ActorUserId { get; init; }
    public required string ActorDisplayName { get; init; }
    public required string ActorRole { get; init; }
    public required string Action { get; init; }
    public required string TargetType { get; init; }
    public required Guid TargetId { get; init; }
    public required string TargetDisplayName { get; init; }
    public required string Outcome { get; init; }
    public required string Reason { get; init; }
}