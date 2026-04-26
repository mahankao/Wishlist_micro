using Microsoft.EntityFrameworkCore;
using NotificationService.Models;

namespace NotificationService.Data;

public class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : DbContext(options)
{
    public DbSet<NotificationInboxMessage> InboxMessages => Set<NotificationInboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<NotificationInboxMessage>(entity =>
        {
            entity.ToTable("notification_inbox_messages");
            entity.HasKey(x => x.EventId);
            entity.HasIndex(x => x.ReceivedAtUtc);

            entity.Property(x => x.EventId).HasColumnName("event_id");
            entity.Property(x => x.EventType).HasColumnName("event_type").HasMaxLength(200).IsRequired();
            entity.Property(x => x.WishlistId).HasColumnName("wishlist_id").IsRequired();
            entity.Property(x => x.ItemId).HasColumnName("item_id").IsRequired();
            entity.Property(x => x.OwnerUserId).HasColumnName("owner_user_id").IsRequired();
            entity.Property(x => x.ActorUserId).HasColumnName("actor_user_id").IsRequired();
            entity.Property(x => x.OccurredAtUtc).HasColumnName("occurred_at_utc").IsRequired();
            entity.Property(x => x.ReceivedAtUtc).HasColumnName("received_at_utc").IsRequired();
        });
    }
}
