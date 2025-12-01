#!/bin/bash

# 本番環境用データベースセットアップスクリプト

set -e

echo "==================================="
echo "本番環境データベースセットアップ"
echo "==================================="
echo ""
echo "⚠️  警告: 本番環境のデータベースをセットアップします"
echo "⚠️  既存のデータが上書きされる可能性があります"
echo ""
read -p "続行しますか？ (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "セットアップを中止しました"
  exit 0
fi
echo ""

# 環境変数の読み込み
if [ -f .env.prod ]; then
  export $(cat .env.prod | grep -v '^#' | xargs)
else
  echo "エラー: .env.prodファイルが見つかりません"
  exit 1
fi

# 必要な環境変数の確認
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "エラー: 必要な環境変数が設定されていません"
  echo "DB_HOST, DB_USER, DB_PASSWORD, DB_NAME を .env.prod に設定してください"
  exit 1
fi

echo "データベース情報:"
echo "  ホスト: $DB_HOST"
echo "  ユーザー: $DB_USER"
echo "  データベース: $DB_NAME"
echo ""

# データベース接続テスト
echo "データベース接続テスト中..."
if ! mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1" > /dev/null 2>&1; then
  echo "エラー: データベースに接続できません"
  echo "接続情報を確認してください"
  exit 1
fi
echo "✓ 接続成功"
echo ""

# データベースの存在確認
echo "データベースの確認中..."
if mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -e "USE $DB_NAME" > /dev/null 2>&1; then
  echo "✓ データベース '$DB_NAME' が存在します"
  echo ""
  echo "⚠️  既存のデータベースにスキーマを適用します"
  echo "⚠️  バックアップを取得することを強く推奨します"
  echo ""
  read -p "バックアップを取得しましたか？ (yes/no): " backup_confirm
  if [ "$backup_confirm" != "yes" ]; then
    echo ""
    echo "バックアップを取得してから再度実行してください："
    echo "  mysqldump -h $DB_HOST -u $DB_USER -p $DB_NAME > backup_\$(date +%Y%m%d_%H%M%S).sql"
    exit 0
  fi
  echo ""
  read -p "スキーマを適用しますか？ (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "セットアップを中止しました"
    exit 0
  fi
else
  echo "データベース '$DB_NAME' が存在しません"
  read -p "データベースを作成しますか？ (yes/no): " confirm
  if [ "$confirm" = "yes" ]; then
    echo "データベースを作成中..."
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -e "CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    echo "✓ データベース作成完了"
  else
    echo "セットアップを中止しました"
    exit 0
  fi
fi
echo ""

# スキーマの適用
echo "スキーマを適用中..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/schema.sql
echo "✓ 初期スキーマ適用完了"

# マイグレーションの適用
echo ""
echo "マイグレーションを適用中..."

if [ -f database/migration_add_stripe_billing.sql ]; then
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/migration_add_stripe_billing.sql
  echo "✓ Stripe課金機能マイグレーション完了"
fi

if [ -f database/migration_add_subscription_support.sql ]; then
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/migration_add_subscription_support.sql
  echo "✓ サブスクリプション機能マイグレーション完了"
fi

if [ -f database/migration_add_message_limit.sql ]; then
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/migration_add_message_limit.sql
  echo "✓ メッセージ制限マイグレーション完了"
fi

if [ -f database/migration_add_image_support.sql ]; then
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/migration_add_image_support.sql
  echo "✓ 画像サポートマイグレーション完了"
fi

# テーブル確認
echo ""
echo "テーブル一覧:"
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SHOW TABLES"

echo ""
echo "==================================="
echo "セットアップ完了！"
echo "==================================="
echo ""
echo "次のステップ:"
echo "1. アプリケーションをデプロイ: npm run deploy:prod"
echo "2. LINE BotのWebhook URLを設定"
echo "3. Stripe WebhookのURLを設定"
