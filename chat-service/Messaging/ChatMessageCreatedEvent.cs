namespace ChatService.Messaging;

public record ChatMessageCreatedEvent(
    Guid EventId,
    string EventType,
    Guid MessageId,
    Guid WishlistId,
    Guid ItemId,
    Guid SenderUserId,
    Guid OwnerUserId,
    string Text,
    DateTime OccurredAtUtc
);
