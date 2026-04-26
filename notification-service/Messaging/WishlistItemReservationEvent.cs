namespace NotificationService.Messaging;

public record WishlistItemReservationEvent(
    Guid EventId,
    string EventType,
    Guid WishlistId,
    Guid ItemId,
    Guid OwnerUserId,
    Guid ActorUserId,
    DateTime OccurredAtUtc
);
