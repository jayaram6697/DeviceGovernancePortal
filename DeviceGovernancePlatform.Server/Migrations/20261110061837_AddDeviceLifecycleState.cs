using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeviceGovernancePlatform.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceLifecycleState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LifecycleState",
                table: "DeviceMasterRecords",
                type: "text",
                nullable: false,
                defaultValue: "Active");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LifecycleState",
                table: "DeviceMasterRecords");
        }
    }
}
