namespace WishlistService.Contracts;

public record CreateWishlistRequest(string Title, string? Description);

public record UpdateWishlistRequest(string Title, string? Description);

public record AddWishlistItemRequest(string Title, string? Url, string? ImageUrl, decimal? Price, string? Comment);

public record UpdateWishlistItemRequest(string Title, string? Url, string? ImageUrl, decimal? Price, string? Comment);

public record WishlistItemResponse(
    Guid Id,
    string Title,
    string? Url,
    string? ImageUrl,
    decimal? Price,
    string? Comment,
    bool IsReserved,
    DateTime? ReservedAtUtc,
    DateTime CreatedAtUtc
);

public record WishlistResponse(
    Guid Id,
    Guid OwnerUserId,
    string Title,
    string? Description,
    Guid ShareToken,
    DateTime CreatedAtUtc,
    IReadOnlyList<WishlistItemResponse> Items
);

public record PublicWishlistResponse(
    Guid Id,
    Guid OwnerUserId,
    string Title,
    string? Description,
    IReadOnlyList<WishlistItemResponse> Items
);

public record MyReservedItemResponse(
    Guid WishlistId,
    Guid ShareToken,
    string WishlistTitle,
    Guid ItemId,
    string ItemTitle,
    DateTime ReservedAtUtc
);
