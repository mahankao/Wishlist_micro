# Current Status

## Implemented

### user-service

- Registration: `POST /auth/register`
- Login: `POST /auth/login`
- JWT authentication
- Current user: `GET /users/me`
- Get user by id: `GET /users/{id}`
- Swagger
- Health endpoints

### wishlist-service

- Create wishlist
- Add item to wishlist
- Public access by share token
- Reserve item
- Unreserve item
- Get my reservations
- Owner checks
- Authorization checks
- HTTP client integration with user-service
- Timeout/retry
- Outbox pattern for events

### chat-service

- REST message history
- Send messages
- WebSocket chat by item/wishlist

### notification-service

- RabbitMQ consumer
- Inbox pattern
- Idempotency by eventId
- Endpoint: `/notifications/inbox`

### infrastructure

- API Gateway: Nginx
- PostgreSQL per service
- RabbitMQ
- Prometheus
- Grafana
- Docker Compose
- Frontend demo UI

## Current priority

Do not add large new business features.

Focus on:

1. README and defense script
2. Structured JSON logging
3. Correlation ID propagation
4. Prometheus metrics
5. Grafana dashboard
6. `.env.example` and config cleanup
7. Final testing

## Recommended task order

1. README/docs
2. logging + correlation ID
3. metrics
4. Grafana provisioning
5. env cleanup
6. final README sync
# Current Project Status

Checked on: 2026-04-26

Note: the IDE request mentioned `docs/currentSatus.md`, but the file in the repository is `docs/currentStatus.md`.

## Summary

The project is a Docker Compose based wishlist microservices demo. The codebase currently contains:

- API Gateway based on Nginx.
- Four backend microservices on ASP.NET Core 8:
  - `user-service`
  - `wishlist-service`
  - `chat-service`
  - `notification-service`
- React + Vite frontend served through Nginx.
- PostgreSQL database per backend service.
- RabbitMQ for asynchronous wishlist reservation events.
- Prometheus and Grafana infrastructure.

## Implemented

### Infrastructure

- `docker-compose.yml` defines frontend, API Gateway, four backend services, four PostgreSQL databases, RabbitMQ, Prometheus, and Grafana.
- Each backend service has its own `Dockerfile`.
- API Gateway routes:
  - `/auth/` and `/users/` to `user-service`
  - `/wishlists` and `/wishlists/` to `wishlist-service`
  - `/chat/` and `/messages/` to `chat-service`
  - `/notifications/` to `notification-service`
- API Gateway supports CORS, WebSocket upgrade for chat, JSON access logs, and `X-Correlation-ID`.
- `.env` is ignored by Git and `.env.example` is present.

### User Service

- JWT authentication is implemented.
- Endpoints:
  - `POST /auth/register`
  - `POST /auth/login`
  - `GET /users/me`
  - `GET /users/{id}`
  - `GET /health`
  - `GET /users/health`
  - `GET /metrics`
- Uses PostgreSQL through EF Core.
- Uses `EnsureCreatedAsync` for schema bootstrap.
- Exposes Swagger.
- Exposes Prometheus metrics.

### Wishlist Service

- JWT protected wishlist and reservation flow is implemented.
- Endpoints:
  - `POST /wishlists`
  - `POST /wishlists/{wishlistId}/items`
  - `GET /wishlists/reservations/me`
  - `POST /wishlists/{wishlistId}/items/{itemId}/reserve`
  - `POST /wishlists/{wishlistId}/items/{itemId}/unreserve`
  - `GET /wishlists/{wishlistId}`
  - `GET /wishlists/public/{shareToken}`
  - `GET /health`
  - `GET /wishlists/health`
  - `GET /metrics`
- Uses PostgreSQL through EF Core.
- Uses `EnsureCreatedAsync` plus manual schema bootstrap for reservation columns.
- Uses synchronous HTTP integration with `user-service`.
- Implements outbox table and hosted publisher.
- Publishes reservation events to RabbitMQ exchange `wishlist.events`.
- Exposes Swagger.
- Exposes Prometheus metrics.

### Chat Service

- Chat by wishlist item is implemented.
- Endpoints:
  - `GET /chat/messages`
  - `POST /chat/messages`
  - `GET /chat/ws`
  - `GET /health`
  - `GET /chat/health`
  - `GET /metrics`
- Supports REST chat messages and WebSocket chat.
- Uses JWT auth, including token from query string for `/chat/ws`.
- Uses PostgreSQL through EF Core.
- Uses synchronous HTTP integration with `user-service` and `wishlist-service`.
- Exposes Swagger.
- Exposes Prometheus metrics.

### Notification Service

- RabbitMQ consumer for wishlist reservation events is implemented.
- Endpoints:
  - `GET /notifications/inbox`
  - `GET /health`
  - `GET /notifications/health`
  - `GET /metrics`
- Uses PostgreSQL through EF Core.
- Uses inbox table and idempotency check by `EventId`.
- Uses `EnsureCreatedAsync` plus manual inbox schema bootstrap.
- Exposes Swagger.
- Exposes Prometheus metrics.

### Frontend

- React + Vite frontend exists.
- The UI covers:
  - register
  - login
  - create wishlist
  - load wishlist
  - load public wishlist
  - reserve and unreserve item
  - view my reservations
  - load and send chat messages
  - connect/disconnect WebSocket chat
  - load notification inbox

### Observability

- Backend services expose `/metrics`.
- Prometheus scrapes:
  - `user-service:8080`
  - `wishlist-service:8080`
  - `chat-service:8080`
  - `notification-service:8080`
- Grafana provisioning and dashboard files are present.
- Services include request logging middleware, correlation ID middleware, and service-specific counters.

## Gaps / Things To Be Careful About

- `docs/currentStatus.md`, `docs/architecture.md`, and `docs/codex.md` were empty before this update.
- `docs/overview.md` and `docs/events.md` are open in the IDE but do not exist on disk.
- The project uses `EnsureCreatedAsync` and manual schema bootstrap, not EF Core migrations.
- `notification-service` exposes `/notifications/inbox` without JWT authorization.
- Runtime behavior was checked by reading source files, not by running the full Docker Compose stack.
- Automated tests are not present in the repository.

## Suggested Next Steps

- Fill `docs/architecture.md` with the actual service diagram and API Gateway routes.
- Create `docs/events.md` describing `wishlist.item.reserved` and `wishlist.item.unreserved`.
- Add a solution file and basic build/test commands to simplify verification.
- Add integration smoke tests for auth, wishlist reservation, RabbitMQ event delivery, and notification inbox.
