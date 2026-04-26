using Microsoft.EntityFrameworkCore;
using ChatService.Models;

namespace ChatService.Data;

public class ChatDbContext(DbContextOptions<ChatDbContext> options) : DbContext(options)
{
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

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
    }
}
