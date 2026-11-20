using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeviceGovernancePlatform.Server.Migrations
{
    /// <inheritdoc />
    public partial class EnforceUniqueDeviceDisplayIds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId",
                table: "DeviceMasterRecords");

            migrationBuilder.CreateIndex(
                name: "UX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId",
                table: "DeviceMasterRecords",
                columns: new[] { "TenantId", "WorkspaceId", "DisplayId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId",
                table: "DeviceMasterRecords");

            migrationBuilder.CreateIndex(
                name: "IX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId",
                table: "DeviceMasterRecords",
                columns: new[] { "TenantId", "WorkspaceId", "DisplayId" });
        }
    }
}
