# WishList Architecture

WishList — микросервисное приложение для создания wishlist, добавления items, резервирования подарков, чата и уведомлений.

## Components

- Frontend — UI для demo.
- API Gateway — Nginx, единая точка входа.
- user-service — регистрация, логин, JWT, пользователи.
- wishlist-service — wishlists, items, reservation, outbox worker.
- chat-service — REST/WebSocket чат.
- notification-service — обработка событий, inbox.
- RabbitMQ — async events.
- Prometheus — metrics.
- Grafana — dashboards.

## Gateway routing

- `/auth/*`, `/users/*` → user-service
- `/wishlists/*` → wishlist-service
- `/chat/*`, `/messages/*` → chat-service
- `/notifications/*` → notification-service

## Databases

Каждый сервис имеет свою PostgreSQL БД:

- user-service → user-db
- wishlist-service → wishlist-db
- chat-service → chat-db
- notification-service → notification-db

Сервисы НЕ ходят напрямую в чужие БД.

## Sync communication

Синхронные HTTP-вызовы:

- wishlist-service → user-service: `GET /users/{id}`
- chat-service → user-service: `GET /users/{id}`
- chat-service → wishlist-service: `GET /wishlists/{id}`

Для sync-вызовов используются:

- timeout
- retry
- correlation ID forwarding

## Async communication

RabbitMQ используется для событий.

Publisher:

- wishlist-service публикует события через Outbox Worker.
- chat-service может публиковать `NewMessage`.

Consumers:

- notification-service consume events.
- chat-service может consume `WishlistCreated`.

Events:

- `WishlistCreated`
- `ItemAdded`
- `ItemReserved`
- `ItemUnreserved`
- `NewMessage`

## Outbox pattern

Outbox используется в wishlist-service.

Flow:

1. Сохранить бизнес-изменение в wishlist-db.
2. В той же транзакции сохранить event в outbox table.
3. Background worker читает outbox.
4. Worker публикует event в RabbitMQ.
5. После успешной отправки event помечается как published.

## Inbox pattern

Inbox используется в notification-service.

Flow:

1. Notification-service получает event из RabbitMQ.
2. Проверяет `eventId`.
3. Если event уже обработан — игнорирует.
4. Если новый — сохраняет в inbox table.
5. Обрабатывает event.

## Main demo flow

1. User opens frontend.
2. User registers.
3. User logs in and receives JWT.
4. User creates wishlist.
5. User adds item.
6. User copies public share token/link.
7. Another user opens public wishlist.
8. User reserves item.
9. Wishlist-service writes outbox event.
10. Outbox worker publishes event to RabbitMQ.
11. Notification-service consumes event.
12. Notification-service stores event in inbox.
13. User can view notifications/inbox.
14. Users can send chat messages.

## Observability

Each backend service should have:

- `/health`
- Swagger/OpenAPI
- structured JSON logs
- `X-Correlation-ID`
- `/metrics`

Prometheus scrapes backend services.
Grafana shows dashboard.

## Important constraints

Do not break:

- docker compose startup
- frontend demo flow
- existing API routes
- JWT auth flow
- health endpoints
- Swagger
- database per service
- RabbitMQ event flow
- outbox/inbox logic