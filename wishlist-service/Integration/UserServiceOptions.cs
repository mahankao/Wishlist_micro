namespace WishlistService.Integration;

public class UserServiceOptions
{
    public const string SectionName = "UserService";

    public string BaseUrl { get; set; } = "http://user-service:8080";
    public int TimeoutSeconds { get; set; } = 2;
    public int RetryCount { get; set; } = 2;
}
