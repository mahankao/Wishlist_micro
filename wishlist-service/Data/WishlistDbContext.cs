using Microsoft.EntityFrameworkCore;
using WishlistService.Messaging;
using WishlistService.Models;

namespace WishlistService.Data;

public class WishlistDbContext(DbContextOptions<WishlistDbContext> options) : DbContext(options)
{
    public DbSet<Wishlist> Wishlists => Set<Wishlist>();
    public DbSet<WishlistItem> WishlistItems => Set<WishlistItem>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Wishlist>(entity =>
        {
            entity.ToTable("wishlists");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.ShareToken).IsUnique();

            entity.Property(x => x.OwnerUserId).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.CreatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<WishlistItem>(entity =>
        {
            entity.ToTable("wishlist_items");
            entity.HasKey(x => x.Id);

            entity.Property(x => x.Title).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Url).HasMaxLength(1000);
            entity.Property(x => x.Price).HasColumnType("numeric(12,2)");
            entity.Property(x => x.Comment).HasMaxLength(1000);
            entity.Property(x => x.ReservedByUserId).HasColumnName("reserved_by_user_id");
            entity.Property(x => x.ReservedAtUtc).HasColumnName("reserved_at_utc");
            entity.Property(x => x.CreatedAtUtc).IsRequired();

            entity.HasOne(x => x.Wishlist)
                .WithMany(x => x.Items)
                .HasForeignKey(x => x.WishlistId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<OutboxMessage>(entity =>
        {
            entity.ToTable("outbox_messages");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.PublishedAtUtc);
            entity.HasIndex(x => x.OccurredAtUtc);

            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.Type).HasColumnName("type").HasMaxLength(200).IsRequired();
            entity.Property(x => x.Payload).HasColumnName("payload").IsRequired();
            entity.Property(x => x.OccurredAtUtc).HasColumnName("occurred_at_utc").IsRequired();
            entity.Property(x => x.PublishedAtUtc).HasColumnName("published_at_utc");
            entity.Property(x => x.Attempts).HasColumnName("attempts").IsRequired();
            entity.Property(x => x.LastError).HasColumnName("last_error").HasMaxLength(2000);
        });
    }
}
