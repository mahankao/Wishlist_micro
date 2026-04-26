using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ChatService.Contracts;
using ChatService.Data;
using ChatService.Integration;
using ChatService.Models;
using ChatService.Observability;
using ChatService.Realtime;
using ChatService.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
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
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "ChatService", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Bearer {token}"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<UserServiceOptions>(builder.Configuration.GetSection(UserServiceOptions.SectionName));
builder.Services.Configure<WishlistServiceOptions>(builder.Configuration.GetSection(WishlistServiceOptions.SectionName));

var jwtOptions = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = signingKey,
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        // Allow JWT in WebSocket query string for /chat/ws.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrWhiteSpace(accessToken) && path.StartsWithSegments("/chat/ws"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddTransient<CorrelationHeaderHandler>();

builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHttpClient<UserServiceClient>((serviceProvider, client) =>
{
    var options = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<UserServiceOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl);
})
.AddHttpMessageHandler<CorrelationHeaderHandler>();
builder.Services.AddHttpClient<WishlistServiceClient>((serviceProvider, client) =>
{
    var options = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<WishlistServiceOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl);
})
.AddHttpMessageHandler<CorrelationHeaderHandler>();

builder.Services.AddSingleton<ChatConnectionManager>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseHttpMetrics();
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();

await EnsureDatabaseCreatedAsync(app.Services);

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "chat-service" }));
app.MapGet("/chat/health", () => Results.Ok(new { status = "ok", service = "chat-service" }));
app.MapMetrics("/metrics");

app.MapGet("/chat/messages", async (
    Guid wishlistId,
    Guid itemId,
    Guid shareToken,
    ClaimsPrincipal principal,
    ChatDbContext db,
    UserServiceClient userServiceClient,
    WishlistServiceClient wishlistServiceClient,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    if (userId is null) return Results.Unauthorized();

    var accessCheck = await EnsureAccessAsync(userId.Value, shareToken, itemId, userServiceClient, wishlistServiceClient, cancellationToken);
    if (accessCheck is not null) return accessCheck;

    var messages = await db.ChatMessages
        .Where(x => x.WishlistId == wishlistId && x.ItemId == itemId)
        .OrderBy(x => x.CreatedAtUtc)
        .Take(200)
        .Select(x => new ChatMessageResponse(x.Id, "anonymous", x.Text, x.CreatedAtUtc, x.SenderUserId == userId.Value))
        .ToListAsync(cancellationToken);

    return Results.Ok(messages);
})
.RequireAuthorization()
.WithTags("Chat");

app.MapPost("/chat/messages", async (
    PostChatMessageRequest request,
    ClaimsPrincipal principal,
    ChatDbContext db,
    UserServiceClient userServiceClient,
    WishlistServiceClient wishlistServiceClient,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    if (userId is null) return Results.Unauthorized();

    var text = request.Text.Trim();
    if (string.IsNullOrWhiteSpace(text) || text.Length > 2000)
    {
        return Results.BadRequest(new { error = "Text is required and must be at most 2000 characters." });
    }

    var accessCheck = await EnsureAccessAsync(userId.Value, request.ShareToken, request.ItemId, userServiceClient, wishlistServiceClient, cancellationToken);
    if (accessCheck is not null) return accessCheck;

    var message = new ChatMessage
    {
        WishlistId = request.WishlistId,
        ItemId = request.ItemId,
        SenderUserId = userId.Value,
        Text = text
    };
    db.ChatMessages.Add(message);
    await db.SaveChangesAsync(cancellationToken);
    ServiceMetrics.ChatMessagesSent.Inc();

    return Results.Ok(new ChatMessageResponse(message.Id, "anonymous", message.Text, message.CreatedAtUtc, true));
})
.RequireAuthorization()
.WithTags("Chat");

