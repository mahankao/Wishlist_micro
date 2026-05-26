using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Prometheus;
using UserService.Contracts;
using UserService.Data;
using UserService.Models;
using UserService.Observability;
using UserService.Security;

var builder = WebApplication.CreateBuilder(args);

// Все сервисы пишут логи в JSON, чтобы их удобно читать в Docker и связывать с correlationId.
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
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "UserService", Version = "v1" });
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

// JWT-настройки используются при выпуске токена и проверке защищенных endpoints.
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

// У каждого микросервиса своя БД; user-service работает только с user-db.
builder.Services.AddDbContext<UserDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddSingleton<PasswordHasher<User>>();
builder.Services.AddSingleton<JwtTokenService>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Correlation ID позволяет проследить один запрос через gateway и backend-сервисы.
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseHttpMetrics();
app.UseAuthentication();
app.UseAuthorization();

await MigrateDatabaseAsync(app.Services);

// Health endpoints используются Docker Compose и ручной проверкой готовности сервиса.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "user-service" }));
app.MapGet("/users/health", () => Results.Ok(new { status = "ok", service = "user-service" }));
app.MapMetrics("/metrics");

app.MapPost("/auth/register", async (RegisterRequest request, UserDbContext db, PasswordHasher<User> passwordHasher) =>
{
    // Нормализуем email перед проверкой уникальности, чтобы разные регистры не создавали дубликаты.
    var email = request.Email.Trim().ToLowerInvariant();
    var displayName = request.DisplayName.Trim();
    if (!IsValidEmail(email) || request.Password.Length < 8 || displayName.Length is < 2 or > 128)
    {
        return Results.BadRequest(new { error = "Invalid registration payload." });
    }

    if (await db.Users.AnyAsync(x => x.Email == email))
    {
        return Results.Conflict(new { error = "User with this email already exists." });
    }

    var user = new User
    {
        Email = email,
        DisplayName = displayName
    };
    user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

    db.Users.Add(user);
    await db.SaveChangesAsync();
    ServiceMetrics.UsersRegistered.Inc();

    return Results.Created($"/users/{user.Id}", ToDto(user));
})
.WithTags("Auth");

app.MapPost("/auth/login", async (LoginRequest request, UserDbContext db, PasswordHasher<User> passwordHasher, JwtTokenService tokenService) =>
{
    // При успешном входе frontend получает JWT и дальше отправляет его в Authorization header.
    var email = request.Email.Trim().ToLowerInvariant();
    var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var verifyResult = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
    if (verifyResult == PasswordVerificationResult.Failed)
    {
        return Results.Unauthorized();
    }

    var (token, expiresAtUtc) = tokenService.Create(user);
    return Results.Ok(new AuthResponse(token, expiresAtUtc, ToDto(user)));
})
.WithTags("Auth");

app.MapGet("/auth/validate", () => Results.NoContent())
.RequireAuthorization()
.WithTags("Auth");

app.MapGet("/users/me", async (ClaimsPrincipal principal, UserDbContext db) =>
{
    var userIdRaw = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? principal.FindFirstValue("sub");
    if (!Guid.TryParse(userIdRaw, out var userId))
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId);
    return user is null ? Results.NotFound() : Results.Ok(ToDto(user));
})
.RequireAuthorization()
.WithTags("Users");

app.MapGet("/users/{id:guid}", async (Guid id, UserDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
    return user is null ? Results.NotFound() : Results.Ok(ToDto(user));
})
.WithTags("Users");

app.Run();

static UserDto ToDto(User user) => new(user.Id, user.Email, user.DisplayName, user.CreatedAtUtc);

static bool IsValidEmail(string email)
{
    if (string.IsNullOrWhiteSpace(email) || email.Length > 256) return false;
    return email.Contains('@') && email.Contains('.');
}

static async Task MigrateDatabaseAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<UserDbContext>();

    const int maxAttempts = 10;
    // В Docker база может стартовать дольше сервиса, поэтому миграции выполняются с повторами.
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
