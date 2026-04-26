namespace WishlistService.Models;

public class WishlistItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WishlistId { get; set; }
    public Wishlist Wishlist { get; set; } = null!;
    public string Title { get; set; } = string.Empty;
    public string? Url { get; set; }
    public decimal? Price { get; set; }
    public string? Comment { get; set; }
    public Guid? ReservedByUserId { get; set; }
    public DateTime? ReservedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
