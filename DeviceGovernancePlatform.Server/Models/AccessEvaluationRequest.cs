namespace DeviceGovernancePlatform.Server.Models;

public sealed record AccessEvaluationRequest
{
    public required Guid DeviceId { get; init; }
    public required Guid TenantId { get; init; }
    public required Guid WorkspaceId { get; init; }
    public required Guid UserId { get; init; }
    public required string RequestedAppId { get; init; }
}
