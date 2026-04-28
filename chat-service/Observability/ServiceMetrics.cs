using Prometheus;

namespace ChatService.Observability;

public static class ServiceMetrics
{
    public const string ServiceName = "chat-service";

    // Общие HTTP-метрики одинаковые во всех backend-сервисах, чтобы Grafana могла строить единые графики.
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

    // Бизнес-метрика считает отправленные сообщения REST и WebSocket-чата.
    public static readonly Counter ChatMessagesSent = Metrics.CreateCounter(
        "chat_messages_sent_total",
        "Total number of chat messages sent.");
}
