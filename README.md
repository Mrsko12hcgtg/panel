# Mini-ZEUS
A small, personal Cloudflare Workers + D1 panel for managing VLESS-over-WebSocket users.

## What it contains
- Cloudflare Worker
- D1 user database
- Admin API protected by `ADMIN_TOKEN`
- VLESS over WebSocket transport
- UUID-based users
- Subscription endpoint
- Simple mobile-friendly admin UI
- No Cloudflare API token in browser code

## Important
This is an independent implementation. It does not copy ZEUS source code.

## Deploy
1. Create a D1 database:
   `npx wrangler d1 create mini-zeus-db`
2. Put the returned `database_id` in `wrangler.toml`.
3. Apply the migration:
   `npx wrangler d1 migrations apply mini-zeus-db --remote`
4. Set the admin secret:
   `npx wrangler secret put ADMIN_TOKEN`
5. Deploy:
   `npx wrangler deploy`

## Admin
Open:
`https://YOUR-WORKER.workers.dev/admin`

Use the same value you entered for `ADMIN_TOKEN`.

## Endpoints
- `GET /admin` - mobile admin UI
- `GET /api/users` - list users
- `POST /api/users` - create user
- `DELETE /api/users/:id` - delete user
- `GET /sub/:token` - subscription
- `GET /ws` - VLESS WebSocket endpoint

## Client URL
After creating a user, the panel generates a VLESS URL using the current hostname.

This first version intentionally supports TCP only. UDP/MUX/fragmentation/IP rotation are not included yet.
<!--test>
