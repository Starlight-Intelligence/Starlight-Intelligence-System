#!/usr/bin/env bash
# ==============================================================================
# Starlight Scale-to-Zero Runner Entrypoint
# Executes CI/CD validation, SAGE proving ground, and autonomous agent tasks.
# Built on SIP v1.1.1 — Sovereign Substrate
# ==============================================================================

set -eo pipefail

echo "=========================================================="
echo " Starlight Sovereign Runner — Initializing Scale-to-Zero Task"
echo " Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo " Host: $(hostname)"
echo " Memory: $(grep MemTotal /proc/meminfo | awk '{print $2}') kB"
echo " CPU: $(nproc) vCPUs"
echo "=========================================================="

REPO="${STARLIGHT_REPO:-${REPO:-$1}}"
RAW_REF="${STARLIGHT_REF:-${GIT_REF:-${2:-main}}}"
REF="${RAW_REF#refs/heads/}"
REF="${REF#refs/tags/}"
COMMAND="${STARLIGHT_COMMAND:-${3:-npm test}}"
CALLBACK_URL="${STARLIGHT_CALLBACK_URL:-${CALLBACK_URL:-$4}}"

if [ -z "$REPO" ]; then
  echo "Error: No repository specified. Pass via STARLIGHT_REPO env or argument 1."
  exit 1
fi

WORKSPACE_DIR="/home/starlight/workspace"
cd "$WORKSPACE_DIR"

echo " Cloning repository: $REPO (ref: $REF)..."
CLONE_URL="https://github.com/${REPO}.git"
if [ -n "$GITHUB_TOKEN" ]; then
  CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
fi

if [[ "$REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
  git clone --depth 1 "$CLONE_URL" repo
  cd repo
  git fetch --depth 1 origin "$REF"
  git checkout --detach FETCH_HEAD
  cd "$WORKSPACE_DIR"
else
  git clone --depth 1 --branch "$REF" "$CLONE_URL" repo
fi

cd repo

echo " Configuring dependency cache..."
# Keep active pnpm store on local POSIX disk so SQLite index.db-shm and executable +x bits work reliably.
LOCAL_PNPM_STORE="/home/starlight/.local/share/pnpm/store/v3"
mkdir -p "$LOCAL_PNPM_STORE"
pnpm config set store-dir "$LOCAL_PNPM_STORE"

echo " Installing dependencies..."
INSTALL_START=$(date +%s)
if [ "${STARLIGHT_SKIP_INSTALL:-0}" = "1" ]; then
  echo " Skipping dependency install (STARLIGHT_SKIP_INSTALL=1)"
elif [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile --prefer-offline || pnpm install --frozen-lockfile
elif [ -f "package-lock.json" ]; then
  npm ci --prefer-offline || npm install
elif [ -f "package.json" ]; then
  npm install
fi
INSTALL_DURATION=$(( $(date +%s) - INSTALL_START ))
echo " Dependency install finished in ${INSTALL_DURATION}s"

echo " Executing Verification Command: $COMMAND"
TASK_TIMEOUT="${STARLIGHT_TIMEOUT:-300s}"
START_TIME=$(date +%s)
EXIT_CODE=0

# Execute with process timeout protection to prevent runaway job costs
if timeout -k 10s "$TASK_TIMEOUT" bash -c "$COMMAND"; then
  echo " Verification PASSED"
  STATUS="pass"
else
  EXIT_CODE=$?
  echo " Verification FAILED with exit code: $EXIT_CODE"
  STATUS="fail"
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo " Run duration: ${DURATION}s"

if [ -n "$CALLBACK_URL" ]; then
  if [ -z "$STARLIGHT_RUNNER_SECRET" ]; then
    echo "Error: CALLBACK_URL is set without STARLIGHT_RUNNER_SECRET; refusing unsigned receipt callback." >&2
    exit 1
  fi

  echo " Posting signed execution receipt to callback: $CALLBACK_URL"
  PAYLOAD=$(jq -n \
    --arg repo "$REPO" \
    --arg ref "$REF" \
    --arg status "$STATUS" \
    --arg duration "$DURATION" \
    --arg installDuration "$INSTALL_DURATION" \
    --arg exitCode "$EXIT_CODE" \
    '{repo: $repo, ref: $ref, status: $status, duration: ($duration|tonumber), installDuration: ($installDuration|tonumber), exitCode: ($exitCode|tonumber), timestamp: (now|todate)}')

  SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$STARLIGHT_RUNNER_SECRET" | awk '{print $2}')
  if ! curl -fsS --max-time 15 -X POST "$CALLBACK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Starlight-Signature: sha256=$SIG" \
    -d "$PAYLOAD"; then
    echo "Error: Signed receipt callback to $CALLBACK_URL failed." >&2
    exit 1
  fi
fi

exit "$EXIT_CODE"

