namespace ChatService.Integration;

public class WishlistServiceOptions
{
    public const string SectionName = "WishlistService";

    public string BaseUrl { get; set; } = "http://wishlist-service:8080";
    public int TimeoutSeconds { get; set; } = 2;
    public int RetryCount { get; set; } = 2;
}
