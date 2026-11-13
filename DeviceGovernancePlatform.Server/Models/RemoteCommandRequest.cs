namespace DeviceGovernancePlatform.Server.Models;

public sealed record RemoteCommandRequest
{
    public required string Command { get; init; }
    public required string Reason { get; init; }
}

public sealed record RemoteCommandResponse
{
    public required string Command { get; init; }
    public required DeviceLifecycleState LifecycleState { get; init; }
    public required string Outcome { get; init; }
    public required Guid CorrelationId { get; init; }
}

public sealed record MdmSyncResponse
{
    public required int DevicesSynced { get; init; }
    public required DateTimeOffset CompletedAt { get; init; }
    public required Guid CorrelationId { get; init; }
}
