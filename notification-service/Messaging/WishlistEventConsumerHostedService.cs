using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NotificationService.Config;
using NotificationService.Data;
using NotificationService.Models;
using NotificationService.Observability;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace NotificationService.Messaging;

public class WishlistEventConsumerHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<RabbitMqOptions> rabbitMqOptions,
    ILogger<WishlistEventConsumerHostedService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly RabbitMqOptions _rabbitMqOptions = rabbitMqOptions.Value;
    private readonly ILogger<WishlistEventConsumerHostedService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Consumer переподключается к RabbitMQ, если соединение оборвалось или брокер перезапустился.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConsumeUntilDisconnectedAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Notification consumer crashed. Reconnecting soon.");
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private async Task ConsumeUntilDisconnectedAsync(CancellationToken cancellationToken)
    {
        // Очередь и exchange объявляются при старте, чтобы сервис мог подняться на чистой RabbitMQ.
        var factory = new ConnectionFactory
        {
            HostName = _rabbitMqOptions.Host,
            Port = _rabbitMqOptions.Port,
            UserName = _rabbitMqOptions.Username,
            Password = _rabbitMqOptions.Password,
            VirtualHost = _rabbitMqOptions.VirtualHost,
            DispatchConsumersAsync = true
        };

        using var connection = factory.CreateConnection();
        using var channel = connection.CreateModel();

        channel.ExchangeDeclare(
            exchange: _rabbitMqOptions.Exchange,
            type: ExchangeType.Topic,
            durable: true,
            autoDelete: false);

        channel.QueueDeclare(
            queue: _rabbitMqOptions.Queue,
            durable: true,
            exclusive: false,
            autoDelete: false);

        channel.QueueBind(_rabbitMqOptions.Queue, _rabbitMqOptions.Exchange, "wishlist.item.reserved");
        channel.QueueBind(_rabbitMqOptions.Queue, _rabbitMqOptions.Exchange, "wishlist.item.unreserved");
        // Ограничиваем количество сообщений в работе, чтобы consumer не забрал слишком большую пачку сразу.
        channel.BasicQos(prefetchSize: 0, prefetchCount: 20, global: false);

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        connection.ConnectionShutdown += (_, _) =>
        {
            completion.TrySetResult();
        };

        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.Received += async (_, ea) =>
        {
            await HandleMessageAsync(channel, ea, cancellationToken);
        };

        channel.BasicConsume(
            queue: _rabbitMqOptions.Queue,
            autoAck: false,
            consumer: consumer);

        _logger.LogInformation("RabbitMQ consumer connected. Queue: {Queue}", _rabbitMqOptions.Queue);

        using var registration = cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        await completion.Task;
    }

    private async Task HandleMessageAsync(IModel channel, BasicDeliverEventArgs ea, CancellationToken cancellationToken)
    {
        try
        {
            var payload = Encoding.UTF8.GetString(ea.Body.ToArray());
            var message = JsonSerializer.Deserialize<WishlistItemReservationEvent>(payload, JsonOptions);

            // Некорректное сообщение подтверждаем и пропускаем, иначе очередь может застрять на одном payload.
            if (message is null || message.EventId == Guid.Empty || string.IsNullOrWhiteSpace(message.EventType))
            {
                _logger.LogWarning("Skipping malformed event payload: {Payload}", payload);
                channel.BasicAck(ea.DeliveryTag, multiple: false);
                return;
            }

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

            var exists = await db.InboxMessages.AnyAsync(x => x.EventId == message.EventId, cancellationToken);
            if (!exists)
            {
                // Inbox pattern: EventId защищает от повторной обработки одного и того же события.
                db.InboxMessages.Add(new NotificationInboxMessage
                {
                    EventId = message.EventId,
                    EventType = message.EventType,
                    WishlistId = message.WishlistId,
                    ItemId = message.ItemId,
                    OwnerUserId = message.OwnerUserId,
                    ActorUserId = message.ActorUserId,
                    OccurredAtUtc = message.OccurredAtUtc,
                    ReceivedAtUtc = DateTime.UtcNow
                });

                await db.SaveChangesAsync(cancellationToken);
                ServiceMetrics.InboxEventsConsumed.Inc();
                _logger.LogInformation(
                    "Notification event stored: {EventType} | wishlist: {WishlistId} | item: {ItemId}",
                    message.EventType,
                    message.WishlistId,
                    message.ItemId);
            }

            channel.BasicAck(ea.DeliveryTag, multiple: false);
        }
        catch (Exception ex)
        {
            // При временной ошибке сообщение возвращается в очередь и будет обработано повторно.
            _logger.LogError(ex, "Failed to process notification event. Message will be requeued.");
            channel.BasicNack(ea.DeliveryTag, multiple: false, requeue: true);
        }
    }
}
