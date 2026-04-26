namespace UserService.Contracts;

public record RegisterRequest(string Email, string Password, string DisplayName);

public record LoginRequest(string Email, string Password);

public record AuthResponse(string AccessToken, DateTime ExpiresAtUtc, UserDto User);

public record UserDto(Guid Id, string Email, string DisplayName, DateTime CreatedAtUtc);
