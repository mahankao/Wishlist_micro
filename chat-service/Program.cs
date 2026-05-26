using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ChatService.Config;
using ChatService.Contracts;
using ChatService.Data;
using ChatService.Integration;
using ChatService.Messaging;
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

// Chat-service пишет структурированные JSON-логи, как и остальные backend-сервисы.
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
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection(RabbitMqOptions.SectionName));

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

        // Для WebSocket браузер не может удобно передать Authorization header, поэтому JWT берется из query string.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrWhiteSpace(accessToken) &&
                    (path.StartsWithSegments("/chat/ws") || path.StartsWithSegments("/chat/notifications/ws")))
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

// Сообщения чата хранятся в отдельной chat-db, без прямого доступа к БД других сервисов.
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// HTTP-клиенты проверяют пользователя и существование комнаты через публичные API других сервисов.
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
builder.Services.AddHostedService<WishlistCreatedConsumerHostedService>();

var app = builder.Build();
var webSocketJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

app.UseSwagger();
app.UseSwaggerUI();

// Correlation ID и request logs помогают связать REST/WebSocket подготовку с вызовами user/wishlist сервисов.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseHttpMetrics();
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();

await MigrateDatabaseAsync(app.Services);

// Health endpoints нужны для docker compose, а /metrics читает Prometheus.
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

    // Перед чтением истории проверяем, что пользователь и item существуют.
    var accessCheck = await EnsureAccessAsync(userId.Value, shareToken, itemId, userServiceClient, wishlistServiceClient, cancellationToken);
    if (accessCheck.Error is not null) return accessCheck.Error;
    if (accessCheck.WishlistId != wishlistId) return Results.StatusCode(StatusCodes.Status403Forbidden);

    var chatMessages = await db.ChatMessages
        .Where(x => x.WishlistId == wishlistId && x.ItemId == itemId)
        .OrderBy(x => x.CreatedAtUtc)
        .Take(200)
        .ToListAsync(cancellationToken);
    var displayNames = await LoadDisplayNamesAsync(chatMessages.Select(x => x.SenderUserId), userServiceClient, cancellationToken);
    var messages = chatMessages.Select(x => ToResponse(x, userId.Value, accessCheck.OwnerUserId!.Value, displayNames)).ToList();

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
    ChatConnectionManager connectionManager,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    if (userId is null) return Results.Unauthorized();

    // Сообщение можно отправить только в существующую комнату wishlist item.
    var text = request.Text?.Trim() ?? "";
    if (string.IsNullOrWhiteSpace(text) || text.Length > 2000)
    {
        return Results.BadRequest(new { error = "Text is required and must be at most 2000 characters." });
    }

    var accessCheck = await EnsureAccessAsync(userId.Value, request.ShareToken, request.ItemId, userServiceClient, wishlistServiceClient, cancellationToken);
    if (accessCheck.Error is not null) return accessCheck.Error;
    if (accessCheck.WishlistId != request.WishlistId) return Results.StatusCode(StatusCodes.Status403Forbidden);

    var message = new ChatMessage
    {
        WishlistId = accessCheck.WishlistId.Value,
        ItemId = request.ItemId,
        SenderUserId = userId.Value,
        Text = text
    };
    db.ChatMessages.Add(message);
    await db.SaveChangesAsync(cancellationToken);
    ServiceMetrics.ChatMessagesSent.Inc();

    var displayName = GetDisplayName(principal);
    if (displayName == "anonymous")
    {
        var user = await userServiceClient.GetUserAsync(userId.Value, cancellationToken);
        if (!string.IsNullOrWhiteSpace(user?.DisplayName))
        {
            displayName = user.DisplayName;
        }
    }
    var displayNames = new Dictionary<Guid, string> { [userId.Value] = displayName };
    var response = ToResponse(message, userId.Value, accessCheck.OwnerUserId!.Value, displayNames);
    var roomKey = $"{accessCheck.WishlistId.Value:N}:{request.ItemId:N}";
    var broadcastPayload = JsonSerializer.Serialize(
        ToResponse(message, Guid.Empty, accessCheck.OwnerUserId!.Value, displayNames),
        webSocketJsonOptions
    );
    await connectionManager.BroadcastAsync(roomKey, broadcastPayload, cancellationToken);
    await BroadcastOwnerChatNotificationAsync(
        connectionManager,
        accessCheck.OwnerUserId!.Value,
        userId.Value,
        accessCheck.WishlistId.Value,
        request.ItemId,
        webSocketJsonOptions,
        cancellationToken);

    return Results.Ok(response);
})
.RequireAuthorization()
.WithTags("Chat");

