using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace ChatService.Integration;

public record WishlistItemLite(Guid Id, Guid? ReservedByUserId);

public record PublicWishlistLite(Guid Id, Guid OwnerUserId, IReadOnlyList<WishlistItemLite> Items);

public enum RoomValidationResult
{
    Valid,
    NotFound,
    Unavailable
}

public record RoomValidation(RoomValidationResult Result, Guid? WishlistId = null, Guid? OwnerUserId = null, Guid? ReservedByUserId = null);

public class WishlistServiceClient(HttpClient httpClient, IOptions<WishlistServiceOptions> options)
{
    private readonly HttpClient _httpClient = httpClient;
    private readonly WishlistServiceOptions _options = options.Value;

    public async Task<RoomValidation> ValidateRoomAsync(Guid shareToken, Guid itemId, CancellationToken cancellationToken = default)
    {
        var retries = Math.Max(0, _options.RetryCount);
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            try
            {
                var response = await _httpClient.GetAsync($"/wishlists/public/{shareToken}", linkedCts.Token);
                if (response.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Gone) return new RoomValidation(RoomValidationResult.NotFound);
                if (!response.IsSuccessStatusCode)
                {
                    // Retry on transient non-success.
                }
                else
                {
                    var payload = await response.Content.ReadFromJsonAsync<PublicWishlistLite>(cancellationToken: linkedCts.Token);
                    if (payload is null) return new RoomValidation(RoomValidationResult.Unavailable);
                    var item = payload.Items.FirstOrDefault(x => x.Id == itemId);
                    return item is not null
                        ? new RoomValidation(RoomValidationResult.Valid, payload.Id, payload.OwnerUserId, item.ReservedByUserId)
                        : new RoomValidation(RoomValidationResult.NotFound);
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }

            if (attempt < retries)
            {
                await Task.Delay(150, cancellationToken);
            }
        }

        return new RoomValidation(RoomValidationResult.Unavailable);
    }

    public async Task<RoomValidation> ValidateWishlistAsync(Guid shareToken, CancellationToken cancellationToken = default)
    {
        var retries = Math.Max(0, _options.RetryCount);
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            try
            {
                var response = await _httpClient.GetAsync($"/wishlists/public/{shareToken}", linkedCts.Token);
                if (response.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Gone) return new RoomValidation(RoomValidationResult.NotFound);
                if (response.IsSuccessStatusCode)
                {
                    var payload = await response.Content.ReadFromJsonAsync<PublicWishlistLite>(cancellationToken: linkedCts.Token);
                    if (payload is null) return new RoomValidation(RoomValidationResult.Unavailable);
                    return new RoomValidation(RoomValidationResult.Valid, payload.Id, payload.OwnerUserId);
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }

            if (attempt < retries)
            {
                await Task.Delay(150, cancellationToken);
            }
        }

        return new RoomValidation(RoomValidationResult.Unavailable);
    }
}
