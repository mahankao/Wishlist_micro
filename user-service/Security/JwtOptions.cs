namespace UserService.Security;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "wishlist-user-service";
    public string Audience { get; set; } = "wishlist-clients";
    public string Key { get; set; } = "wishlist-super-secret-key-change-me-please";
    public int AccessTokenMinutes { get; set; } = 60;
}
