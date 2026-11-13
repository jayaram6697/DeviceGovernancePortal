namespace DeviceGovernancePlatform.Server.Models;

public sealed record AccessEvaluationResponse
{
    public required string Decision { get; init; }
    public required string ReasonCode { get; init; }
    public required Guid CorrelationId { get; init; }
    public required DateTimeOffset EvaluatedAt { get; init; }
    public AccessGrant? Grant { get; init; }
}

public sealed record AccessGrant
{
    public required string Token { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required IReadOnlyList<string> Scopes { get; init; }
}
