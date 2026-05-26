using Microsoft.EntityFrameworkCore;
using ChatService.Messaging;
using ChatService.Models;

namespace ChatService.Data;

public class ChatDbContext(DbContextOptions<ChatDbContext> options) : DbContext(options)
{
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<ChatOutboxMessage> OutboxMessages => Set<ChatOutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.ToTable("chat_messages");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.WishlistId, x.ItemId, x.CreatedAtUtc });

            entity.Property(x => x.WishlistId).IsRequired();
            entity.Property(x => x.ItemId).IsRequired();
            entity.Property(x => x.SenderUserId).IsRequired();
            entity.Property(x => x.Text).HasMaxLength(2000).IsRequired();
            entity.Property(x => x.CreatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<ChatOutboxMessage>(entity =>
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
            entity.Property(x => x.Attempts).HasColumnName("attempts");
            entity.Property(x => x.LastError).HasColumnName("last_error").HasMaxLength(2000);
        });
    }
}