app.Map("/chat/ws", async (
    HttpContext context,
    ClaimsPrincipal principal,
    ChatDbContext db,
    UserServiceClient userServiceClient,
    WishlistServiceClient wishlistServiceClient,
    ChatConnectionManager connectionManager) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("WebSocket request expected.");
        return;
    }

    var userId = GetUserId(principal);
    if (userId is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    if (!Guid.TryParse(context.Request.Query["wishlistId"], out var wishlistId) ||
        !Guid.TryParse(context.Request.Query["itemId"], out var itemId) ||
        !Guid.TryParse(context.Request.Query["shareToken"], out var shareToken))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("wishlistId, itemId and shareToken query params are required.");
        return;
    }

    var accessCheck = await EnsureAccessAsync(userId.Value, shareToken, itemId, userServiceClient, wishlistServiceClient, context.RequestAborted);
    if (accessCheck is IResult denied)
    {
        await denied.ExecuteAsync(context);
        return;
    }

    var socket = await context.WebSockets.AcceptWebSocketAsync();
    var roomKey = $"{wishlistId:N}:{itemId:N}";
    var connectionId = connectionManager.AddConnection(roomKey, socket);
    var buffer = new byte[4 * 1024];

    try
    {
        while (socket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), context.RequestAborted);
            if (result.MessageType == WebSocketMessageType.Close) break;
            if (result.MessageType != WebSocketMessageType.Text) continue;

            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            WsIncomingMessage? incoming;
            try
            {
                incoming = JsonSerializer.Deserialize<WsIncomingMessage>(text);
            }
            catch
            {
                incoming = null;
            }

            var payloadText = incoming?.Text?.Trim();
            if (string.IsNullOrWhiteSpace(payloadText) || payloadText.Length > 2000) continue;

            var message = new ChatMessage
            {
                WishlistId = wishlistId,
                ItemId = itemId,
                SenderUserId = userId.Value,
                Text = payloadText
            };
            db.ChatMessages.Add(message);
            await db.SaveChangesAsync(context.RequestAborted);
            ServiceMetrics.ChatMessagesSent.Inc();

            var outgoing = JsonSerializer.Serialize(
                new ChatMessageResponse(message.Id, "anonymous", message.Text, message.CreatedAtUtc, false)
            );
            await connectionManager.BroadcastAsync(roomKey, outgoing, context.RequestAborted);
        }
    }
    finally
    {
        connectionManager.RemoveConnection(roomKey, connectionId);
        if (socket.State != WebSocketState.Closed && socket.State != WebSocketState.Aborted)
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None);
        }
        socket.Dispose();
    }
})
.RequireAuthorization()
.WithTags("Chat");

app.Run();

static Guid? GetUserId(ClaimsPrincipal principal)
{
    var raw = principal.FindFirstValue(ClaimTypes.NameIdentifier)
              ?? principal.FindFirstValue("sub");
    return Guid.TryParse(raw, out var userId) ? userId : null;
}

static async Task<IResult?> EnsureAccessAsync(
    Guid userId,
    Guid shareToken,
    Guid itemId,
    UserServiceClient userServiceClient,
    WishlistServiceClient wishlistServiceClient,
    CancellationToken cancellationToken)
{
    var userLookup = await userServiceClient.UserExistsAsync(userId, cancellationToken);
    if (userLookup == UserLookupResult.NotFound) return Results.NotFound(new { error = "User not found." });
    if (userLookup == UserLookupResult.Unavailable) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    var roomLookup = await wishlistServiceClient.ValidateRoomAsync(shareToken, itemId, cancellationToken);
    if (roomLookup == RoomValidationResult.NotFound) return Results.NotFound(new { error = "Chat room not found." });
    if (roomLookup == RoomValidationResult.Unavailable) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    return null;
}

static async Task EnsureDatabaseCreatedAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();

    const int maxAttempts = 10;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            await db.Database.EnsureCreatedAsync();
            return;
        }
        catch when (attempt < maxAttempts)
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }

    await db.Database.EnsureCreatedAsync();
}
