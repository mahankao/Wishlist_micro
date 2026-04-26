# WishList Microservices

## Project Overview
WishList is a demo microservices system for collaborative wishlist management.  
It includes user authentication, wishlist and item management, item reservation, chat by wishlist item, and async notification event delivery.

This stage focuses on Lab 2 production readiness:
- structured JSON logs
- correlation ID propagation
- Prometheus metrics
- Grafana dashboard provisioning
- environment variables cleanup

## Architecture
### Services
- API Gateway (`api-gateway`, Nginx)
- User Service (`user-service`)
- Wishlist Service (`wishlist-service`)
- Chat Service (`chat-service`)
- Notification Service (`notification-service`)
- Frontend (`frontend`, React + Vite + Nginx)

### Infrastructure
- PostgreSQL per service
- RabbitMQ
- Prometheus
- Grafana
- Docker Compose

## How to Run
1. Create `.env` from `.env.example` (optional for local defaults):
```bash
cp .env.example .env
```

2. Run:
```bash
docker compose up --build
```

### URLs
- Frontend: http://localhost:3001
- API Gateway: http://localhost:8080
- RabbitMQ UI: http://localhost:15672
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

### Health checks
- http://localhost:8080/health
- http://localhost:5001/health
- http://localhost:5002/health
- http://localhost:5003/health
- http://localhost:5004/health

### Swagger
- http://localhost:5001/swagger
- http://localhost:5002/swagger
- http://localhost:5003/swagger
- http://localhost:5004/swagger

## Demo Flow
1. Register user
2. Login
3. Create wishlist
4. Add item
5. Copy public share token/link
6. Open public wishlist
7. Reserve item (from another user account)
8. View my reservations
9. Send chat message
10. Check notification inbox (`/notifications/inbox`)
11. Open Prometheus/Grafana and verify metrics

## Observability Notes
- All backend services expose `/metrics`.
- Backend HTTP logs are written as JSON to stdout.
- `X-Correlation-ID` is supported and propagated between services.
- API Gateway forwards `X-Correlation-ID` to upstreams and returns it in response headers.

### Core business metrics
- `user_registered_total`
- `wishlist_created_total`
- `wishlist_item_added_total`
- `wishlist_item_reserved_total`
- `wishlist_item_unreserved_total`
- `chat_messages_sent_total`
- `outbox_events_published_total`
- `inbox_events_consumed_total`

## Lab 2 Checklist
| Block | Item | Status |
|---|---|---|
| Block 1: Interservice Communication | 4+ microservices | Done |
| Block 1: Interservice Communication | REST APIs | Done |
| Block 1: Interservice Communication | sync HTTP calls | Done |
| Block 1: Interservice Communication | RabbitMQ async communication | Done |
| Block 1: Interservice Communication | API Gateway | Done |
| Block 2: Data and Consistency | database per service | Done |
| Block 2: Data and Consistency | migrations/bootstrapping | Done (EnsureCreated + schema bootstrap) |
| Block 2: Data and Consistency | eventual consistency | Done |
| Block 2: Data and Consistency | outbox pattern | Done |
| Block 2: Data and Consistency | inbox pattern | Done |
| Block 3: Resilience and Observability | JSON structured logs | Done |
| Block 3: Resilience and Observability | health endpoints | Done |
| Block 3: Resilience and Observability | graceful shutdown | Done (containerized hosted services) |
| Block 3: Resilience and Observability | correlation ID | Done |
| Block 3: Resilience and Observability | retry/timeout | Done |
| Block 3: Resilience and Observability | Prometheus metrics | Done |
| Block 3: Resilience and Observability | Grafana dashboard | Done |
| Block 4: Security and Production | env vars | Done |
| Block 4: Security and Production | docker-compose | Done |
| Block 4: Security and Production | `.env` ignored | Done |
| Block 4: Security and Production | `.env.example` | Done |
| Block 4: Security and Production | Swagger/OpenAPI | Done |
| Block 4: Security and Production | JWT authentication | Done |

## Troubleshooting
### Ports already in use
- Check conflicting ports (`3000`, `3001`, `8080`, `5001-5004`, `9090`, `15672`).
- Stop conflicting processes or change host port mapping in `docker-compose.yml`.

### Old database schema in Docker volumes
- Recreate with:
```bash
docker compose down -v
docker compose up --build
```

### RabbitMQ not ready
- Wait until `rabbitmq` is healthy and backend consumers reconnect automatically.
- Check RabbitMQ UI at http://localhost:15672.

### Frontend cannot reach API Gateway
- Verify frontend opens at `http://localhost:3001`.
- Verify gateway health `http://localhost:8080/health`.
- Ensure browser cache is refreshed after gateway config changes.

## Environment Variables
See `.env.example` for supported variables:
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `ASPNETCORE_ENVIRONMENT`
- `VITE_API_BASE_URL`
