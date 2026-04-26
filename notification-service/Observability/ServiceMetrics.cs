using Prometheus;

namespace NotificationService.Observability;

public static class ServiceMetrics
{
    public const string ServiceName = "notification-service";

    public static readonly Counter HttpRequests = Metrics.CreateCounter(
        "http_requests_total",
        "Total number of HTTP requests.",
        new CounterConfiguration
        {
            LabelNames = ["service", "method", "path", "status_code"]
        });

    public static readonly Histogram HttpRequestDuration = Metrics.CreateHistogram(
        "http_request_duration_seconds",
        "Duration of HTTP requests in seconds.",
        new HistogramConfiguration
        {
            LabelNames = ["service", "method", "path", "status_code"]
        });

    public static readonly Counter HttpErrors = Metrics.CreateCounter(
        "http_errors_total",
        "Total number of HTTP requests with status >= 400.",
        new CounterConfiguration
        {
            LabelNames = ["service", "method", "path", "status_code"]
        });

    public static readonly Counter InboxEventsConsumed = Metrics.CreateCounter(
        "inbox_events_consumed_total",
        "Total number of consumed inbox events.");
}
