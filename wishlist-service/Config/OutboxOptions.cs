namespace WishlistService.Config;

public class OutboxOptions
{
    public const string SectionName = "Outbox";

    public int BatchSize { get; set; } = 20;
    public int PollIntervalMilliseconds { get; set; } = 2000;
}
