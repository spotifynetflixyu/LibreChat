#!/usr/bin/env sh
set -eu

DATA_DIR="${DATA_DIR:-${RENDER_DATA_DIR:-/data}}"
CONFIG_PATH="${CONFIG_PATH:-$DATA_DIR/librechat.yaml}"

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3080}"
export CONFIG_PATH
export OPENAI_OAUTH_AUTH_FILE="${OPENAI_OAUTH_AUTH_FILE:-$DATA_DIR/openai-oauth/auth.json}"

PADDLEOCR_PREPARE_ON_STARTUP="${PADDLEOCR_PREPARE_ON_STARTUP:-true}"
PADDLEOCR_DIR="${PADDLEOCR_DIR:-$DATA_DIR/paddleocr}"
PADDLEOCR_VENV_DIR="${PADDLEOCR_VENV_DIR:-$PADDLEOCR_DIR/venv}"
PADDLEOCR_UV_CACHE_DIR="${PADDLEOCR_UV_CACHE_DIR:-$PADDLEOCR_DIR/uv-cache}"
PADDLEOCR_UV_PYTHON_INSTALL_DIR="${PADDLEOCR_UV_PYTHON_INSTALL_DIR:-$PADDLEOCR_DIR/python}"
PADDLEOCR_PYTHON_VERSION="${PADDLEOCR_PYTHON_VERSION:-3.12}"
PADDLEOCR_MCP_PACKAGE="${PADDLEOCR_MCP_PACKAGE:-paddleocr-mcp}"
PADDLEOCR_MCP_BIN="${PADDLEOCR_MCP_BIN:-$PADDLEOCR_VENV_DIR/bin/paddleocr_mcp}"
PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS="${PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS:-10}"
PADDLEOCR_PREWARM_STRICT="${PADDLEOCR_PREWARM_STRICT:-true}"
PADDLEOCR_FORCE_REINSTALL="${PADDLEOCR_FORCE_REINSTALL:-false}"

if [ -z "${PADDLEOCR_MCP_PPOCR_SOURCE:-}" ] && [ -n "${PADDLEOCR_MCP_QIANFAN_API_KEY:-}" ]; then
  PADDLEOCR_MCP_PPOCR_SOURCE="qianfan"
fi

export PADDLEOCR_MCP_PPOCR_SOURCE="${PADDLEOCR_MCP_PPOCR_SOURCE:-aistudio}"
if [ -z "${PADDLEOCR_MCP_MODEL:-}" ]; then
  if [ "$PADDLEOCR_MCP_PPOCR_SOURCE" = "qianfan" ]; then
    PADDLEOCR_MCP_MODEL="PaddleOCR-VL"
  else
    PADDLEOCR_MCP_MODEL="PaddleOCR-VL-1.6"
  fi
fi
export PADDLEOCR_MCP_MODEL
export PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT="${PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT:-600}"
export PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT="${PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT:-1200}"
export PADDLEOCR_MCP_HTTP_TIMEOUT="${PADDLEOCR_MCP_HTTP_TIMEOUT:-1200}"
export UV_PYTHON_INSTALL_DIR="$PADDLEOCR_UV_PYTHON_INSTALL_DIR"

paddleocr_log() {
  printf '[paddleocr] %s\n' "$*" >&2
}

