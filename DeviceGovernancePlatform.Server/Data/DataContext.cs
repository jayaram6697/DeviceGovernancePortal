using DeviceGovernancePlatform.Server.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using System.Data;

namespace DeviceGovernancePlatform.Server.Data;

public sealed class DataContext(DbContextOptions<DataContext> options) : DbContext(options)
{
    private static readonly ValueConverter<DateTimeOffset, long> DateTimeOffsetConverter = new(
        value => value.UtcTicks,
        ticks => new DateTimeOffset(ticks, TimeSpan.Zero));

    private static readonly ValueConverter<DateTimeOffset?, long?> NullableDateTimeOffsetConverter = new(
        value => value.HasValue ? value.Value.UtcTicks : null,
        ticks => ticks.HasValue ? new DateTimeOffset(ticks.Value, TimeSpan.Zero) : null);

    public DbSet<DeviceMasterRecord> DeviceMasterRecords => Set<DeviceMasterRecord>();
    public DbSet<AuditRecord> AuditRecords => Set<AuditRecord>();

    public async Task EnsureSqliteLifecycleStateColumnAsync(CancellationToken cancellationToken = default)
    {
        if (Database.ProviderName != "Microsoft.EntityFrameworkCore.Sqlite")
        {
            return;
        }

        var connection = Database.GetDbConnection();
        var closeConnection = connection.State != ConnectionState.Open;
        if (closeConnection)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA table_info('DeviceMasterRecords');";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var hasLifecycleState = false;
            while (await reader.ReadAsync(cancellationToken))
            {
                if (reader.GetString(1) == "LifecycleState")
                {
                    hasLifecycleState = true;
                    break;
                }
            }
            await reader.DisposeAsync();

            if (!hasLifecycleState)
            {
                await Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"DeviceMasterRecords\" ADD COLUMN \"LifecycleState\" TEXT NOT NULL DEFAULT 'Active';",
                    cancellationToken);
            }

            await using var indexCommand = connection.CreateCommand();
            indexCommand.CommandText = """
                SELECT COUNT(*)
                FROM (
                    SELECT TenantId, WorkspaceId, DisplayId
                    FROM DeviceMasterRecords
                    GROUP BY TenantId, WorkspaceId, DisplayId
                    HAVING COUNT(*) > 1
                );
                """;
            var duplicateDisplayIdGroups = Convert.ToInt64(await indexCommand.ExecuteScalarAsync(cancellationToken));
            if (duplicateDisplayIdGroups > 0)
            {
                throw new InvalidOperationException(
                    $"Cannot enforce unique device IDs: {duplicateDisplayIdGroups} duplicate ID group(s) exist in the SQLite database.");
            }

            indexCommand.CommandText = """
                CREATE UNIQUE INDEX IF NOT EXISTS "UX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId"
                    ON "DeviceMasterRecords" ("TenantId", "WorkspaceId", "DisplayId");
                DROP INDEX IF EXISTS "IX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId";
                """;
            await indexCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            if (closeConnection)
            {
                await connection.CloseAsync();
            }
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DeviceMasterRecord>(entity =>
        {
            entity.HasKey(device => device.Id);
            entity.HasIndex(device => new { device.TenantId, device.WorkspaceId, device.DisplayId })
                .HasDatabaseName("UX_DeviceMasterRecords_TenantId_WorkspaceId_DisplayId")
                .IsUnique();
            entity.Property(device => device.ApprovalState).HasConversion<string>();
            entity.Property(device => device.ComplianceState).HasConversion<string>();
            entity.Property(device => device.LifecycleState).HasConversion<string>().HasDefaultValue(DeviceLifecycleState.Active);
            entity.OwnsOne(device => device.LastUsedSignals);
            entity.Navigation(device => device.LastUsedSignals).IsRequired();
        });

        modelBuilder.Entity<AuditRecord>(entity =>
        {
            entity.HasKey(record => record.Id);
            entity.HasIndex(record => new { record.TenantId, record.WorkspaceId, record.OccurredAt });
        });

        if (Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            foreach (var property in modelBuilder.Model.GetEntityTypes().SelectMany(entity => entity.GetProperties()))
            {
                if (property.ClrType == typeof(DateTimeOffset))
                {
                    property.SetValueConverter(DateTimeOffsetConverter);
                }
                else if (property.ClrType == typeof(DateTimeOffset?))
                {
                    property.SetValueConverter(NullableDateTimeOffsetConverter);
                }
            }
        }
    }
}
