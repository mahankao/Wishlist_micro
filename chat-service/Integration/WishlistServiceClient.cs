using Microsoft.Extensions.Options;

namespace ChatService.Integration;

public record WishlistItemLite(Guid Id);

public record PublicWishlistLite(IReadOnlyList<WishlistItemLite> Items);

public enum RoomValidationResult
{
    Valid,
    NotFound,
    Unavailable
}

public class WishlistServiceClient(HttpClient httpClient, IOptions<WishlistServiceOptions> options)
{
    private readonly HttpClient _httpClient = httpClient;
    private readonly WishlistServiceOptions _options = options.Value;

    public async Task<RoomValidationResult> ValidateRoomAsync(Guid shareToken, Guid itemId, CancellationToken cancellationToken = default)
    {
        var retries = Math.Max(0, _options.RetryCount);
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            try
            {
                var response = await _httpClient.GetAsync($"/wishlists/public/{shareToken}", linkedCts.Token);
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return RoomValidationResult.NotFound;
                if (!response.IsSuccessStatusCode)
                {
                    // Retry on transient non-success.
                }
                else
                {
                    var payload = await response.Content.ReadFromJsonAsync<PublicWishlistLite>(cancellationToken: linkedCts.Token);
                    if (payload is null) return RoomValidationResult.Unavailable;
                    return payload.Items.Any(x => x.Id == itemId) ? RoomValidationResult.Valid : RoomValidationResult.NotFound;
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }

            if (attempt < retries)
            {
                await Task.Delay(150, cancellationToken);
            }
        }

        return RoomValidationResult.Unavailable;
    }
}