app.Map("/chat/notifications/ws", async (
    HttpContext context,
    ClaimsPrincipal principal,
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

    var socket = await context.WebSockets.AcceptWebSocketAsync();
    var roomKey = GetUserNotificationRoomKey(userId.Value);
    var connectionId = connectionManager.AddConnection(roomKey, socket);
    var buffer = new byte[256];

    try
    {
        while (socket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), context.RequestAborted);
            if (result.MessageType == WebSocketMessageType.Close) break;
        }
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (WebSocketException) { }
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
    if (accessCheck.Error is IResult denied)
    {
        await denied.ExecuteAsync(context);
        return;
    }
    if (accessCheck.WishlistId != wishlistId)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    var socket = await context.WebSockets.AcceptWebSocketAsync();
    var roomKey = $"{accessCheck.WishlistId.Value:N}:{itemId:N}";
    // Комната строится по wishlistId и itemId: все подключения к одному подарку получают общие сообщения.
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
                incoming = JsonSerializer.Deserialize<WsIncomingMessage>(text, webSocketJsonOptions);
            }
            catch
            {
                incoming = null;
            }

            var payloadText = incoming?.Text?.Trim();
            if (string.IsNullOrWhiteSpace(payloadText) || payloadText.Length > 2000) continue;

            var message = new ChatMessage
            {
                WishlistId = accessCheck.WishlistId.Value,
                ItemId = itemId,
                SenderUserId = userId.Value,
                Text = payloadText
            };
            db.ChatMessages.Add(message);
            await db.SaveChangesAsync(context.RequestAborted);
            ServiceMetrics.ChatMessagesSent.Inc();

            var outgoing = JsonSerializer.Serialize(
                ToResponse(
                    message,
                    Guid.Empty,
                    accessCheck.OwnerUserId!.Value,
                    new Dictionary<Guid, string> { [userId.Value] = GetDisplayName(principal) }
                ),
                webSocketJsonOptions
            );
            await connectionManager.BroadcastAsync(roomKey, outgoing, context.RequestAborted);
            await BroadcastOwnerChatNotificationAsync(
                connectionManager,
                accessCheck.OwnerUserId!.Value,
                userId.Value,
                accessCheck.WishlistId.Value,
                itemId,
                webSocketJsonOptions,
                context.RequestAborted);
        }
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (WebSocketException) { }
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

static string GetDisplayName(ClaimsPrincipal principal) =>
    principal.FindFirstValue("display_name")
    ?? principal.FindFirstValue(ClaimTypes.Name)
    ?? "anonymous";

static string GetUserNotificationRoomKey(Guid userId) => $"user:{userId:N}:chat-notifications";

static Task BroadcastOwnerChatNotificationAsync(
    ChatConnectionManager connectionManager,
    Guid ownerUserId,
    Guid senderUserId,
    Guid wishlistId,
    Guid itemId,
    JsonSerializerOptions jsonOptions,
    CancellationToken cancellationToken)
{
    if (ownerUserId == senderUserId) return Task.CompletedTask;

    var payload = JsonSerializer.Serialize(new
    {
        Type = "chat.message.created",
        WishlistId = wishlistId,
        ItemId = itemId,
        OccurredAtUtc = DateTime.UtcNow
    }, jsonOptions);

    return connectionManager.BroadcastAsync(GetUserNotificationRoomKey(ownerUserId), payload, cancellationToken);
}

static ChatMessageResponse ToResponse(
    ChatMessage message,
    Guid currentUserId,
    Guid ownerUserId,
    IReadOnlyDictionary<Guid, string> displayNames)
{
    var senderDisplayName = "Анонимный гость";
    if (message.SenderUserId == ownerUserId)
    {
        senderDisplayName = displayNames.TryGetValue(message.SenderUserId, out var ownerDisplayName) &&
                            !string.IsNullOrWhiteSpace(ownerDisplayName)
            ? ownerDisplayName
            : "Владелец wishlist";
    }
    else if (message.SenderUserId == currentUserId && currentUserId != Guid.Empty)
    {
        senderDisplayName = displayNames.TryGetValue(message.SenderUserId, out var guestDisplayName) &&
                            !string.IsNullOrWhiteSpace(guestDisplayName)
            ? guestDisplayName
            : "Гость";
    }

    return new ChatMessageResponse(
        message.Id,
        message.SenderUserId,
        senderDisplayName,
        senderDisplayName,
        message.Text,
        message.CreatedAtUtc,
        message.SenderUserId == currentUserId
    );
}

static async Task<Dictionary<Guid, string>> LoadDisplayNamesAsync(
    IEnumerable<Guid> userIds,
    UserServiceClient userServiceClient,
    CancellationToken cancellationToken)
{
    var displayNames = new Dictionary<Guid, string>();
    foreach (var userId in userIds.Distinct())
    {
        var user = await userServiceClient.GetUserAsync(userId, cancellationToken);
        if (user is not null)
        {
            displayNames[userId] = user.DisplayName;
        }
    }

    return displayNames;
}

static async Task<(IResult? Error, Guid? WishlistId, Guid? OwnerUserId)> EnsureAccessAsync(
    Guid userId,
    Guid shareToken,
    Guid itemId,
    UserServiceClient userServiceClient,
    WishlistServiceClient wishlistServiceClient,
    CancellationToken cancellationToken)
{
    var userLookup = await userServiceClient.UserExistsAsync(userId, cancellationToken);
    if (userLookup == UserLookupResult.NotFound) return (Results.NotFound(new { error = "User not found." }), null, null);
    if (userLookup == UserLookupResult.Unavailable) return (Results.StatusCode(StatusCodes.Status503ServiceUnavailable), null, null);

    var roomLookup = await wishlistServiceClient.ValidateRoomAsync(shareToken, itemId, cancellationToken);
    if (roomLookup.Result == RoomValidationResult.NotFound) return (Results.NotFound(new { error = "Chat room not found." }), null, null);
    if (roomLookup.Result == RoomValidationResult.Unavailable) return (Results.StatusCode(StatusCodes.Status503ServiceUnavailable), null, null);

    return (null, roomLookup.WishlistId, roomLookup.OwnerUserId);
}

static async Task MigrateDatabaseAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();

    const int maxAttempts = 10;
    // Миграции повторяются, чтобы сервис переживал медленный старт PostgreSQL в docker compose.
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
