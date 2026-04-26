using System.Diagnostics;

namespace UserService.Observability;

public class RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
{
    private readonly RequestDelegate _next = next;
    private readonly ILogger<RequestLoggingMiddleware> _logger = logger;

    public async Task Invoke(HttpContext context)
    {
        var startedAt = DateTime.UtcNow;
        var stopwatch = Stopwatch.StartNew();
        var method = context.Request.Method;
        var path = context.Request.Path.HasValue ? context.Request.Path.Value! : "/";
        var correlationId = context.Items[CorrelationIdMiddleware.ItemKey]?.ToString()
                            ?? context.Request.Headers[CorrelationIdMiddleware.HeaderName].FirstOrDefault()
                            ?? Guid.NewGuid().ToString("D");

        using var scope = _logger.BeginScope(new Dictionary<string, object>
        {
            ["service"] = ServiceMetrics.ServiceName,
            ["correlationId"] = correlationId
        });

        try
        {
            await _next(context);
            stopwatch.Stop();
            WriteRequestMetrics(method, path, context.Response.StatusCode, stopwatch.Elapsed.TotalSeconds);
            _logger.LogInformation("{@event}", CreateLogEntry(startedAt, "Information", correlationId, method, path, context.Response.StatusCode, stopwatch.ElapsedMilliseconds, "HTTP request completed"));
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            var statusCode = context.Response.StatusCode is >= 400 ? context.Response.StatusCode : StatusCodes.Status500InternalServerError;
            WriteRequestMetrics(method, path, statusCode, stopwatch.Elapsed.TotalSeconds);

            _logger.LogError(ex, "{@event}", CreateLogEntry(
                startedAt,
                "Error",
                correlationId,
                method,
                path,
                statusCode,
                stopwatch.ElapsedMilliseconds,
                "HTTP request failed",
                ex.ToString()));

            throw;
        }
    }

    private static void WriteRequestMetrics(string method, string path, int statusCode, double elapsedSeconds)
    {
        var labels = new[] { ServiceMetrics.ServiceName, method, path, statusCode.ToString() };
        ServiceMetrics.HttpRequests.WithLabels(labels).Inc();
        ServiceMetrics.HttpRequestDuration.WithLabels(labels).Observe(elapsedSeconds);
        if (statusCode >= 400)
        {
            ServiceMetrics.HttpErrors.WithLabels(labels).Inc();
        }
    }

    private static object CreateLogEntry(
        DateTime startedAtUtc,
        string level,
        string correlationId,
        string method,
        string path,
        int statusCode,
        long elapsedMs,
        string message,
        string? exception = null) =>
        new
        {
            timestamp = startedAtUtc,
            level,
            service = ServiceMetrics.ServiceName,
            correlationId,
            message,
            method,
            path,
            statusCode,
            elapsedMs,
            exception
        };
}
