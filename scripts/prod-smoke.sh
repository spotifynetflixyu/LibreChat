#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?usage: scripts/prod-smoke.sh https://chat.example.com}"

curl -fsS "${base_url}/api/config" >/dev/null

status="$(curl -s -o /dev/null -w '%{http_code}' "${base_url}/steel/oauth-chat")"
if [ "$status" != "404" ]; then
  echo "expected /steel/oauth-chat to be unavailable, got HTTP ${status}" >&2
  exit 1
fi

api_status="$(
  curl -s -o /dev/null -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"dev probe"}]}' \
    "${base_url}/api/steel/ai/chat"
)"
if [ "$api_status" != "404" ]; then
  echo "expected /api/steel/ai/chat to be unavailable, got HTTP ${api_status}" >&2
  exit 1
fi
