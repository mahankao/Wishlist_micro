namespace NotificationService.Models;

public class NotificationInboxMessage
{
    public Guid EventId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public Guid WishlistId { get; set; }
    public Guid ItemId { get; set; }
    public Guid OwnerUserId { get; set; }
    public Guid ActorUserId { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public DateTime ReceivedAtUtc { get; set; } = DateTime.UtcNow;
}
