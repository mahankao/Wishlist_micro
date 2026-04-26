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

await EnsureDatabaseCreatedAsync(app.Services);

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

static async Task EnsureDatabaseCreatedAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

    const int maxAttempts = 10;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            await db.Database.EnsureCreatedAsync();
            await EnsureInboxSchemaAsync(db);
            return;
        }
        catch when (attempt < maxAttempts)
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }

    await db.Database.EnsureCreatedAsync();
    await EnsureInboxSchemaAsync(db);
}

static async Task EnsureInboxSchemaAsync(NotificationDbContext db)
{
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS notification_inbox_messages (
            event_id uuid PRIMARY KEY,
            event_type character varying(200) NOT NULL,
            wishlist_id uuid NOT NULL,
            item_id uuid NOT NULL,
            owner_user_id uuid NOT NULL,
            actor_user_id uuid NOT NULL,
            occurred_at_utc timestamp with time zone NOT NULL,
            received_at_utc timestamp with time zone NOT NULL
        );
        """);
    await db.Database.ExecuteSqlRawAsync("""
        CREATE INDEX IF NOT EXISTS ix_notification_inbox_messages_received_at_utc
        ON notification_inbox_messages (received_at_utc);
        """);
}
