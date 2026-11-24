<#
.SYNOPSIS
Idempotent, dry-run-by-default GCP + Workload Identity Federation bootstrap for Starlight Cloud Runner.
Built on SIP v1.1.1.

.EXAMPLE
.\tools\runner\bootstrap-gcp-wif.ps1
  Prints all commands that would run without mutating GCP.

.EXAMPLE
.\tools\runner\bootstrap-gcp-wif.ps1 -ProjectId "starlight-intelligence-estate" -Region "europe-west4" -Apply
  Applies API enablement, Artifact Registry, GCS FUSE cache bucket, WIF pool/provider, and runner SA.
#>
[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "starlight-intelligence" }),
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "europe-west4" }),
  [string]$JobName = $(if ($env:CLOUD_RUN_JOB) { $env:CLOUD_RUN_JOB } else { "starlight-runner-job" }),
  [string[]]$GitHubOrgs = @("Starlight-Intelligence", "frankxai"),
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

$GcloudCmd = Get-Command gcloud -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $GcloudCmd) {
  $candidates = @(
    "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
    "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  )
  $GcloudCmd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $GcloudCmd -and $Apply) {
  throw "gcloud CLI not found. Install Google.CloudSDK and run 'gcloud auth login' before passing -Apply."
}

$PoolId = "starlight-github-pool"
$ProviderId = "github-actions"
$ServiceAccountName = "starlight-runner-sa"
$ServiceAccountEmail = "$ServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$CacheBucket = "$ProjectId-starlight-runner-cache"
$OrgCondition = ($GitHubOrgs | ForEach-Object { "assertion.repository_owner=='$_'" }) -join " || "

function Invoke-GcloudStep {
  param(
    [string]$Label,
    [string[]]$GcloudArgs,
    [switch]$IgnoreAlreadyExists
  )
  $display = "gcloud $($GcloudArgs -join ' ')"
  if (-not $Apply) {
    Write-Host "[DRY-RUN] $Label" -ForegroundColor Cyan
    Write-Host "          $display"
    return
  }

  Write-Host "[APPLY] $Label" -ForegroundColor Green
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & $GcloudCmd @GcloudArgs 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($code -ne 0) {
    $text = ($output | Out-String)
    if ($IgnoreAlreadyExists -and $text -match "ALREADY_EXISTS|already exists") {
      Write-Host "          Already exists; continuing." -ForegroundColor DarkGray
      return
    }
    throw "Step '$Label' failed (exit $code): $text"
  }
  if ($output) { $output | ForEach-Object { Write-Host "          $_" } }
}

Write-Host "=== Starlight GCP + WIF Bootstrap ==="
Write-Host "Mode:      $(if ($Apply) { 'APPLY (live mutation)' } else { 'DRY-RUN (no GCP changes)' })"
Write-Host "Project:   $ProjectId"
Write-Host "Region:    $Region"
Write-Host "Cloud Run: $JobName"
Write-Host "WIF Orgs:  $($GitHubOrgs -join ', ')"
Write-Host ""

if ($Apply) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $activeAuth = & $GcloudCmd auth list --filter="status:ACTIVE" --format="value(account)" 2>&1
  $authCode = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($authCode -ne 0 -or -not ($activeAuth | Out-String).Trim()) {
    throw "No active gcloud auth session. Run '$GcloudCmd auth login' first."
  }
  Write-Host "Active gcloud account: $(($activeAuth | Out-String).Trim())"
}

Invoke-GcloudStep -Label "1. Enable required GCP APIs" -GcloudArgs @(
  "services", "enable",
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "cloudbuild.googleapis.com",
  "secretmanager.googleapis.com",
  "iamcredentials.googleapis.com",
  "aiplatform.googleapis.com",
  "billingbudgets.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "2. Create Artifact Registry repository (starlight-fleet)" -IgnoreAlreadyExists -GcloudArgs @(
  "artifacts", "repositories", "create", "starlight-fleet",
  "--repository-format=docker",
  "--location=$Region",
  "--description=Starlight Swarm Autonomous Runner Images",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "3. Create GCS FUSE dependency cache bucket" -IgnoreAlreadyExists -GcloudArgs @(
  "storage", "buckets", "create", "gs://$CacheBucket",
  "--location=$Region",
  "--uniform-bucket-level-access",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "4. Create least-privilege runner service account" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "service-accounts", "create", $ServiceAccountName,
  "--display-name=Starlight Cloud Runner SA",
  "--project=$ProjectId"
)

foreach ($role in @("roles/run.developer", "roles/artifactregistry.writer", "roles/secretmanager.secretAccessor")) {
  Invoke-GcloudStep -Label "5. Grant $role to $ServiceAccountEmail" -GcloudArgs @(
    "projects", "add-iam-policy-binding", $ProjectId,
    "--member=serviceAccount:$ServiceAccountEmail",
    "--role=$role",
    "--condition=None"
  )
}

Invoke-GcloudStep -Label "6. Scope storage.objectAdmin to cache bucket only" -GcloudArgs @(
  "storage", "buckets", "add-iam-policy-binding", "gs://$CacheBucket",
  "--member=serviceAccount:$ServiceAccountEmail",
  "--role=roles/storage.objectAdmin"
)

Invoke-GcloudStep -Label "7. Create Workload Identity Pool ($PoolId)" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "workload-identity-pools", "create", $PoolId,
  "--location=global",
  "--display-name=Starlight GitHub Actions Pool",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "8. Create OIDC Provider ($ProviderId) scoped to allowed GitHub orgs" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "workload-identity-pools", "providers", "create-oidc", $ProviderId,
  "--location=global",
  "--workload-identity-pool=$PoolId",
  "--display-name=GitHub Actions OIDC",
  "--issuer-uri=https://token.actions.githubusercontent.com",
  "--attribute-mapping=google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner",
  "--attribute-condition=$OrgCondition",
  "--project=$ProjectId"
)

Write-Host ""
Write-Host "=== Post-Bootstrap Manual / Secret Steps (Never Automated With Inline Secrets) ==="
Write-Host "1. Bind WIF principalSet to $ServiceAccountEmail after retrieving PROJECT_NUMBER:"
Write-Host "   gcloud projects describe $ProjectId --format='value(projectNumber)'"
Write-Host "   gcloud iam service-accounts add-iam-policy-binding $ServiceAccountEmail --project=$ProjectId --role=roles/iam.workloadIdentityUser --member=principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/$PoolId/attribute.repository_owner/Starlight-Intelligence"
Write-Host "2. Set Secret Manager entries (read from stdin/file, never shell history):"
Write-Host "   gcloud secrets create STARLIGHT_RUNNER_SECRET --project=$ProjectId"
Write-Host "   gcloud secrets create GITHUB_TOKEN --project=$ProjectId"
Write-Host "3. Set a monthly billing budget alert in GCP Billing Console before deploying Cloud Run Jobs."
Write-Host "4. Deploy container & Cloud Run Job ($JobName) via bash tools/runner/deploy-runner.sh"
