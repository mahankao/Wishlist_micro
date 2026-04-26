using Prometheus;

namespace WishlistService.Observability;

public static class ServiceMetrics
{
    public const string ServiceName = "wishlist-service";

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

    public static readonly Counter WishlistsCreated = Metrics.CreateCounter(
        "wishlist_created_total",
        "Total number of created wishlists.");

    public static readonly Counter WishlistItemsAdded = Metrics.CreateCounter(
        "wishlist_item_added_total",
        "Total number of added wishlist items.");

    public static readonly Counter WishlistItemsReserved = Metrics.CreateCounter(
        "wishlist_item_reserved_total",
        "Total number of reserved wishlist items.");

    public static readonly Counter WishlistItemsUnreserved = Metrics.CreateCounter(
        "wishlist_item_unreserved_total",
        "Total number of unreserved wishlist items.");

    public static readonly Counter OutboxEventsPublished = Metrics.CreateCounter(
        "outbox_events_published_total",
        "Total number of successfully published outbox events.");
}
