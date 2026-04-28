# WishList Microservices

## О проекте

WishList — демонстрационное микросервисное приложение для совместной работы со списками желаний.

В проекте есть регистрация и вход пользователей, создание wishlist, добавление подарков, публичная ссылка на список, резервирование подарков другим пользователем, чат по подарку и асинхронные уведомления через RabbitMQ.

Текущий этап проекта закрывает требования лабораторной работы по готовности микросервисов к запуску и наблюдаемости:

- структурированные JSON-логи;
- передача `X-Correlation-ID` между сервисами;
- метрики Prometheus;
- готовый dashboard для Grafana;
- настройка через переменные окружения.

## Архитектура

### Сервисы

- `api-gateway` — Nginx, единая точка входа в систему.
- `user-service` — регистрация, вход, JWT и данные пользователей.
- `wishlist-service` — wishlist, items, резервирование и outbox-события.
- `chat-service` — REST и WebSocket чат по item/wishlist.
- `notification-service` — получение событий из RabbitMQ и inbox.
- `frontend` — React + Vite интерфейс для демонстрации сценария.

### Инфраструктура

- PostgreSQL — отдельная база данных для каждого backend-сервиса.
- RabbitMQ — асинхронная доставка событий.
- Prometheus — сбор метрик.
- Grafana — визуализация метрик.
- Docker Compose — запуск всего проекта одной командой.

## Как запустить

1. При необходимости создайте `.env` из примера:

```bash
cp .env.example .env
```

Этот шаг необязательный: в `docker-compose.yml` уже заданы локальные значения по умолчанию.

2. Запустите проект:

```bash
docker compose up --build
```

## Адреса

- Frontend: http://localhost:3001
- API Gateway: http://localhost:8080
- RabbitMQ UI: http://localhost:15672
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

## Health checks

- API Gateway: http://localhost:8080/health
- User Service: http://localhost:5001/health
- Wishlist Service: http://localhost:5002/health
- Chat Service: http://localhost:5003/health
- Notification Service: http://localhost:5004/health

## Swagger

- User Service: http://localhost:5001/swagger
- Wishlist Service: http://localhost:5002/swagger
- Chat Service: http://localhost:5003/swagger
- Notification Service: http://localhost:5004/swagger

## Основной демонстрационный сценарий

1. Зарегистрировать первого пользователя.
2. Войти под первым пользователем.
3. Создать wishlist.
4. Добавить item в wishlist.
5. Скопировать public share token или public link.
6. Зарегистрировать и открыть приложение под другим пользователем.
7. Открыть публичный wishlist по share token.
8. Зарезервировать item от имени второго пользователя.
9. Посмотреть список моих резервирований.
10. Отправить сообщение в чат по item.
11. Открыть notification inbox: `/notifications/inbox`.
12. Открыть Prometheus или Grafana и проверить, что метрики собираются.

## Наблюдаемость

- Все backend-сервисы отдают метрики на `/metrics`.
- HTTP-логи backend-сервисов пишутся в stdout в JSON-формате.
- `X-Correlation-ID` создается на gateway или backend-сервисе и передается дальше при межсервисных HTTP-вызовах.
- API Gateway возвращает `X-Correlation-ID` в response headers.

### Основные бизнес-метрики

- `user_registered_total`
- `wishlist_created_total`
- `wishlist_item_added_total`
- `wishlist_item_reserved_total`
- `wishlist_item_unreserved_total`
- `chat_messages_sent_total`
- `outbox_events_published_total`
- `inbox_events_consumed_total`

## Чеклист лабораторной работы

| Блок | Требование | Статус |
|---|---|---|
| Межсервисное взаимодействие | 4+ микросервиса | Готово |
| Межсервисное взаимодействие | REST API | Готово |
| Межсервисное взаимодействие | Синхронные HTTP-вызовы | Готово |
| Межсервисное взаимодействие | Асинхронная коммуникация через RabbitMQ | Готово |
| Межсервисное взаимодействие | API Gateway | Готово |
| Данные и согласованность | Отдельная БД на сервис | Готово |
| Данные и согласованность | Миграции/инициализация схемы | Готово: EF Core migrations |
| Данные и согласованность | Eventual consistency | Готово |
| Данные и согласованность | Outbox pattern | Готово |
| Данные и согласованность | Inbox pattern | Готово |
| Надежность и наблюдаемость | JSON structured logs | Готово |
| Надежность и наблюдаемость | Health endpoints | Готово |
| Надежность и наблюдаемость | Graceful shutdown | Готово: hosted services в контейнерах |
| Надежность и наблюдаемость | Correlation ID | Готово |
| Надежность и наблюдаемость | Retry/timeout | Готово |
| Надежность и наблюдаемость | Prometheus metrics | Готово |
| Надежность и наблюдаемость | Grafana dashboard | Готово |
| Безопасность и production-настройки | Переменные окружения | Готово |
| Безопасность и production-настройки | Docker Compose | Готово |
| Безопасность и production-настройки | `.env` не хранится в Git | Готово |
| Безопасность и production-настройки | `.env.example` | Готово |
| Безопасность и production-настройки | Swagger/OpenAPI | Готово |
| Безопасность и production-настройки | JWT authentication | Готово |

## Что делать при проблемах

### Порты уже заняты

Проверьте порты `3000`, `3001`, `8080`, `5001-5004`, `9090`, `15672`.
Остановите конфликтующие процессы или поменяйте host port mapping в `docker-compose.yml`.

### В Docker volumes осталась старая схема БД

Пересоздайте volumes:

```bash
docker compose down -v
docker compose up --build
```

### RabbitMQ еще не готов

Подождите, пока контейнер `rabbitmq` полностью поднимется. Backend consumer-сервисы переподключаются автоматически.
Проверить RabbitMQ можно здесь: http://localhost:15672.

### Frontend не видит API Gateway

Проверьте:

- frontend открыт на `http://localhost:3001`;
- gateway отвечает на `http://localhost:8080/health`;
- после изменения конфигурации gateway обновлен кэш браузера.

## Переменные окружения

Поддерживаемые переменные описаны в `.env.example`:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `ASPNETCORE_ENVIRONMENT`
- `VITE_API_BASE_URL`
