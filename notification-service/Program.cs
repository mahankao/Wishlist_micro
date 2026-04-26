using Microsoft.EntityFrameworkCore;
using NotificationService.Config;
using NotificationService.Data;
using NotificationService.Messaging;
using NotificationService.Observability;
using Prometheus;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options =>
{
    options.IncludeScopes = true;
    options.UseUtcTimestamp = true;
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddDbContext<NotificationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection(RabbitMqOptions.SectionName));
builder.Services.AddHostedService<WishlistEventConsumerHostedService>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseHttpMetrics();

await MigrateDatabaseAsync(app.Services);

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "notification-service" }));
app.MapGet("/notifications/health", () => Results.Ok(new { status = "ok", service = "notification-service" }));
app.MapMetrics("/metrics");
app.MapGet("/notifications/inbox", async (NotificationDbContext db, CancellationToken cancellationToken) =>
{
    var items = await db.InboxMessages
        .OrderByDescending(x => x.ReceivedAtUtc)
        .Take(100)
        .Select(x => new
        {
            x.EventId,
            x.EventType,
            x.WishlistId,
            x.ItemId,
            x.OwnerUserId,
            x.ActorUserId,
            x.OccurredAtUtc,
            x.ReceivedAtUtc
        })
        .ToListAsync(cancellationToken);

    return Results.Ok(items);
});

app.Run();

static async Task MigrateDatabaseAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

    const int maxAttempts = 10;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            await db.Database.MigrateAsync();
            return;
        }
        catch when (attempt < maxAttempts)
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }

    await db.Database.MigrateAsync();
}
