using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using WishlistService.Data;

#nullable disable

namespace WishlistService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(WishlistDbContext))]
    [Migration("20260601194000_AddWishlistExpiresAt")]
    public partial class AddWishlistExpiresAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "expires_at_utc",
                table: "wishlists",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("UPDATE wishlists SET expires_at_utc = \"CreatedAtUtc\" + interval '30 days' WHERE expires_at_utc IS NULL");

            migrationBuilder.AlterColumn<DateTime>(
                name: "expires_at_utc",
                table: "wishlists",
                type: "timestamp with time zone",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "expires_at_utc",
                table: "wishlists");
        }
    }
}
