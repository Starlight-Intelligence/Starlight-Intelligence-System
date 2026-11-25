#!/usr/bin/env bash
# ==============================================================================
# Deploy Starlight Runner to Google Cloud Run Jobs (Scale-to-Zero)
# Built on SIP v1.1.1 — Sovereign Substrate
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${GCP_PROJECT_ID:-starlight-intelligence}"
REGION="${GCP_REGION:-europe-west4}"
JOB_NAME="${CLOUD_RUN_JOB:-starlight-runner-job}"
# Separate runtime execution SA (no project-wide deploy/admin roles). Override via GCP_RUNNER_SA if needed.
RUNNER_SA="${GCP_RUNNER_SA:-starlight-runner-exec-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
GIT_SHA="$(git -C "$SCRIPT_DIR/../.." rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/starlight-fleet/runner:${GIT_SHA}"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: GCP Project ID not found. Set GCP_PROJECT_ID or run 'gcloud config set project <id>'."
  exit 1
fi

echo "Deploying Starlight Runner Job..."
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Image:   $IMAGE_TAG"

# 1. Enable required APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --project="$PROJECT_ID"

# 2. Create Artifact Registry repository if not exists
gcloud artifacts repositories describe starlight-fleet --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
gcloud artifacts repositories create starlight-fleet \
  --repository-format=docker \
  --location="$REGION" \
  --description="Starlight Swarm Autonomous Runner Images" \
  --project="$PROJECT_ID"

# 3. Build container image using Cloud Build
echo "Building container with Cloud Build..."
gcloud builds submit "$SCRIPT_DIR" \
  --config="$SCRIPT_DIR/cloudbuild.yaml" \
  --substitutions="_IMAGE_TAG=${IMAGE_TAG}" \
  --project="$PROJECT_ID"

# 4. Optional Cloud Storage FUSE cache mount (disabled by default; pnpm uses local POSIX store)
VOLUME_ARGS=()
CACHE_BUCKET="${GCS_CACHE_BUCKET:-${PROJECT_ID}-starlight-runner-cache}"
if [ "${ENABLE_GCS_CACHE:-0}" = "1" ] && gcloud storage buckets describe "gs://${CACHE_BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo " Attaching Cloud Storage cache volume from gs://${CACHE_BUCKET}..."
  VOLUME_ARGS+=(
    --add-volume="name=pnpm-cache,type=cloud-storage,bucket=${CACHE_BUCKET}"
    --add-volume-mount="volume=pnpm-cache,mount-path=/cache/pnpm"
  )
fi

# 5. Wire Secret Manager secrets if present (required for signed /v1/runner/callback)
SECRET_SPECS=()
RUNNER_SECRET_NAME="${STARLIGHT_RUNNER_SECRET_NAME:-STARLIGHT_RUNNER_SECRET}"
if gcloud secrets describe "$RUNNER_SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  SECRET_SPECS+=("STARLIGHT_RUNNER_SECRET=${RUNNER_SECRET_NAME}:latest")
else
  echo "Warning: Secret '$RUNNER_SECRET_NAME' not found in Secret Manager; signed receipt callbacks will fail closed until provisioned." >&2
fi
if [ -n "${GITHUB_TOKEN_SECRET_NAME:-}" ] && gcloud secrets describe "$GITHUB_TOKEN_SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  SECRET_SPECS+=("GITHUB_TOKEN=${GITHUB_TOKEN_SECRET_NAME}:latest")
fi

SECRET_ARGS=()
if [ "${#SECRET_SPECS[@]}" -gt 0 ]; then
  SECRET_JOINED="$(IFS=,; echo "${SECRET_SPECS[*]}")"
  SECRET_ARGS+=(--set-secrets="$SECRET_JOINED")
fi

# 6. Create or Update Cloud Run Job
echo "Configuring Cloud Run Job: $JOB_NAME (Scale-to-Zero, 4GB RAM, 2 vCPUs, SA: $RUNNER_SA)..."
if gcloud run jobs describe "$JOB_NAME" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_NAME" \
    --image="$IMAGE_TAG" \
    --region="$REGION" \
    --service-account="$RUNNER_SA" \
    --cpu=2 \
    --memory=4Gi \
    --task-timeout=900s \
    --max-retries=1 \
    "${SECRET_ARGS[@]}" \
    "${VOLUME_ARGS[@]}" \
    --project="$PROJECT_ID"
else
  gcloud run jobs create "$JOB_NAME" \
    --image="$IMAGE_TAG" \
    --region="$REGION" \
    --service-account="$RUNNER_SA" \
    --cpu=2 \
    --memory=4Gi \
    --task-timeout=900s \
    --max-retries=1 \
    "${SECRET_ARGS[@]}" \
    "${VOLUME_ARGS[@]}" \
    --project="$PROJECT_ID"
fi


echo "=========================================================="
echo " Starlight Runner Deployed Successfully!"
echo " Scale-to-Zero: $0.00 Idle Cost"
echo " Free Tier: Up to 360,000 vCPU-seconds / month"
echo " To execute on-demand:"
echo "   gcloud run jobs execute $JOB_NAME --region=$REGION --update-env-vars STARLIGHT_REPO=\"frankxai/arcanea-ai-app\",STARLIGHT_COMMAND=\"npm test\""
echo "=========================================================="
