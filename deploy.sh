#!/bin/bash

# 環境を引数から取得（デフォルトはdev）
ENVIRONMENT=${1:-dev}

echo "Deploying to environment: $ENVIRONMENT"

# 環境ごとの.envファイルを読み込む
ENV_FILE=".env.${ENVIRONMENT}"
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment variables from $ENV_FILE"
  export $(cat "$ENV_FILE" | grep -v '^#' | xargs)
elif [ -f .env ]; then
  echo "Loading environment variables from .env"
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "Warning: No environment file found"
fi

# 環境変数を設定
export ENVIRONMENT=$ENVIRONMENT

# CDKデプロイ
npm run deploy
