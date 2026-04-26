namespace WishlistService.Config;

public class WishlistOptions
{
    public const string SectionName = "Wishlist";

    public int MaxItemsPerWishlist { get; set; } = 100;
}
