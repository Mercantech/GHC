# GHC — GitHub Classroom-erstatning

Self-hostet værktøj til GitHub-assignments (templates, invite-links, grupper). Auth via [Mercantec Auth](https://auth.mercantec.tech). Docker Compose til Dokploy.

## Lokal udvikling

```bash
cp .env.example .env
# Sæt TOKEN_ENCRYPTION_KEY
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

- App: http://localhost:8080  
- API via nginx: http://localhost:8080/api/health  

## Dokploy (dev/prod)

```bash
docker compose up -d --build
```

- Kun **web** er på `dokploy-network` med Traefik (`Host` via `TRAEFIK_HOST`).
- **api** + **db** er kun på internt netværk.
- Browser kalder `/api/*` → nginx i web → `http://ghc-api:3000/*`.

Sæt pr. miljø: `WEB_ORIGIN`, `REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `MERCANTEC_CLIENT_ID`, `TRAEFIK_HOST`.

## Mercantec Auth

| Felt | Værdi |
|------|--------|
| `IsPublic` | `true` (PKCE) |
| `client_id` | `MERCANTEC_CLIENT_ID` (fx `ghc`) |
| Redirect URIs | lokal + `https://ghc.mercantec.tech/auth/callback` |
| `Cors:SpaOrigins` | SPA-origin (fx `https://ghc.mercantec.tech`) |
| `RequiredLinkedProviders` | `github` |

Token-udveksling: SPA → `POST /api/oauth/token` → API → Mercantec (undgår auth-host CORS).

## Flows

**Underviser:** org + PAT → roster CSV → assignment → invite-link.  
**Elev:** invite → GitHub-brugernavn → acceptér / opret-eller-join gruppe.

## Struktur

```
apps/api   Fastify + Prisma + Postgres
apps/web   React + Vite (nginx :3000 + /api-proxy)
docker-compose.yml         # Dokploy
docker-compose.local.yml   # host-porte til lokal
```
