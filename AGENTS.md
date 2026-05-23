# Project Agent Instructions

Read `CLAUDE.md` before making project changes. It is the canonical project
agent document for this repository.

## Supabase Schema Rule

Steel PostgreSQL schema changes must always update both files:

- `supabase/schema.sql` is the complete current Steel Supabase schema snapshot.
- `supabase/migration/*.sql` files are one-change migration records.

Do not update one without the other. Keep Steel database setup on Supabase
Postgres through `STEEL_POSTGRES_URL` and cloud MongoDB through `MONGO_URI`;
do not introduce Docker-dependent setup for Steel database work.
