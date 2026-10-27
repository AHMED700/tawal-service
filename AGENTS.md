# TAWAL Service V13

Continue the existing Next.js/TypeScript application; do not rebuild from scratch. Keep Arabic RTL school, leader and admin interfaces simple. Work in the existing isolated checkout; do not create a worktree unless requested.

Use Node.js 22/24 and `npm ci`. Run `npm run check:source`, `npm test`, `npm run build`, then `npm run typecheck` after changes. Start locally with `npm start -- --hostname 127.0.0.1 --port 3000`; HTTP GET / and /login must return 200, and unauthenticated /api/staff/tickets must return 401.

Never commit .env files, passwords, service keys, tokens, node_modules or .next. Keep service-role access server-only. Do not log school contact data or raw backend errors. Preserve RLS and database authorization; UI role checks alone do not authorize actions. Add ordered SQL migrations instead of modifying previously applied schema.

Read README.md and VALIDATION.md. External Supabase and Turnstile integration requires secure environment configuration and separate validation. Do not deploy the site without explicit owner approval. Preparing files does not authorize pushing commits.
