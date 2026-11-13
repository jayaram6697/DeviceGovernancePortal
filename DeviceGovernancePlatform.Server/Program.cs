using System.Text.Json.Serialization;
using DeviceGovernancePlatform.Server.Data;
using DeviceGovernancePlatform.Server.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var sqliteConnectionString = builder.Configuration.GetConnectionString("FallbackConnection")
    ?? "Data Source=mdm_governance.db";
var postgresConnectionString = builder.Configuration.GetConnectionString("DefaultConnection");

var usePostgres = false;
var postgresConnectionError = string.Empty;
var isLocalDotnetRun = !builder.Environment.IsEnvironment("Docker")
    && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER"));

if (!isLocalDotnetRun && !string.IsNullOrWhiteSpace(postgresConnectionString))
{
    try
    {
        var databaseOptions = new DbContextOptionsBuilder<DataContext>()
            .UseNpgsql(postgresConnectionString)
            .Options;

        await using (var databaseProbe = new DataContext(databaseOptions))
        {
            usePostgres = await databaseProbe.Database.CanConnectAsync();
        }
    }
    catch (Exception ex)
    {
        postgresConnectionError = ex.Message;
        usePostgres = false;
    }
}

if (isLocalDotnetRun)
{
    usePostgres = false;
}

builder.WebHost.UseUrls(isLocalDotnetRun ? "http://localhost:5080" : "http://+:5080");

builder.Services.AddControllers()
    .AddJsonOptions(options =>
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddDbContext<DataContext>(options =>
{
    if (usePostgres && !string.IsNullOrWhiteSpace(postgresConnectionString))
    {
        options.UseNpgsql(postgresConnectionString);
    }
    else
    {
        options.UseSqlite(sqliteConnectionString);
    }
});
builder.Services.AddSingleton<IDeviceGovernanceStore, InMemoryDeviceGovernanceStore>();
builder.Services.AddScoped<DemoDataSeeder>();
builder.Services.AddCors(options => options.AddPolicy("ReactDevelopmentClient", policy =>
    policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();

if (usePostgres)
{
    app.Logger.LogInformation("Using PostgreSQL database for this environment.");
}
else
{
    app.Logger.LogWarning(
        "PostgreSQL is unavailable or local SQLite mode is active. Using the persistent SQLite database: {ConnectionString}",
        sqliteConnectionString);

    if (!string.IsNullOrWhiteSpace(postgresConnectionError))
    {
        app.Logger.LogWarning("PostgreSQL connection probe failed: {Error}", postgresConnectionError);
    }
}

app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.RoutePrefix = "swagger";
});
app.UseCors("ReactDevelopmentClient");
app.MapGet("/", () => Results.Redirect("/swagger"));
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var dataContext = scope.ServiceProvider.GetRequiredService<DataContext>();

    try
    {
        if (usePostgres)
        {
            await dataContext.Database.MigrateAsync();
        }
        else
        {
            await dataContext.Database.EnsureCreatedAsync();
            await dataContext.EnsureSqliteLifecycleStateColumnAsync();
        }

        var seeder = scope.ServiceProvider.GetRequiredService<DemoDataSeeder>();
        await seeder.SeedIfEmptyAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Database initialization failed. Continuing with the API running in degraded mode.");
    }
}

app.Run();