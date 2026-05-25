using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using WishlistService.Data;

#nullable disable

namespace WishlistService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(WishlistDbContext))]
    [Migration("20260511121000_AddWishlistItemImageUrl")]
    public partial class AddWishlistItemImageUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "wishlist_items",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "wishlist_items");
        }
    }
}
