namespace ChatService.Contracts;

public record PostChatMessageRequest(Guid WishlistId, Guid ItemId, Guid ShareToken, string Text);

public record ChatMessageResponse(Guid Id, string Author, string Text, DateTime CreatedAtUtc, bool IsMine);

public record WsIncomingMessage(string Text);
