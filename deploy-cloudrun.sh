#!/usr/bin/env bash
# =============================================================================
# Quick Deploy Script for Google Cloud Run
# منصة المسابقات الهجينة متعددة الشاشات v10.1
# =============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-}"          # Set via: export GCP_PROJECT_ID=my-project
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="trivia-platform"
REPOSITORY="trivia-repo"
IMAGE_TAG="${GITHUB_SHA:-$(date +%Y%m%d-%H%M%S)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}ℹ️  $*${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $*${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
log_error() { echo -e "${RED}❌ $*${NC}"; }

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
check_requirements() {
  log_info "Checking requirements..."

  if ! command -v gcloud &> /dev/null; then
    log_error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi

  if [[ -z "$PROJECT_ID" ]]; then
    log_error "GCP_PROJECT_ID not set. Export it: export GCP_PROJECT_ID=your-project-id"
    exit 1
  fi

  # Check if user is authenticated
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    log_error "Not authenticated. Run: gcloud auth login"
    exit 1
  fi

  log_ok "All requirements met"
}

# ─── Enable Required APIs ────────────────────────────────────────────────────
enable_apis() {
  log_info "Enabling required Google Cloud APIs..."
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    sqladmin.googleapis.com \
    --project="$PROJECT_ID" --quiet
  log_ok "APIs enabled"
}

# ─── Create Artifact Registry Repository ────────────────────────────────────
create_repo() {
  log_info "Creating Artifact Registry repository (if not exists)..."
  if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
    gcloud artifacts repositories create "$REPOSITORY" \
      --repository-format=docker \
      --location="$REGION" \
      --description="Trivia Platform Docker Images" \
      --project="$PROJECT_ID" --quiet
    log_ok "Repository created"
  else
    log_ok "Repository already exists"
  fi
}

# ─── Setup Secrets ───────────────────────────────────────────────────────────
setup_secrets() {
  log_info "Setting up secrets..."

  # HOST_PIN secret
  if ! gcloud secrets describe host-pin --project="$PROJECT_ID" &>/dev/null; then
    log_warn "HOST_PIN secret not found. Creating with default (CHANGE IN PRODUCTION!)"
    echo -n "CHANGE_ME_123456" | gcloud secrets create host-pin --data-file=- --project="$PROJECT_ID" --quiet
    log_warn "⚠️  IMPORTANT: Update HOST_PIN in Secret Manager before production use!"
  else
    log_ok "HOST_PIN secret exists"
  fi

  # Grant Cloud Run service account access to secrets
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

  for secret in host-pin; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$SA" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$PROJECT_ID" --quiet &>/dev/null || true
  done
  log_ok "Secret permissions configured"
}

# ─── Build & Push Image ─────────────────────────────────────────────────────
build_image() {
  log_info "Building and pushing Docker image..."
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"

  gcloud builds submit --tag "$IMAGE" --project="$PROJECT_ID" --quiet
  log_ok "Image pushed: $IMAGE"
  echo "$IMAGE"
}

# ─── Deploy to Cloud Run ────────────────────────────────────────────────────
deploy_service() {
  local IMAGE="$1"

  log_info "Deploying to Cloud Run..."

  # Get Cloud SQL connection name if instance exists
  CLOUDSQL_INSTANCES=""
  if gcloud sql instances describe trivia-db --project="$PROJECT_ID" &>/dev/null; then
    CLOUDSQL_INSTANCES=$(gcloud sql instances describe trivia-db --project="$PROJECT_ID" --format='value(connectionName)')
    log_info "Cloud SQL instance found: $CLOUDSQL_INSTANCES"
  else
    log_warn "Cloud SQL instance 'trivia-db' not found. Using ephemeral SQLite (data lost on restart)."
    log_warn "Create one with: gcloud sql instances create trivia-db --database-version=SQLITE --tier=db-f1-micro --region=$REGION"
  fi

  gcloud run deploy "$SERVICE_NAME" \
    --image="$IMAGE" \
    --platform=managed \
    --region="$REGION" \
    --allow-unauthenticated \
    --port=8080 \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=10 \
    --concurrency=80 \
    --timeout=300 \
    --set-env-vars="NODE_ENV=production" \
    --set-secrets="HOST_PIN=host-pin:latest" \
    ${CLOUDSQL_INSTANCES:+--add-cloudsql-instances="$CLOUDSQL_INSTANCES"} \
    --project="$PROJECT_ID" --quiet

  log_ok "Deployment complete!"
}

# ─── Get Service URL ────────────────────────────────────────────────────────
get_service_url() {
  log_info "Retrieving service URL..."
  URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')

  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  🎉  النشر مكتمل!  🎉                                        ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  🌐  المنصة:        $URL"
  echo "║  🔌  WebSocket:     ${URL/https:/wss:}/ws"
  echo "║  ❤️   Health Check: $URL/api/health"
  echo "║  📊  السجلات:       gcloud run services logs tail $SERVICE_NAME --region=$REGION"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  🚀  منصة المسابقات - النشر على Google Cloud Run             ║"
  echo "║  الإصدار: 10.1 Production Ready                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""

  check_requirements
  enable_apis
  create_repo
  setup_secrets

  IMAGE=$(build_image)
  deploy_service "$IMAGE"
  get_service_url
}

# Run main
main "$@"