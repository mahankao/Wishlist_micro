namespace WishlistService.Messaging;

public record WishlistCreatedEvent(
    Guid EventId,
    string EventType,
    Guid WishlistId,
    Guid OwnerUserId,
    string Title,
    DateTime OccurredAtUtc
);
