# Steel Supabase Cloud Development

Steel uses Supabase cloud Postgres through `STEEL_POSTGRES_URL`, and
LibreChat/Steel application state uses cloud MongoDB through `MONGO_URI`. Do not
make Steel backend startup depend on a local Supabase Docker stack.

## Runtime Connection

Put the Supabase Postgres connection string in the root `.env` file:

```env
STEEL_POSTGRES_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

The direct database URL is the normal Steel runtime path. If local DNS or IPv6
support blocks the direct URL, use the Supabase Session pooler URL documented in
`docs/local-dev.md`. The Steel Postgres helper automatically adds
`sslmode=require&uselibpqcompat=true` when `STEEL_POSTGRES_URL` does not specify
an SSL mode, so local Supabase pooler connections do not fail with a
certificate-chain error. Explicit CA-backed settings such as
`sslmode=verify-full` are preserved.

## Migration Workflow

For every Steel PostgreSQL schema change:

1. Run `npx supabase migration new <change_name>`.
2. Put the one-change SQL in the generated migration file.
3. Update `supabase/schema.sql` in the same change so it remains the complete
   current Steel schema snapshot.
4. Apply and verify the migration against the Supabase cloud development
   database through `.env` `STEEL_POSTGRES_URL`.

The Supabase CLI uses the standard `supabase/migrations` path. In this repo,
`supabase/migrations` is a symlink to the canonical
`supabase/migration` directory required by the Steel schema rule. Keep that
symlink intact.

Keep Steel tables in the private `steel` schema unless a future task explicitly
adds Data API grants and RLS policies.

## MCP

The project-level `.mcp.json` configures hosted Supabase MCP plus the Steel OCR
MCP server:

```json
{
  "mcpServers": {
    "PaddleOCR-VL-1.6": {
      "command": "uvx",
      "args": ["--from", "paddleocr-mcp", "paddleocr_mcp"],
      "env": {
        "PADDLEOCR_MCP_MODEL": "PaddleOCR-VL-1.6",
        "PADDLEOCR_MCP_PPOCR_SOURCE": "aistudio",
        "PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN": "${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}"
      }
    },
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=iumtsqkuppgopxskuwns"
    }
  }
}
```

The `project_ref` scopes MCP access to the Steel development Supabase project
and is derived from the `db.iumtsqkuppgopxskuwns.supabase.co` host. Authenticate
through the MCP client flow when prompted. Do not commit access tokens,
passwords, or local Supabase secrets.

For PaddleOCR live OCR tests, put the AI Studio token in local `.env` as
`PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`. The MCP config must keep only the
`${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}` placeholder.
