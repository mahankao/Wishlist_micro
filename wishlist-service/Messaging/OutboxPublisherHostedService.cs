using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;
using WishlistService.Config;
using WishlistService.Data;
using WishlistService.Observability;

namespace WishlistService.Messaging;

public class OutboxPublisherHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<RabbitMqOptions> rabbitMqOptions,
    IOptions<OutboxOptions> outboxOptions,
    ILogger<OutboxPublisherHostedService> logger) : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly RabbitMqOptions _rabbitMqOptions = rabbitMqOptions.Value;
    private readonly OutboxOptions _outboxOptions = outboxOptions.Value;
    private readonly ILogger<OutboxPublisherHostedService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Worker работает постоянно: периодически берет неопубликованные события из БД и отправляет их в RabbitMQ.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PublishPendingMessagesAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Outbox publisher iteration failed.");
            }

            var delay = Math.Max(200, _outboxOptions.PollIntervalMilliseconds);
            await Task.Delay(delay, stoppingToken);
        }
    }

    private async Task PublishPendingMessagesAsync(CancellationToken cancellationToken)
    {
        // Подключение создается на итерацию, чтобы worker мог восстановиться после временного падения RabbitMQ.
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

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WishlistDbContext>();
        var batchSize = Math.Max(1, _outboxOptions.BatchSize);

        // Берем старые события первыми, чтобы сохранять естественный порядок публикации.
        var pending = await db.OutboxMessages
            .Where(x => x.PublishedAtUtc == null)
            .OrderBy(x => x.OccurredAtUtc)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        foreach (var message in pending)
        {
            try
            {
                // Persistent-сообщение переживает перезапуск RabbitMQ, если оно уже принято брокером.
                var properties = channel.CreateBasicProperties();
                properties.Persistent = true;
                properties.ContentType = "application/json";
                properties.MessageId = message.Id.ToString();
                properties.Timestamp = new AmqpTimestamp(new DateTimeOffset(message.OccurredAtUtc).ToUnixTimeSeconds());

                channel.BasicPublish(
                    exchange: _rabbitMqOptions.Exchange,
                    routingKey: message.Type,
                    mandatory: false,
                    basicProperties: properties,
                    body: Encoding.UTF8.GetBytes(message.Payload));

                message.PublishedAtUtc = DateTime.UtcNow;
                message.LastError = null;
                ServiceMetrics.OutboxEventsPublished.Inc();
            }
            catch (Exception ex)
            {
                // Ошибка остается в outbox-записи, а следующая итерация попробует отправить событие еще раз.
                message.Attempts++;
                message.LastError = ex.Message;
                _logger.LogWarning(ex, "Failed to publish outbox message {MessageId} ({Type}).", message.Id, message.Type);
            }
        }

        if (pending.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }
    }
}
