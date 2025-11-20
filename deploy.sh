#!/bin/bash

# .envファイルから環境変数を読み込む
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# CDKデプロイ
npm run deploy
