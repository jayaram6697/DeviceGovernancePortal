namespace DeviceGovernancePlatform.Server.Models;

public sealed record DeviceLastUsedSignals
{
    public DateTimeOffset? LastMdmCloudSyncAt { get; init; }
    public required string LastMdmCloudSyncSource { get; init; }
    public DateTimeOffset? LastHardwareDeviceCheckInAt { get; init; }
    public required string LastHardwareDeviceCheckInSource { get; init; }
    public DateTimeOffset? LastPwaAuthenticationAt { get; init; }
    public required string LastPwaAuthenticationSource { get; init; }
    public DateTimeOffset? LastPwaForegroundActivityAt { get; init; }
    public required string LastPwaForegroundActivitySource { get; init; }
    public DateTimeOffset? LastProtectedApiRequestAt { get; init; }
    public required string LastProtectedApiRequestSource { get; init; }
    public DateTimeOffset? LastSessionStartAt { get; init; }
    public required string LastSessionStartSource { get; init; }
    public DateTimeOffset? LastExplicitLogoutAt { get; init; }
    public required string LastExplicitLogoutSource { get; init; }
}