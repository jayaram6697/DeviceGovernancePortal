using System.Text;
using System.Text.Json;
using DeviceGovernancePlatform.Server.Data;
using DeviceGovernancePlatform.Server.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;

namespace DeviceGovernancePlatform.Server.Controllers;

[ApiController]
[Route("api/v1/admin")]
public sealed class AdminDevicesController(DataContext dataContext) : ControllerBase
{
    [HttpGet("devices")]
    [ProducesResponseType<IReadOnlyList<DeviceMasterRecord>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<DeviceMasterRecord>>> GetDevices(
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();
        var devices = await dataContext.DeviceMasterRecords
            .AsNoTracking()
            .Where(device => device.TenantId == tenantId && device.WorkspaceId == workspaceId)
            .OrderBy(device => device.DisplayId)
            .ToListAsync();
        return Ok(devices);
    }

    [HttpGet("devices/{id:guid}")]
    [ProducesResponseType<DeviceMasterRecord>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<DeviceMasterRecord>> GetDevice(
        Guid id,
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();
        var device = await dataContext.DeviceMasterRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(record =>
                record.Id == id && record.TenantId == tenantId && record.WorkspaceId == workspaceId);
        return device is null ? NotFound() : Ok(device);
    }

    [HttpPost("devices/{id:guid}/approve")]
    [ProducesResponseType<DeviceMasterRecord>(StatusCodes.Status200OK)]
    public Task<ActionResult<DeviceMasterRecord>> ApproveDevice(
        Guid id,
        ApprovalDecisionDto decision,
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId) =>
        ApplyDecisionAsync(id, tenantId, workspaceId, decision, DeviceApprovalState.Approved);

    [HttpPost("devices/{id:guid}/reject")]
    [ProducesResponseType<DeviceMasterRecord>(StatusCodes.Status200OK)]
    public Task<ActionResult<DeviceMasterRecord>> RejectDevice(
        Guid id,
        ApprovalDecisionDto decision,
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId) =>
        ApplyDecisionAsync(id, tenantId, workspaceId, decision, DeviceApprovalState.Rejected);

    [HttpGet("audit-logs")]
    [ProducesResponseType<IReadOnlyList<AuditRecord>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AuditRecord>>> GetAuditLogs(
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();
        var records = await dataContext.AuditRecords
            .AsNoTracking()
            .Where(record => record.TenantId == tenantId && record.WorkspaceId == workspaceId)
            .OrderByDescending(record => record.OccurredAt)
            .ToListAsync();
        return Ok(records);
    }

    [HttpGet("audit-logs/export")]
    [Produces("text/csv", "application/json")]
    public async Task<IActionResult> ExportAuditLogs(
        [FromQuery] string? format,
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();
        var exportFormat = format?.Trim().ToLowerInvariant();
        if (exportFormat is not ("csv" or "json"))
        {
            return BadRequest(new { message = "Format must be csv or json." });
        }

        var now = DateTimeOffset.UtcNow;
        var correlationId = Guid.NewGuid();
        dataContext.AuditRecords.Add(new AuditRecord
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            CorrelationId = correlationId,
            OccurredAt = now,
            ActorUserId = Guid.Parse("99999999-9999-4999-8999-999999999999"),
            ActorDisplayName = "Customer IT Admin",
            ActorRole = "Customer Admin",
            Action = "AUDIT_EXPORT_GENERATED",
            TargetType = "AuditLog",
            TargetId = workspaceId,
            TargetDisplayName = $"{exportFormat.ToUpperInvariant()} audit export",
            Outcome = "SUCCESS",
            Reason = $"Audit export generated in {exportFormat.ToUpperInvariant()} format."
        });
        await dataContext.SaveChangesAsync(cancellationToken);

        var records = await dataContext.AuditRecords
            .AsNoTracking()
            .Where(record => record.TenantId == tenantId && record.WorkspaceId == workspaceId)
            .OrderBy(record => record.OccurredAt)
            .Select(record => new AuditExportRow(
                record.Id,
                record.OccurredAt,
                record.ActorDisplayName,
                record.Action,
                record.TargetId,
                record.Outcome,
                record.Reason,
                record.CorrelationId))
            .ToListAsync(cancellationToken);

        if (exportFormat == "json")
        {
            var json = JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true });
            return File(Encoding.UTF8.GetBytes(json), "application/json", "device_governance_audit.json");
        }

        var csv = new StringBuilder();
        csv.AppendLine("AuditId,OccurredAtUtc,Actor,Action,TargetId,Result,ReasonCode,CorrelationId");
        foreach (var record in records)
        {
            csv.Append(CsvField(record.AuditId.ToString())).Append(',')
                .Append(CsvField(record.OccurredAtUtc.UtcDateTime.ToString("O"))).Append(',')
                .Append(CsvField(record.Actor)).Append(',')
                .Append(CsvField(record.Action)).Append(',')
                .Append(CsvField(record.TargetId.ToString())).Append(',')
                .Append(CsvField(record.Result)).Append(',')
                .Append(CsvField(record.ReasonCode)).Append(',')
                .Append(CsvField(record.CorrelationId.ToString())).AppendLine();
        }
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv; charset=utf-8", "device_governance_audit.csv");
    }