is_truthy() {
  case "$1" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

fail_or_warn_paddleocr() {
  message="$1"

  if is_truthy "$PADDLEOCR_PREWARM_STRICT"; then
    paddleocr_log "$message"
    return 1
  fi

  paddleocr_log "warning: $message"
  return 0
}

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

ensure_paddleocr_venv() {
  marker="$PADDLEOCR_DIR/package.txt"
  python_bin="$PADDLEOCR_VENV_DIR/bin/python"
  needs_install=false
  needs_venv=false

  if ! command -v uv >/dev/null 2>&1; then
    fail_or_warn_paddleocr "uv is not available; cannot prepare PaddleOCR MCP venv"
    return $?
  fi

  case "$PADDLEOCR_VENV_DIR" in
    ""|"/")
      fail_or_warn_paddleocr "invalid PADDLEOCR_VENV_DIR: $PADDLEOCR_VENV_DIR"
      return $?
      ;;
  esac

  mkdir -p "$PADDLEOCR_DIR" "$PADDLEOCR_UV_CACHE_DIR" "$PADDLEOCR_UV_PYTHON_INSTALL_DIR"

  if [ ! -x "$python_bin" ]; then
    needs_venv=true
  elif [ -L "$python_bin" ]; then
    python_target="$(readlink "$python_bin")"
    case "$python_target" in
      "$PADDLEOCR_UV_PYTHON_INSTALL_DIR"/*)
        ;;
      *)
        needs_venv=true
        ;;
    esac
  fi

  if [ "$needs_venv" = "true" ]; then
    paddleocr_log "creating persistent venv at $PADDLEOCR_VENV_DIR"
    rm -rf "$PADDLEOCR_VENV_DIR"
    UV_CACHE_DIR="$PADDLEOCR_UV_CACHE_DIR" UV_PYTHON_INSTALL_DIR="$PADDLEOCR_UV_PYTHON_INSTALL_DIR" uv venv --python "$PADDLEOCR_PYTHON_VERSION" "$PADDLEOCR_VENV_DIR"
  fi

  if is_truthy "$PADDLEOCR_FORCE_REINSTALL"; then
    needs_install=true
  elif [ ! -x "$PADDLEOCR_MCP_BIN" ]; then
    needs_install=true
  elif [ ! -f "$marker" ] || [ "$(cat "$marker" 2>/dev/null || true)" != "$PADDLEOCR_MCP_PACKAGE" ]; then
    needs_install=true
  elif ! "$python_bin" -c 'import paddleocr_mcp' >/dev/null 2>&1; then
    needs_install=true
  fi

  if [ "$needs_install" = "true" ]; then
    paddleocr_log "installing $PADDLEOCR_MCP_PACKAGE into $PADDLEOCR_VENV_DIR"
    UV_CACHE_DIR="$PADDLEOCR_UV_CACHE_DIR" uv pip install --python "$python_bin" "$PADDLEOCR_MCP_PACKAGE"
    printf '%s\n' "$PADDLEOCR_MCP_PACKAGE" >"$marker"
  fi

  "$python_bin" -c 'import paddleocr_mcp'

  if [ ! -x "$PADDLEOCR_MCP_BIN" ]; then
    fail_or_warn_paddleocr "PaddleOCR MCP executable is missing: $PADDLEOCR_MCP_BIN"
    return $?
  fi
}

smoke_paddleocr_startup() {
  smoke_dir="$PADDLEOCR_DIR/startup-smoke"
  stdout_path="$smoke_dir/stdout.log"
  stderr_path="$smoke_dir/stderr.log"
  grace_seconds=$((PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS + 5))

  mkdir -p "$smoke_dir"
  rm -f "$stdout_path" "$stderr_path"

  paddleocr_log "starting MCP server for ${PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS}s smoke check"
  set +e
  timeout "$grace_seconds" sh -c 'sleep "$1" | "$2"' sh "$PADDLEOCR_MCP_STARTUP_SMOKE_TIMEOUT_SECONDS" "$PADDLEOCR_MCP_BIN" >"$stdout_path" 2>"$stderr_path"
  status=$?
  set -e

  case "$status" in
    0|124)
      paddleocr_log "MCP server startup smoke passed with status $status"
      ;;
    *)
      paddleocr_log "MCP server startup smoke failed with status $status"
      if [ -s "$stderr_path" ]; then
        tail -n 40 "$stderr_path" >&2 || true
      fi
      fail_or_warn_paddleocr "PaddleOCR MCP server did not survive startup smoke"
      return $?
      ;;
  esac
}

prepare_paddleocr() {
  if ! is_truthy "$PADDLEOCR_PREPARE_ON_STARTUP"; then
    paddleocr_log "startup preparation disabled"
    return 0
  fi

  paddleocr_log "using provider ${PADDLEOCR_MCP_PPOCR_SOURCE}"
  ensure_paddleocr_venv
  smoke_paddleocr_startup
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

prepare_paddleocr

exec node server/index.js
