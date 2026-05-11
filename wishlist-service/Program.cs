using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Microsoft.Extensions.Options;
using Prometheus;
using WishlistService.Config;
using WishlistService.Contracts;
using WishlistService.Data;
using WishlistService.Integration;
using WishlistService.Messaging;
using WishlistService.Models;
using WishlistService.Observability;
using WishlistService.Security;

var builder = WebApplication.CreateBuilder(args);

// JSON-логи проще читать в docker logs и связывать с correlationId.
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
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "WishlistService", Version = "v1" });
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

// Wishlist-service проверяет JWT, но не хранит пароли пользователей.
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
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
    });
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddTransient<CorrelationHeaderHandler>();

// Собственная БД сервиса: wishlist, items и outbox-сообщения лежат только здесь.
builder.Services.AddDbContext<WishlistDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.Configure<UserServiceOptions>(builder.Configuration.GetSection(UserServiceOptions.SectionName));
builder.Services.Configure<WishlistOptions>(builder.Configuration.GetSection(WishlistOptions.SectionName));
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection(RabbitMqOptions.SectionName));
builder.Services.Configure<OutboxOptions>(builder.Configuration.GetSection(OutboxOptions.SectionName));
// Синхронный HTTP-вызов в user-service проверяет, что владелец wishlist существует.
builder.Services.AddHttpClient<UserServiceClient>((serviceProvider, client) =>
{
    var options = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<UserServiceOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl);
})
.AddHttpMessageHandler<CorrelationHeaderHandler>();
// Фоновый worker публикует накопленные outbox-события в RabbitMQ.
builder.Services.AddHostedService<OutboxPublisherHostedService>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Middleware добавляют correlationId, JSON-лог запроса и стандартные Prometheus HTTP-метрики.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseHttpMetrics();
app.UseAuthentication();
app.UseAuthorization();

await MigrateDatabaseAsync(app.Services);

// Health endpoints нужны для healthcheck контейнера и ручной проверки сервиса.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "wishlist-service" }));
app.MapGet("/wishlists/health", () => Results.Ok(new { status = "ok", service = "wishlist-service" }));
app.MapMetrics("/metrics");

