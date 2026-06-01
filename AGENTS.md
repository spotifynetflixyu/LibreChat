# Project Agent Instructions

Read `CLAUDE.md` before making project changes. It is the canonical project
agent document for this repository.

## Conversation Wrap-Up

Every final or wrap-up response must include a `Next Tasks` section with
concrete options for the user to choose from. Keep the options short,
actionable, and specific to the current work.

## Supabase Schema Rule

Steel PostgreSQL schema changes must always update both files:

- `supabase/schema.sql` is the complete current Steel Supabase schema snapshot.
- `supabase/migration/*.sql` files are one-change migration records.

Do not update one without the other. Create new migration files automatically
with `npx supabase migration new <change_name>` instead of asking the user to
create them manually. Keep Steel database setup on Supabase cloud Postgres
through `.env` `STEEL_POSTGRES_URL` and cloud MongoDB through `MONGO_URI`; do
not introduce Docker-dependent setup for Steel database work.
