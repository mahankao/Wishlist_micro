using System.Text;
using System.Text.Json;
using ChatService.Config;
using ChatService.Observability;
using ChatService.Realtime;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace ChatService.Messaging;

public class WishlistCreatedConsumerHostedService(
    IOptions<RabbitMqOptions> rabbitMqOptions,
    ILogger<WishlistCreatedConsumerHostedService> logger,
    ChatConnectionManager connectionManager) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WebSocketJsonOptions = new(JsonSerializerDefaults.Web);
    private const string WishlistCreatedRoutingKey = "wishlist.created";
    private const string ItemReservedRoutingKey = "wishlist.item.reserved";
    private const string ItemUnreservedRoutingKey = "wishlist.item.unreserved";

    private readonly RabbitMqOptions _rabbitMqOptions = rabbitMqOptions.Value;
    private readonly ILogger<WishlistCreatedConsumerHostedService> _logger = logger;
    private readonly ChatConnectionManager _connectionManager = connectionManager;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
                _logger.LogError(ex, "Chat wishlist-created consumer crashed. Reconnecting soon.");
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private async Task ConsumeUntilDisconnectedAsync(CancellationToken cancellationToken)
    {
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

        channel.QueueBind(_rabbitMqOptions.Queue, _rabbitMqOptions.Exchange, WishlistCreatedRoutingKey);
        channel.QueueBind(_rabbitMqOptions.Queue, _rabbitMqOptions.Exchange, ItemReservedRoutingKey);
        channel.QueueBind(_rabbitMqOptions.Queue, _rabbitMqOptions.Exchange, ItemUnreservedRoutingKey);
        channel.BasicQos(prefetchSize: 0, prefetchCount: 20, global: false);

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.ConnectionShutdown += (_, _) => completion.TrySetResult();

        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.Received += async (_, ea) =>
        {
            await HandleMessageAsync(channel, ea, cancellationToken);
        };

        channel.BasicConsume(
            queue: _rabbitMqOptions.Queue,
            autoAck: false,
            consumer: consumer);

        _logger.LogInformation("RabbitMQ wishlist-created consumer connected. Queue: {Queue}", _rabbitMqOptions.Queue);

        using var registration = cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        await completion.Task;
    }

    private async Task HandleMessageAsync(IModel channel, BasicDeliverEventArgs ea, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();

            var payload = Encoding.UTF8.GetString(ea.Body.ToArray());
            if (ea.RoutingKey == WishlistCreatedRoutingKey)
            {
                HandleWishlistCreated(payload);
            }
            else if (ea.RoutingKey is ItemReservedRoutingKey or ItemUnreservedRoutingKey)
            {
                await HandleReservationChangedAsync(payload, cancellationToken);
            }
            else
            {
                _logger.LogWarning("Skipping unsupported wishlist event routing key: {RoutingKey}", ea.RoutingKey);
                channel.BasicAck(ea.DeliveryTag, multiple: false);
                return;
            }

            channel.BasicAck(ea.DeliveryTag, multiple: false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process wishlist-created event. Message will be requeued.");
            channel.BasicNack(ea.DeliveryTag, multiple: false, requeue: true);
        }
    }

    private void HandleWishlistCreated(string payload)
    {
        var message = JsonSerializer.Deserialize<WishlistCreatedEvent>(payload, JsonOptions);

        if (message is null ||
            message.EventId == Guid.Empty ||
            message.EventType != WishlistCreatedRoutingKey ||
            message.WishlistId == Guid.Empty ||
            message.OwnerUserId == Guid.Empty)
        {
            _logger.LogWarning("Skipping malformed wishlist-created payload: {Payload}", payload);
            return;
        }

        ServiceMetrics.WishlistCreatedEventsConsumed.Inc();
        _logger.LogInformation(
            "WishlistCreated event consumed: wishlist {WishlistId}, owner {OwnerUserId}",
            message.WishlistId,
            message.OwnerUserId);
    }

    private async Task HandleReservationChangedAsync(string payload, CancellationToken cancellationToken)
    {
        var message = JsonSerializer.Deserialize<WishlistItemReservationEvent>(payload, JsonOptions);

        if (message is null ||
            message.EventId == Guid.Empty ||
            message.WishlistId == Guid.Empty ||
            message.ItemId == Guid.Empty ||
            message.EventType is not (ItemReservedRoutingKey or ItemUnreservedRoutingKey))
        {
            _logger.LogWarning("Skipping malformed wishlist reservation payload: {Payload}", payload);
            return;
        }

        var broadcastPayload = JsonSerializer.Serialize(new
        {
            Type = "wishlist.item.reservation.changed",
            message.EventType,
            message.WishlistId,
            message.ItemId,
            message.ActorUserId,
            IsReserved = message.EventType == ItemReservedRoutingKey,
            message.OccurredAtUtc
        }, WebSocketJsonOptions);

        await _connectionManager.BroadcastAsync(GetWishlistRoomKey(message.WishlistId), broadcastPayload, cancellationToken);
    }

    public static string GetWishlistRoomKey(Guid wishlistId) => $"wishlist:{wishlistId:N}:reservations";
}
