<#
.SYNOPSIS
Idempotent, dry-run-by-default GCP + Workload Identity Federation bootstrap for Starlight Cloud Runner.
Built on SIP v1.1.1.

.EXAMPLE
.\tools\runner\bootstrap-gcp-wif.ps1
  Prints all commands that would run without mutating GCP.

.EXAMPLE
.\tools\runner\bootstrap-gcp-wif.ps1 -ProjectId "starlight-intelligence" -Region "europe-west4" -Apply
  Applies API enablement, Artifact Registry, split deployer vs execution SAs, WIF pool/provider, and runner secret scoping.
#>
[CmdletBinding()]
param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "starlight-intelligence" }),
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "europe-west4" }),
  [string]$JobName = $(if ($env:CLOUD_RUN_JOB) { $env:CLOUD_RUN_JOB } else { "starlight-runner-job" }),
  [string[]]$GitHubRepos = @("Starlight-Intelligence/Starlight-Intelligence-System"),
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
# Split deployer identity (WIF / Cloud Build / Cloud Run dispatch) from runtime execution identity.
$DeployerSaName = "starlight-runner-sa"
$DeployerSaEmail = "$DeployerSaName@$ProjectId.iam.gserviceaccount.com"
$ExecSaName = "starlight-runner-exec-sa"
$ExecSaEmail = "$ExecSaName@$ProjectId.iam.gserviceaccount.com"
$RepoCondition = ($GitHubRepos | ForEach-Object { "assertion.repository=='$_'" }) -join " || "

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
  $maxAttempts = 4
  $output = $null
  $code = 1
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $output = & $GcloudCmd @GcloudArgs 2>&1
    $code = $LASTEXITCODE
    if ($code -eq 0) { break }
    $text = ($output | Out-String)
    if ($IgnoreAlreadyExists -and $text -match "ALREADY_EXISTS|already exists|already\s+own\s+it|HTTPError 409") {
      Write-Host "          Already exists; continuing." -ForegroundColor DarkGray
      $ErrorActionPreference = $prevEap
      return
    }
    if ($attempt -lt $maxAttempts -and $text -match "does not exist") {
      Write-Host "          Waiting 5s for GCP IAM propagation (attempt $attempt/$maxAttempts)..." -ForegroundColor DarkGray
      Start-Sleep -Seconds 5
      continue
    }
    $ErrorActionPreference = $prevEap
    throw "Step '$Label' failed (exit $code): $text"
  }
  $ErrorActionPreference = $prevEap
  if ($output) { $output | ForEach-Object { Write-Host "          $_" } }
}

Write-Host "=== Starlight GCP + WIF Bootstrap ==="
Write-Host "Mode:      $(if ($Apply) { 'APPLY (live mutation)' } else { 'DRY-RUN (no GCP changes)' })"
Write-Host "Project:   $ProjectId"
Write-Host "Region:    $Region"
Write-Host "Cloud Run: $JobName"
Write-Host "WIF Repos: $($GitHubRepos -join ', ')"
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

Invoke-GcloudStep -Label "3. Create deployer service account (WIF / dispatch only)" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "service-accounts", "create", $DeployerSaName,
  "--display-name=Starlight Cloud Runner Deployer SA",
  "--project=$ProjectId"
)

foreach ($role in @("roles/run.developer", "roles/artifactregistry.writer")) {
  Invoke-GcloudStep -Label "4. Grant $role to $DeployerSaEmail" -GcloudArgs @(
    "projects", "add-iam-policy-binding", $ProjectId,
    "--member=serviceAccount:$DeployerSaEmail",
    "--role=$role",
    "--condition=None"
  )
}

Invoke-GcloudStep -Label "5. Create isolated Cloud Run execution service account (no project admin roles)" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "service-accounts", "create", $ExecSaName,
  "--display-name=Starlight Cloud Runner Execution SA",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "6. Grant deployer iam.serviceAccountUser on execution SA only" -GcloudArgs @(
  "iam", "service-accounts", "add-iam-policy-binding", $ExecSaEmail,
  "--project=$ProjectId",
  "--member=serviceAccount:$DeployerSaEmail",
  "--role=roles/iam.serviceAccountUser"
)

Invoke-GcloudStep -Label "7. Create Workload Identity Pool ($PoolId)" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "workload-identity-pools", "create", $PoolId,
  "--location=global",
  "--display-name=Starlight GitHub Actions Pool",
  "--project=$ProjectId"
)

Invoke-GcloudStep -Label "8. Create OIDC Provider ($ProviderId) scoped to allowlisted repositories" -IgnoreAlreadyExists -GcloudArgs @(
  "iam", "workload-identity-pools", "providers", "create-oidc", $ProviderId,
  "--location=global",
  "--workload-identity-pool=$PoolId",
  "--display-name=GitHub Actions OIDC",
  "--issuer-uri=https://token.actions.githubusercontent.com",
  "--attribute-mapping=google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner",
  "--attribute-condition=$RepoCondition",
  "--project=$ProjectId"
)

Write-Host ""
Write-Host "=== Post-Bootstrap Manual / Secret Steps (Never Automated With Inline Secrets) ==="
Write-Host "1. Bind WIF principalSet to $DeployerSaEmail scoped to exact repo:"
Write-Host "   gcloud projects describe $ProjectId --format='value(projectNumber)'"
Write-Host "   gcloud iam service-accounts add-iam-policy-binding $DeployerSaEmail --project=$ProjectId --role=roles/iam.workloadIdentityUser --member=principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/$PoolId/attribute.repository/Starlight-Intelligence/Starlight-Intelligence-System"
Write-Host "2. Create STARLIGHT_RUNNER_SECRET and grant secretAccessor on THAT secret only to $ExecSaEmail:"
Write-Host "   gcloud secrets create STARLIGHT_RUNNER_SECRET --project=$ProjectId"
Write-Host "   gcloud secrets add-iam-policy-binding STARLIGHT_RUNNER_SECRET --project=$ProjectId --member=serviceAccount:$ExecSaEmail --role=roles/secretmanager.secretAccessor"
Write-Host "3. Set a monthly billing budget alert in GCP Billing Console before deploying Cloud Run Jobs."
Write-Host "4. Deploy container & Cloud Run Job ($JobName) via bash tools/runner/deploy-runner.sh"
