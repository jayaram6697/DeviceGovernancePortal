using System.Security.Cryptography;
using DeviceGovernancePlatform.Server.Data;
using DeviceGovernancePlatform.Server.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DeviceGovernancePlatform.Server.Controllers;

[ApiController]
[Route("api/v1/access")]
public sealed class AccessDecisionController(DataContext dataContext) : ControllerBase
{
    private static readonly TimeSpan MaximumSignalAge = TimeSpan.FromMinutes(60);
    private static readonly TimeSpan GrantLifetime = TimeSpan.FromMinutes(5);

    [HttpPost("evaluate")]
    [ProducesResponseType<AccessEvaluationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AccessEvaluationResponse>> Evaluate(
        AccessEvaluationRequest request,
        CancellationToken cancellationToken)
    {
        if (request.DeviceId == Guid.Empty
            || request.TenantId == Guid.Empty
            || request.WorkspaceId == Guid.Empty
            || request.UserId == Guid.Empty
            || string.IsNullOrWhiteSpace(request.RequestedAppId))
        {
            return BadRequest(new { message = "Device, tenant, workspace, user, and requested app are required." });
        }

        var now = DateTimeOffset.UtcNow;
        var correlationId = Guid.NewGuid();
        var device = await dataContext.DeviceMasterRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(record =>
                record.Id == request.DeviceId
                && record.TenantId == request.TenantId
                && record.WorkspaceId == request.WorkspaceId,
                cancellationToken);

        string? reasonCode = null;
        if (device is null)
        {
            reasonCode = "DEVICE_NOT_REGISTERED";
        }
        else if (device.LifecycleState != DeviceLifecycleState.Active)
        {
            reasonCode = "DEVICE_LIFECYCLE_INACTIVE";
        }
        else if (device.ApprovalState != DeviceApprovalState.Approved)
        {
            reasonCode = "DEVICE_NOT_APPROVED";
        }
        else if (device.ComplianceState != DeviceComplianceState.Compliant)
        {
            reasonCode = "DEVICE_NON_COMPLIANT";
        }
        else if (device.LastUsedSignals.LastMdmCloudSyncAt is not { } lastMdmSyncAt
            || now - lastMdmSyncAt > MaximumSignalAge)
        {
            reasonCode = "COMPLIANCE_DATA_STALE";
        }

        AccessGrant? grant = null;
        if (reasonCode is null)
        {
            var expiresAt = now.Add(GrantLifetime);
            grant = new AccessGrant
            {
                Token = CreateMockToken(),
                ExpiresAt = expiresAt,
                Scopes =
                [
                    "pwa.access",
                    $"app:{request.RequestedAppId.Trim()}",
                    $"device:{request.DeviceId}",
                    $"tenant:{request.TenantId}",
                    $"workspace:{request.WorkspaceId}"
                ]
            };
        }

        var allowed = reasonCode is null;
        var response = new AccessEvaluationResponse
        {
            Decision = allowed ? "ALLOW" : "DENY",
            ReasonCode = reasonCode ?? "ACCESS_GRANTED",
            CorrelationId = correlationId,
            EvaluatedAt = now,
            Grant = grant
        };

        dataContext.AuditRecords.Add(new AuditRecord
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            CorrelationId = correlationId,
            OccurredAt = now,
            ActorUserId = request.UserId,
            ActorDisplayName = request.UserId.ToString(),
            ActorRole = "PWA User",
            Action = allowed ? "PWA access allowed" : "PWA access denied",
            TargetType = "Device",
            TargetId = request.DeviceId,
            TargetDisplayName = device is null ? request.DeviceId.ToString() : $"{device.DisplayId} · {device.DeviceName}",
            Outcome = allowed ? "Success" : "Denied",
            Reason = response.ReasonCode
        });
        await dataContext.SaveChangesAsync(cancellationToken);

        return Ok(response);
    }

    private static string CreateMockToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
