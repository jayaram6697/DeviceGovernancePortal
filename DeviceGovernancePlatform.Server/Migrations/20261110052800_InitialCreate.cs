using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeviceGovernancePlatform.Server.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CorrelationId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorDisplayName = table.Column<string>(type: "text", nullable: false),
                    ActorRole = table.Column<string>(type: "text", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    TargetType = table.Column<string>(type: "text", nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetDisplayName = table.Column<string>(type: "text", nullable: false),
                    Outcome = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DeviceMasterRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayId = table.Column<string>(type: "text", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantName = table.Column<string>(type: "text", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkspaceName = table.Column<string>(type: "text", nullable: false),
                    DeviceName = table.Column<string>(type: "text", nullable: false),
                    DeviceType = table.Column<string>(type: "text", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerDisplayName = table.Column<string>(type: "text", nullable: false),
                    OwnerEmail = table.Column<string>(type: "text", nullable: false),
                    MdmProvider = table.Column<string>(type: "text", nullable: false),
                    MdmDeviceId = table.Column<string>(type: "text", nullable: false),
                    MaskedSerialNumber = table.Column<string>(type: "text", nullable: false),
                    OperatingSystem = table.Column<string>(type: "text", nullable: false),
                    OperatingSystemVersion = table.Column<string>(type: "text", nullable: false),
                    EnrolledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ApprovalState = table.Column<string>(type: "text", nullable: false),
                    ComplianceState = table.Column<string>(type: "text", nullable: false),
                    ComplianceEvaluatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastMdmCloudSyncAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastMdmCloudSyncSource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastHardwareDeviceCheckInAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastHardwareDeviceCheckInSource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastPwaAuthenticationAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastPwaAuthenticationSource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastPwaForegroundActivityAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastPwaForegroundActivitySource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastProtectedApiRequestAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastProtectedApiRequestSource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastSessionStartAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastSessionStartSource = table.Column<string>(type: "text", nullable: false),
                    LastUsedSignals_LastExplicitLogoutAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastUsedSignals_LastExplicitLogoutSource = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceMasterRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditRecords_TenantId_WorkspaceId_OccurredAt",
                table: "AuditRecords",
                columns: new[] { "TenantId", "WorkspaceId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId",
                table: "DeviceMasterRecords",
                columns: new[] { "TenantId", "WorkspaceId", "DisplayId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditRecords");

            migrationBuilder.DropTable(
                name: "DeviceMasterRecords");
        }
    }
}