    [HttpPost("devices/{id:guid}/commands")]
    [ProducesResponseType<RemoteCommandResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RemoteCommandResponse>> ExecuteRemoteCommand(
        Guid id,
        RemoteCommandRequest request,
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();
        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            return BadRequest(new { message = "A reason is required for every remote command." });
        }

        var command = request.Command.Trim().ToUpperInvariant();
        var lifecycleState = command switch
        {
            "LOCK" => DeviceLifecycleState.Suspended,
            "RETIRE" => DeviceLifecycleState.Retired,
            "WIPE" => DeviceLifecycleState.WipeIssued,
            _ => (DeviceLifecycleState?)null
        };
        if (lifecycleState is null)
        {
            return BadRequest(new { message = "Command must be LOCK, RETIRE, or WIPE." });
        }

        var device = await dataContext.DeviceMasterRecords.SingleOrDefaultAsync(record =>
            record.Id == id && record.TenantId == tenantId && record.WorkspaceId == workspaceId,
            cancellationToken);
        if (device is null) return NotFound();

        var now = DateTimeOffset.UtcNow;
        var correlationId = Guid.NewGuid();
        dataContext.Entry(device).Property(record => record.LifecycleState).CurrentValue = lifecycleState.Value;
        dataContext.Entry(device).Property(record => record.UpdatedAt).CurrentValue = now;
        dataContext.AuditRecords.Add(new AuditRecord
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            CorrelationId = correlationId,
            OccurredAt = now,
            ActorUserId = Guid.Parse("99999999-9999-4999-8999-999999999999"),
            ActorDisplayName = "Mina Patel",
            ActorRole = "Customer Admin",
            Action = $"Remote command {command}",
            TargetType = "Device",
            TargetId = device.Id,
            TargetDisplayName = $"{device.DisplayId} · {device.DeviceName}",
            Outcome = "Success",
            Reason = request.Reason.Trim()
        });
        await dataContext.SaveChangesAsync(cancellationToken);

