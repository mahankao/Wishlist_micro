using Microsoft.Extensions.Options;

namespace ChatService.Integration;

public record UserProfile(Guid Id, string Email, string DisplayName, DateTime CreatedAtUtc);

public enum UserLookupResult
{
    Exists,
    NotFound,
    Unavailable
}

public class UserServiceClient(HttpClient httpClient, IOptions<UserServiceOptions> options)
{
    private readonly HttpClient _httpClient = httpClient;
    private readonly UserServiceOptions _options = options.Value;

    public async Task<UserLookupResult> UserExistsAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var retries = Math.Max(0, _options.RetryCount);
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            try
            {
                var response = await _httpClient.GetAsync($"/users/{userId}", linkedCts.Token);
                if (response.IsSuccessStatusCode) return UserLookupResult.Exists;
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return UserLookupResult.NotFound;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }

            if (attempt < retries)
            {
                await Task.Delay(150, cancellationToken);
            }
        }

        return UserLookupResult.Unavailable;
    }

    public async Task<UserProfile?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var retries = Math.Max(0, _options.RetryCount);
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, _options.TimeoutSeconds)));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            try
            {
                var response = await _httpClient.GetAsync($"/users/{userId}", linkedCts.Token);
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
                if (response.IsSuccessStatusCode)
                {
                    return await response.Content.ReadFromJsonAsync<UserProfile>(cancellationToken: linkedCts.Token);
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }

            if (attempt < retries)
            {
                await Task.Delay(150, cancellationToken);
            }
        }

        return null;
    }
}
