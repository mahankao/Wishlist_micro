namespace ChatService.Observability;

public class CorrelationHeaderHandler(IHttpContextAccessor httpContextAccessor) : DelegatingHandler
{
    private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (!request.Headers.Contains(CorrelationIdMiddleware.HeaderName))
        {
            var correlationId = _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemKey]?.ToString()
                                ?? _httpContextAccessor.HttpContext?.Request.Headers[CorrelationIdMiddleware.HeaderName].FirstOrDefault()
                                ?? Guid.NewGuid().ToString("D");
            request.Headers.TryAddWithoutValidation(CorrelationIdMiddleware.HeaderName, correlationId);
        }

        return base.SendAsync(request, cancellationToken);
    }
}
