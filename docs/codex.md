# Codex Rules

Before making changes, read:

- `docs/architecture.md`
- `docs/current-status.md`
- `README.md`

Use these files as source of truth.

## General rules

1. Do not rewrite architecture unless explicitly asked.
2. Do not change existing API routes without explicit reason.
3. Do not break frontend demo flow.
4. Do not remove health endpoints.
5. Do not remove Swagger/OpenAPI.
6. Do not disable JWT authentication.
7. Do not merge databases.
8. Do not make direct SQL calls to another service database.
9. Use HTTP or RabbitMQ for interservice communication.
10. Keep docker compose startup working.

## Parallel work rules

Only modify files inside the allowed scope of the task.

If task says "README only":
- modify only `README.md` and `docs/`

If task says "wishlist-service only":
- modify only wishlist-service files

If task says "observability":
- do not change business logic

If task says "infra only":
- modify only docker-compose, nginx, prometheus, grafana, env files

Do not touch frontend unless task explicitly says frontend.

## After changes

Project must still run with:

```bash
docker compose up --build

Do not commit real secrets.
Do not add .env to git.

