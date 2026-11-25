#!/usr/bin/env bash
# Deploy Starlight Web Design Critic to Google Cloud Run Jobs (Scale-to-Zero)
# Built on SIP v1.1.1 — Sovereign Substrate
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${GCP_PROJECT_ID:-starlight-intelligence}"
REGION="${GCP_REGION:-europe-west4}"
JOB_NAME="${CLOUD_RUN_CRITIC_JOB:-starlight-web-critic-job}"
RUNNER_SA="${GCP_CRITIC_SA:-starlight-runner-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
GIT_SHA="$(git -C "$SCRIPT_DIR/../.." rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/starlight-fleet/web-critic:${GIT_SHA}"

echo "Deploying Starlight Web Design Critic Job..."
echo "Project: $PROJECT_ID | Region: $REGION | Job: $JOB_NAME"

gcloud builds submit "$SCRIPT_DIR" \
  --config="$SCRIPT_DIR/cloudbuild.yaml" \
  --substitutions="_IMAGE_TAG=${IMAGE_TAG}" \
  --project="$PROJECT_ID"

if gcloud run jobs describe "$JOB_NAME" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_NAME" \
    --image="$IMAGE_TAG" \
    --region="$REGION" \
    --service-account="$RUNNER_SA" \
    --cpu=2 \
    --memory=4Gi \
    --task-timeout=600s \
    --max-retries=1 \
    --project="$PROJECT_ID"
else
  gcloud run jobs create "$JOB_NAME" \
    --image="$IMAGE_TAG" \
    --region="$REGION" \
    --service-account="$RUNNER_SA" \
    --cpu=2 \
    --memory=4Gi \
    --task-timeout=600s \
    --max-retries=1 \
    --project="$PROJECT_ID"
fi
