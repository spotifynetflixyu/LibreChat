#!/usr/bin/env sh
set -eu

DATA_DIR="${RENDER_DATA_DIR:-/data}"
CONFIG_PATH="${CONFIG_PATH:-$DATA_DIR/librechat.yaml}"

export HOST="${HOST:-0.0.0.0}"
export CONFIG_PATH
export OPENAI_OAUTH_AUTH_FILE="${OPENAI_OAUTH_AUTH_FILE:-$DATA_DIR/openai-oauth/auth.json}"

seed_path() {
  target="$1"
  source="$2"

  mkdir -p "$target"

  if [ -d "$source" ] && [ -z "$(ls -A "$target" 2>/dev/null)" ]; then
    cp -R "$source"/. "$target"/
  fi
}

link_path() {
  target="$1"
  link="$2"
  parent="$(dirname "$link")"

  mkdir -p "$target" "$parent"

  if [ -L "$link" ]; then
    rm "$link"
  elif [ -e "$link" ]; then
    rm -rf "$link"
  fi

  ln -s "$target" "$link"
}

mkdir -p "$DATA_DIR"

case "$CONFIG_PATH" in
  http://*|https://*)
    ;;
  *)
    mkdir -p "$(dirname "$CONFIG_PATH")"
    if [ ! -f "$CONFIG_PATH" ]; then
      printf 'version: 1.3.11\n' >"$CONFIG_PATH"
    fi
    ;;
esac

seed_path "$DATA_DIR/skill" /app/skill

link_path "$DATA_DIR/uploads" /app/uploads
link_path "$DATA_DIR/images" /app/client/public/images
link_path "$DATA_DIR/logs" /app/api/logs
link_path "$DATA_DIR/skill" /app/skill
link_path "$DATA_DIR/openai-oauth" /var/secrets/openai-oauth

exec node server/index.js