app.MapPost("/wishlists", async (
    CreateWishlistRequest request,
    ClaimsPrincipal principal,
    WishlistDbContext db,
    UserServiceClient userServiceClient,
    CancellationToken cancellationToken) =>
{
    var ownerUserId = GetUserId(principal);
    if (ownerUserId is null) return Results.Unauthorized();

    // Пользовательские строки очищаются на входе, чтобы в БД попадали нормализованные значения.
    var title = request.Title.Trim();
    var description = request.Description?.Trim();
    if (!IsValidWishlistPayload(title, description))
    {
        return Results.BadRequest(new { error = "Invalid wishlist payload." });
    }

    var userLookup = await userServiceClient.UserExistsAsync(ownerUserId.Value, cancellationToken);
    if (userLookup == UserLookupResult.NotFound)
    {
        return Results.NotFound(new { error = "Owner user not found." });
    }
    if (userLookup == UserLookupResult.Unavailable)
    {
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }

    var wishlist = new Wishlist
    {
        OwnerUserId = ownerUserId.Value,
        Title = title,
        Description = string.IsNullOrWhiteSpace(description) ? null : description
    };

    db.Wishlists.Add(wishlist);
    await db.SaveChangesAsync(cancellationToken);
    ServiceMetrics.WishlistsCreated.Inc();

    return Results.Created($"/wishlists/{wishlist.Id}", ToWishlistResponse(wishlist));
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapGet("/wishlists", async (
    ClaimsPrincipal principal,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var ownerUserId = GetUserId(principal);
    if (ownerUserId is null) return Results.Unauthorized();

    var wishlists = await db.Wishlists
        .Include(x => x.Items.OrderBy(i => i.CreatedAtUtc))
        .Where(x => x.OwnerUserId == ownerUserId.Value)
        .OrderByDescending(x => x.CreatedAtUtc)
        .ToListAsync(cancellationToken);

    return Results.Ok(wishlists.Select(ToWishlistResponse).ToList());
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapPost("/wishlists/{wishlistId:guid}/items", async (
    Guid wishlistId,
    AddWishlistItemRequest request,
    ClaimsPrincipal principal,
    IOptions<WishlistOptions> wishlistOptions,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var ownerUserId = GetUserId(principal);
    if (ownerUserId is null) return Results.Unauthorized();

    // Добавлять подарки может только владелец wishlist.
    var wishlist = await db.Wishlists.FirstOrDefaultAsync(x => x.Id == wishlistId, cancellationToken);
    if (wishlist is null) return Results.NotFound(new { error = "Wishlist not found." });
    if (wishlist.OwnerUserId != ownerUserId.Value) return Results.StatusCode(StatusCodes.Status403Forbidden);

    var title = request.Title.Trim();
    var url = request.Url?.Trim();
    var imageUrl = request.ImageUrl?.Trim();
    var comment = request.Comment?.Trim();
    if (!IsValidItemPayload(title, url, imageUrl, request.Price, comment, out var validationError))
    {
        return Results.BadRequest(new { error = validationError });
    }

    var maxItems = Math.Max(1, wishlistOptions.Value.MaxItemsPerWishlist);
    var itemCount = await db.WishlistItems.CountAsync(x => x.WishlistId == wishlist.Id, cancellationToken);
    if (itemCount >= maxItems)
    {
        return Results.BadRequest(new { error = $"Wishlist item limit reached ({maxItems})." });
    }

    var item = new WishlistItem
    {
        WishlistId = wishlist.Id,
        Title = title,
        Url = string.IsNullOrWhiteSpace(url) ? null : url,
        ImageUrl = string.IsNullOrWhiteSpace(imageUrl) ? null : imageUrl,
        Price = request.Price,
        Comment = string.IsNullOrWhiteSpace(comment) ? null : comment
    };

    db.WishlistItems.Add(item);
    await db.SaveChangesAsync(cancellationToken);
    ServiceMetrics.WishlistItemsAdded.Inc();

    return Results.Created($"/wishlists/{wishlistId}/items/{item.Id}", ToItemResponse(item));
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapGet("/wishlists/reservations/me", async (
    ClaimsPrincipal principal,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    if (userId is null) return Results.Unauthorized();

    var reservedItems = await db.WishlistItems
        .Include(x => x.Wishlist)
        .Where(x => x.ReservedByUserId == userId.Value && x.ReservedAtUtc != null)
        .OrderByDescending(x => x.ReservedAtUtc)
        .Select(x => new MyReservedItemResponse(
            x.WishlistId,
            x.Wishlist.ShareToken,
            x.Wishlist.Title,
            x.Id,
            x.Title,
            x.ReservedAtUtc!.Value
        ))
        .ToListAsync(cancellationToken);

    return Results.Ok(reservedItems);
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapPost("/wishlists/{wishlistId:guid}/items/{itemId:guid}/reserve", async (
    Guid wishlistId,
    Guid itemId,
    ClaimsPrincipal principal,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var reserverUserId = GetUserId(principal);
    if (reserverUserId is null) return Results.Unauthorized();

    // Владелец не резервирует собственный подарок; резервирование предназначено для другого пользователя.
    var item = await db.WishlistItems
        .Include(x => x.Wishlist)
        .AsNoTracking()
        .FirstOrDefaultAsync(x => x.WishlistId == wishlistId && x.Id == itemId, cancellationToken);
    if (item is null) return Results.NotFound(new { error = "Wishlist item not found." });

    if (item.Wishlist.OwnerUserId == reserverUserId.Value)
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    if (item.ReservedByUserId is not null && item.ReservedByUserId != reserverUserId.Value)
    {
        return Results.Conflict(new { error = "Item is already reserved" });
    }

    // Repeating reserve by the same user is idempotent: return OK and do not enqueue another event.
    if (item.ReservedByUserId == reserverUserId.Value)
    {
        return Results.Ok(ToItemResponse(item));
    }

    var reservedAtUtc = DateTime.UtcNow;

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

    var updatedRows = await db.WishlistItems
        .Where(x => x.WishlistId == wishlistId && x.Id == itemId && x.ReservedByUserId == null)
        .ExecuteUpdateAsync(updates => updates
            .SetProperty(x => x.ReservedByUserId, reserverUserId.Value)
            .SetProperty(x => x.ReservedAtUtc, reservedAtUtc), cancellationToken);

    if (updatedRows == 0)
    {
        await transaction.RollbackAsync(cancellationToken);

        var currentItem = await db.WishlistItems
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.WishlistId == wishlistId && x.Id == itemId, cancellationToken);

        if (currentItem is null)
        {
            return Results.NotFound(new { error = "Wishlist item not found." });
        }

        if (currentItem.ReservedByUserId == reserverUserId.Value)
        {
            return Results.Ok(ToItemResponse(currentItem));
        }

        return Results.Conflict(new { error = "Item is already reserved" });
    }

    // Событие сохраняется в той же транзакции, что и изменение item: это outbox pattern.
    EnqueueOutboxEvent(
        db,
        new WishlistItemReservationEvent(
            Guid.NewGuid(),
            "wishlist.item.reserved",
            item.WishlistId,
            item.Id,
            item.Wishlist.OwnerUserId,
            reserverUserId.Value,
            reservedAtUtc));

    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    ServiceMetrics.WishlistItemsReserved.Inc();

    item.ReservedByUserId = reserverUserId.Value;
    item.ReservedAtUtc = reservedAtUtc;

    return Results.Ok(ToItemResponse(item));
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapPost("/wishlists/{wishlistId:guid}/items/{itemId:guid}/unreserve", async (
    Guid wishlistId,
    Guid itemId,
    ClaimsPrincipal principal,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var requesterUserId = GetUserId(principal);
    if (requesterUserId is null) return Results.Unauthorized();

    var item = await db.WishlistItems
        .Include(x => x.Wishlist)
        .FirstOrDefaultAsync(x => x.WishlistId == wishlistId && x.Id == itemId, cancellationToken);
    if (item is null) return Results.NotFound(new { error = "Wishlist item not found." });

    if (item.ReservedByUserId is null)
    {
        return Results.Conflict(new { error = "Item is not reserved." });
    }

    if (item.ReservedByUserId != requesterUserId.Value)
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    item.ReservedByUserId = null;
    item.ReservedAtUtc = null;

    // Разрезервирование тоже отправляется как событие, чтобы notification-service увидел изменение.
    EnqueueOutboxEvent(
        db,
        new WishlistItemReservationEvent(
            Guid.NewGuid(),
            "wishlist.item.unreserved",
            item.WishlistId,
            item.Id,
            item.Wishlist.OwnerUserId,
            requesterUserId.Value,
            DateTime.UtcNow));

    await db.SaveChangesAsync(cancellationToken);
    ServiceMetrics.WishlistItemsUnreserved.Inc();

    return Results.Ok(ToItemResponse(item));
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapGet("/wishlists/{wishlistId:guid}", async (
    Guid wishlistId,
    ClaimsPrincipal principal,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var ownerUserId = GetUserId(principal);
    if (ownerUserId is null) return Results.Unauthorized();

    var wishlist = await db.Wishlists
        .Include(x => x.Items.OrderBy(i => i.CreatedAtUtc))
        .FirstOrDefaultAsync(x => x.Id == wishlistId, cancellationToken);
    if (wishlist is null) return Results.NotFound(new { error = "Wishlist not found." });
    if (wishlist.OwnerUserId != ownerUserId.Value) return Results.StatusCode(StatusCodes.Status403Forbidden);

    return Results.Ok(ToWishlistResponse(wishlist));
})
.RequireAuthorization()
.WithTags("Wishlists");

app.MapGet("/wishlists/public/{shareToken:guid}", async (
    Guid shareToken,
    WishlistDbContext db,
    CancellationToken cancellationToken) =>
{
    var wishlist = await db.Wishlists
        .Include(x => x.Items.OrderBy(i => i.CreatedAtUtc))
        .FirstOrDefaultAsync(x => x.ShareToken == shareToken, cancellationToken);
    if (wishlist is null) return Results.NotFound(new { error = "Wishlist not found." });

    return Results.Ok(ToPublicWishlistResponse(wishlist));
})
.WithTags("Wishlists");

app.Run();

static Guid? GetUserId(ClaimsPrincipal principal)
{
    var raw = principal.FindFirstValue(ClaimTypes.NameIdentifier)
              ?? principal.FindFirstValue("sub");
    return Guid.TryParse(raw, out var userId) ? userId : null;
}

static bool IsValidWishlistPayload(string title, string? description)
{
    if (string.IsNullOrWhiteSpace(title) || title.Length > 200) return false;
    if (description is not null && description.Length > 1000) return false;
    return true;
}

static bool IsValidItemPayload(string title, string? url, string? imageUrl, decimal? price, string? comment, out string error)
{
    if (string.IsNullOrWhiteSpace(title) || title.Length > 200)
    {
        error = "Title is required and must be at most 200 characters.";
        return false;
    }
    if (comment is not null && comment.Length > 1000)
    {
        error = "Comment must be at most 1000 characters.";
        return false;
    }
    if (price is < 0)
    {
        error = "Price cannot be negative.";
        return false;
    }

    if (!IsValidAbsoluteHttpUrl(url, "Url", out error))
    {
        return false;
    }

    if (!IsValidAbsoluteHttpUrl(imageUrl, "ImageUrl", out error))
    {
        return false;
    }

    error = string.Empty;
    return true;
}

static bool IsValidAbsoluteHttpUrl(string? url, string fieldName, out string error)
{
    if (string.IsNullOrWhiteSpace(url))
    {
        error = string.Empty;
        return true;
    }

    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
    {
        error = $"{fieldName} must be a valid absolute URL.";
        return false;
    }

    if (uri.Scheme is not ("http" or "https"))
    {
        error = $"{fieldName} scheme must be http or https.";
        return false;
    }

    error = string.Empty;
    return true;
}

static WishlistResponse ToWishlistResponse(Wishlist wishlist) =>
    new(
        wishlist.Id,
        wishlist.OwnerUserId,
        wishlist.Title,
        wishlist.Description,
        wishlist.ShareToken,
        wishlist.CreatedAtUtc,
        wishlist.Items
            .OrderBy(x => x.CreatedAtUtc)
            .Select(ToItemResponse)
            .ToList()
    );

static PublicWishlistResponse ToPublicWishlistResponse(Wishlist wishlist) =>
    new(
        wishlist.Id,
        wishlist.OwnerUserId,
        wishlist.Title,
        wishlist.Description,
        wishlist.Items
            .OrderBy(x => x.CreatedAtUtc)
            .Select(ToItemResponse)
            .ToList()
    );

static WishlistItemResponse ToItemResponse(WishlistItem item) =>
    new(item.Id, item.Title, item.Url, item.ImageUrl, item.Price, item.Comment, item.ReservedByUserId is not null, item.ReservedAtUtc, item.CreatedAtUtc);

static async Task MigrateDatabaseAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<WishlistDbContext>();

    const int maxAttempts = 10;
    // Повтор нужен для старта в Docker, когда PostgreSQL еще не принимает подключения.
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

static void EnqueueOutboxEvent(WishlistDbContext db, WishlistItemReservationEvent message)
{
    // Пока RabbitMQ недоступен, событие остается в outbox и будет опубликовано следующей итерацией worker-а.
    db.OutboxMessages.Add(new OutboxMessage
    {
        Id = message.EventId,
        Type = message.EventType,
        Payload = System.Text.Json.JsonSerializer.Serialize(message),
        OccurredAtUtc = message.OccurredAtUtc
    });
}
