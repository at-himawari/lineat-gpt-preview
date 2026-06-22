#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-at-himawari/lineat-gpt-preview}"

REQUIRED_ENV_KEYS=(
  LINE_CHANNEL_ACCESS_TOKEN
  LINE_CHANNEL_SECRET
  GEMINI_API_KEY
  GEMINI_BASIC_MODEL
  GEMINI_PREMIUM_MODEL
  GEMINI_MAX_TOKENS
  GEMINI_TEMPERATURE
  GEMINI_RESPONSE_CHAR_LIMIT
  DB_HOST
  DB_USER
  DB_PASSWORD
  DB_NAME
  SKIP_SIGNATURE_VALIDATION
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_QUOTA_PRICE_ID
  STRIPE_PREMIUM_PRICE_ID
  STRIPE_SUCCESS_URL
  STRIPE_CANCEL_URL
)

OPTIONAL_ENV_KEYS=(
  GEMINI_MODEL
  GEMINI_ENABLE_SEARCH
  MESSAGE_LIMIT_1DAY
  MESSAGE_LIMIT_1DAY_PREMIUM
  MESSAGE_QUOTA_EXTENSION
  STRIPE_PUBLISHABLE_KEY
)

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

dotenv_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "")
      print
      found=1
      exit
    }
    END {
      if (!found) exit 1
    }
  ' "$file"
}

set_environment_secret() {
  local environment="$1"
  local name="$2"
  local value="$3"

  if [[ -z "$value" ]]; then
    echo "Skip empty environment secret: ${environment}/${name}"
    return
  fi

  gh secret set "$name" --env "$environment" --repo "$REPO" --body "$value" >/dev/null
  echo "Set environment secret: ${environment}/${name}"
}

set_repo_secret() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    echo "Skip empty repository secret: ${name}"
    return
  fi

  gh secret set "$name" --repo "$REPO" --body "$value" >/dev/null
  echo "Set repository secret: ${name}"
}

load_env_file() {
  local environment="$1"
  local file="$2"
  local key value

  if [[ ! -f "$file" ]]; then
    echo "Missing dotenv file: $file" >&2
    exit 1
  fi

  gh api --method PUT "repos/${REPO}/environments/${environment}" >/dev/null

  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if ! value="$(dotenv_value "$file" "$key")"; then
      echo "Missing required key in ${file}: ${key}" >&2
      exit 1
    fi
    set_environment_secret "$environment" "$key" "$value"
  done

  for key in "${OPTIONAL_ENV_KEYS[@]}"; do
    if value="$(dotenv_value "$file" "$key")"; then
      set_environment_secret "$environment" "$key" "$value"
    fi
  done
}

require_command gh
gh auth status >/dev/null
gh repo view "$REPO" >/dev/null

if [[ -n "${AWS_ROLE_ARN:-}" ]]; then
  set_repo_secret AWS_ROLE_ARN "$AWS_ROLE_ARN"
else
  echo "AWS_ROLE_ARN is not set locally; repository secret AWS_ROLE_ARN was not updated." >&2
fi

load_env_file dev .env.test
load_env_file prod .env.prod

echo "GitHub Secrets update completed for ${REPO}."