        return Ok(new RemoteCommandResponse
        {
            Command = command,
            LifecycleState = device.LifecycleState,
            Outcome = "Success",
            CorrelationId = correlationId
        });
    }

    [HttpPost("integrations/intune/sync")]
    [ProducesResponseType<MdmSyncResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<MdmSyncResponse>> SyncIntune(
        [FromHeader(Name = "X-Tenant-Id")] Guid tenantId,
        [FromHeader(Name = "X-Workspace-Id")] Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();

        var now = DateTimeOffset.UtcNow;
        var devices = await dataContext.DeviceMasterRecords
            .Where(device => device.TenantId == tenantId && device.WorkspaceId == workspaceId)
            .ToListAsync(cancellationToken);
        var correlationId = Guid.NewGuid();

        foreach (var device in devices)
        {
            dataContext.Entry(device).Reference(record => record.LastUsedSignals).CurrentValue =
                device.LastUsedSignals with { LastMdmCloudSyncAt = now };
            dataContext.Entry(device).Property(record => record.ComplianceEvaluatedAt).CurrentValue = now;
            if (device.ComplianceState == DeviceComplianceState.Stale)
            {
                dataContext.Entry(device).Property(record => record.ComplianceState).CurrentValue =
                    DeviceComplianceState.Compliant;
            }
            dataContext.Entry(device).Property(record => record.UpdatedAt).CurrentValue = now;
        }

        dataContext.AuditRecords.Add(new AuditRecord
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            CorrelationId = correlationId,
            OccurredAt = now,
            ActorUserId = Guid.Parse("99999999-9999-4999-8999-999999999999"),
            ActorDisplayName = "Mina Patel",
            ActorRole = "Customer Admin",
            Action = "MDM_SYNC_COMPLETED",
            TargetType = "Workspace",
            TargetId = workspaceId,
            TargetDisplayName = $"{devices.FirstOrDefault()?.WorkspaceName ?? "Workspace"} inventory",
            Outcome = "Success",
            Reason = $"Simulated Intune inventory sync completed for {devices.Count} device(s)."
        });
        await dataContext.SaveChangesAsync(cancellationToken);

        return Ok(new MdmSyncResponse
        {
            DevicesSynced = devices.Count,
            CompletedAt = now,
            CorrelationId = correlationId
        });
    }

    private async Task<ActionResult<DeviceMasterRecord>> ApplyDecisionAsync(
        Guid id,
        Guid tenantId,
        Guid workspaceId,
        ApprovalDecisionDto decision,
        DeviceApprovalState approvalState)
    {
        if (!HasScope(tenantId, workspaceId)) return MissingScope();

        var existingDevice = await dataContext.DeviceMasterRecords.SingleOrDefaultAsync(device =>
            device.Id == id && device.TenantId == tenantId && device.WorkspaceId == workspaceId);
        if (existingDevice is null) return NotFound();
        if (existingDevice.ApprovalState != DeviceApprovalState.Pending)
        {
            return Conflict(new { message = "Only pending devices can receive an approval decision." });
        }

        var now = DateTimeOffset.UtcNow;
        var updatedDevice = existingDevice with { ApprovalState = approvalState, UpdatedAt = now };
        dataContext.Entry(existingDevice).State = EntityState.Detached;
        dataContext.DeviceMasterRecords.Update(updatedDevice);
        dataContext.AuditRecords.Add(new AuditRecord
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            CorrelationId = Guid.NewGuid(),
            OccurredAt = now,
            ActorUserId = Guid.Parse("99999999-9999-4999-8999-999999999999"),
            ActorDisplayName = "Mina Patel",
            ActorRole = "Customer Admin",
            Action = approvalState == DeviceApprovalState.Approved ? "Device approved" : "Device rejected",
            TargetType = "Device",
            TargetId = updatedDevice.Id,
            TargetDisplayName = $"{updatedDevice.DisplayId} · {updatedDevice.DeviceName}",
            Outcome = "Success",
            Reason = decision.Reason.Trim()
        });

        await dataContext.SaveChangesAsync();
        return Ok(updatedDevice);
    }

    private static bool HasScope(Guid tenantId, Guid workspaceId) =>
        tenantId != Guid.Empty && workspaceId != Guid.Empty;

    private BadRequestObjectResult MissingScope() =>
        BadRequest(new { message = "X-Tenant-Id and X-Workspace-Id headers are required." });

    private static string CsvField(string value)
    {
        var safeValue = value.Length > 0 && value[0] is '=' or '+' or '-' or '@'
            ? $"'{value}"
            : value;
        return $"\"{safeValue.Replace("\"", "\"\"")}\"";
    }

    private sealed record AuditExportRow(
        Guid AuditId,
        DateTimeOffset OccurredAtUtc,
        string Actor,
        string Action,
        Guid TargetId,
        string Result,
        string ReasonCode,
        Guid CorrelationId);
}