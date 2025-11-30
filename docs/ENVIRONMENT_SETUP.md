# 環境別デプロイガイド

このドキュメントでは、テスト環境（dev）と本番環境（prod）を分けてデプロイする方法を説明します。

## 概要

このプロジェクトは、以下の 2 つの環境を独立して管理できます：

- **テスト環境（dev）**: 開発・テスト用の環境
- **本番環境（prod）**: 実際のユーザーが使用する本番環境

各環境は完全に独立した AWS リソース（Lambda、API Gateway、CloudWatch Logs など）を持ちます。

## 環境の違い

### リソース名

各環境のリソースには環境名が付与されます：

| リソース              | テスト環境                             | 本番環境                                |
| --------------------- | -------------------------------------- | --------------------------------------- |
| スタック名            | `LineChatbotStack-dev`                 | `LineChatbotStack-prod`                 |
| Lambda 関数（LINE）   | `line-chatbot-webhook-dev`             | `line-chatbot-webhook-prod`             |
| Lambda 関数（Stripe） | `stripe-webhook-handler-dev`           | `stripe-webhook-handler-prod`           |
| API Gateway           | `LINE Chatbot API (dev)`               | `LINE Chatbot API (prod)`               |
| CloudWatch Logs       | `/aws/lambda/line-chatbot-webhook-dev` | `/aws/lambda/line-chatbot-webhook-prod` |

### 設定ファイル

各環境は独自の設定ファイルを使用します：

- **テスト環境**: `.env.dev`
- **本番環境**: `.env.prod`

## セットアップ手順

### 1. 環境設定ファイルの作成

サンプルファイルをコピーして、各環境の設定ファイルを作成します：

```bash
# テスト環境用
cp .env.dev.example .env.dev

# 本番環境用
cp .env.prod.example .env.prod
```

### 2. 環境変数の設定

#### テスト環境（.env.dev）

```bash
# LINE Bot設定（テスト用チャンネル）
LINE_CHANNEL_ACCESS_TOKEN=your_dev_line_channel_access_token
LINE_CHANNEL_SECRET=your_dev_line_channel_secret

# Stripe設定（テストモード）
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_QUOTA_PRICE_ID=price_test_...
STRIPE_PREMIUM_PRICE_ID=price_test_...

# MySQL設定（テスト用データベース）
DB_HOST=your_dev_mysql_host
DB_NAME=lineat_gpt_test

# デバッグ設定（署名検証をスキップ可能）
SKIP_SIGNATURE_VALIDATION=true
```

#### 本番環境（.env.prod）

```bash
# LINE Bot設定（本番用チャンネル）
LINE_CHANNEL_ACCESS_TOKEN=your_prod_line_channel_access_token
LINE_CHANNEL_SECRET=your_prod_line_channel_secret

# Stripe設定（本番モード）
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_QUOTA_PRICE_ID=price_live_...
STRIPE_PREMIUM_PRICE_ID=price_live_...

# MySQL設定（本番用データベース）
DB_HOST=your_prod_mysql_host
DB_NAME=lineat_gpt_prod

# デバッグ設定（本番では必ずfalse）
SKIP_SIGNATURE_VALIDATION=false
```

### 3. データベースの準備

各環境用のデータベースを作成し、スキーマを適用します。

#### データベースの作成

**推奨構成**: テスト環境と本番環境で異なるデータベースを使用

| 環境   | データベース名      | 推奨ホスト         |
| ------ | ------------------- | ------------------ |
| テスト | `line_chatbot_dev`  | 開発用 DB サーバー |
| 本番   | `line_chatbot_prod` | 本番用 DB サーバー |

```bash
# テスト環境用データベース作成
mysql -h your_dev_mysql_host -u root -p
CREATE DATABASE line_chatbot_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'chatbot_dev'@'%' IDENTIFIED BY 'your_dev_password';
GRANT ALL PRIVILEGES ON line_chatbot_dev.* TO 'chatbot_dev'@'%';
FLUSH PRIVILEGES;

# 本番環境用データベース作成
mysql -h your_prod_mysql_host -u root -p
CREATE DATABASE line_chatbot_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'chatbot_prod'@'%' IDENTIFIED BY 'your_prod_password';
GRANT ALL PRIVILEGES ON line_chatbot_prod.* TO 'chatbot_prod'@'%';
FLUSH PRIVILEGES;
```

#### スキーマの適用

```bash
# テスト環境
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/schema.sql
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_stripe_billing.sql
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_subscription_support.sql
mysql -h your_dev_mysql_host -u chatbot_dev -p line_chatbot_dev < database/migration_add_message_limit.sql

# 本番環境
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/schema.sql
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_stripe_billing.sql
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_subscription_support.sql
mysql -h your_prod_mysql_host -u chatbot_prod -p line_chatbot_prod < database/migration_add_message_limit.sql
```

**詳細なデータベースセットアップ手順は `docs/DATABASE_SETUP.md` を参照してください。**

## デプロイ方法

### テスト環境へのデプロイ

#### 方法 1: npm スクリプトを使用

```bash
# 差分確認
npm run diff:dev

# デプロイ実行
npm run deploy:dev
```

#### 方法 2: デプロイスクリプトを使用

```bash
./deploy.sh dev
```

### 本番環境へのデプロイ

#### 方法 1: npm スクリプトを使用

```bash
# 差分確認
npm run diff:prod

# デプロイ実行
npm run deploy:prod
```

#### 方法 2: デプロイスクリプトを使用

```bash
./deploy.sh prod
```

## デプロイ後の設定

### 1. Webhook URL の取得

デプロイが完了すると、以下の URL が出力されます：

```
Outputs:
LineChatbotStack-dev.ApiGatewayUrl = https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/
LineChatbotStack-dev.WebhookUrl = https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/webhook
LineChatbotStack-dev.StripeWebhookUrl = https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/stripe/webhook
```

### 2. LINE Bot の設定

各環境の LINE Bot チャンネルに、対応する Webhook URL を設定します：

- **テスト環境**: テスト用チャンネルに`LineChatbotStack-dev`の Webhook URL を設定
- **本番環境**: 本番用チャンネルに`LineChatbotStack-prod`の Webhook URL を設定

### 3. Stripe Webhook の設定

各環境の Stripe アカウント（テストモード/本番モード）に、対応する Webhook URL を設定します：

- **テスト環境**: Stripe テストモードに`LineChatbotStack-dev`の Stripe Webhook URL を設定
- **本番環境**: Stripe 本番モードに`LineChatbotStack-prod`の Stripe Webhook URL を設定

## 環境の削除

### テスト環境の削除

```bash
npm run destroy:dev
```

### 本番環境の削除

```bash
npm run destroy:prod
```

## ベストプラクティス

### 1. テスト環境で検証してから本番へ

新しい機能や変更は、必ずテスト環境で動作確認してから本番環境にデプロイしてください。

```bash
# 1. テスト環境にデプロイ
npm run deploy:dev

# 2. テスト環境で動作確認

# 3. 問題なければ本番環境にデプロイ
npm run deploy:prod
```

### 2. 環境変数の管理

- `.env.dev`と`.env.prod`は`.gitignore`に含まれているため、Git にコミットされません
- 環境変数は安全に管理し、チーム内で共有する場合は暗号化されたストレージを使用してください

### 3. データベースの分離

- テスト環境と本番環境で異なるデータベースを使用してください
- テスト環境のデータが本番環境に影響を与えないようにしてください
- 推奨構成:
  - テスト環境: `line_chatbot_dev`（開発用 DB サーバー）
  - 本番環境: `line_chatbot_prod`（本番用 DB サーバー）
- 詳細は `docs/DATABASE_SETUP.md` を参照してください

### 4. Stripe のテストモードと本番モード

- テスト環境では必ず Stripe のテストモード（`sk_test_`）を使用してください
- 本番環境では必ず Stripe の本番モード（`sk_live_`）を使用してください
- テストモードと本番モードの API キーを混同しないように注意してください

### 5. ログの確認

各環境のログは独立した CloudWatch Logs グループに記録されます：

```bash
# テスト環境のログ
aws logs tail /aws/lambda/line-chatbot-webhook-dev --follow

# 本番環境のログ
aws logs tail /aws/lambda/line-chatbot-webhook-prod --follow
```

## トラブルシューティング

### 環境変数が読み込まれない

デプロイスクリプトが正しい環境変数ファイルを読み込んでいるか確認してください：

```bash
# 環境変数ファイルの存在確認
ls -la .env.dev .env.prod

# ファイルの内容確認
cat .env.dev
```

### スタック名が重複する

環境を指定せずにデプロイすると、デフォルトで`dev`環境としてデプロイされます。明示的に環境を指定してください：

```bash
# 正しい方法
npm run deploy:dev
npm run deploy:prod

# または
./deploy.sh dev
./deploy.sh prod
```

### リソースが見つからない

各環境のリソースは独立しているため、正しい環境名を指定してください：

```bash
# テスト環境のスタック情報
aws cloudformation describe-stacks --stack-name LineChatbotStack-dev

# 本番環境のスタック情報
aws cloudformation describe-stacks --stack-name LineChatbotStack-prod
```

## まとめ

- テスト環境と本番環境は完全に独立した AWS リソースを持ちます
- 各環境は独自の設定ファイル（`.env.dev`、`.env.prod`）を使用します
- デプロイは`npm run deploy:dev`または`npm run deploy:prod`で実行します
- 新しい機能は必ずテスト環境で検証してから本番環境にデプロイしてください

## CI/CD による自動デプロイ

GitHub Actions を使用した環境別の自動デプロイが設定されています。

### ブランチ戦略

- **develop ブランチ**: テスト環境（dev）に自動デプロイ
- **main ブランチ**: 本番環境（prod）に自動デプロイ

### GitHub Secrets の設定

リポジトリの Settings → Secrets and variables → Actions で、環境別のシークレットを設定してください：

#### テスト環境用（DEV\_プレフィックス）

```
DEV_LINE_CHANNEL_ACCESS_TOKEN
DEV_LINE_CHANNEL_SECRET
DEV_DB_HOST
DEV_DB_USER
DEV_DB_PASSWORD
DEV_DB_NAME
DEV_STRIPE_SECRET_KEY (sk_test_...)
DEV_STRIPE_WEBHOOK_SECRET
DEV_STRIPE_QUOTA_PRICE_ID
DEV_STRIPE_PREMIUM_PRICE_ID
DEV_STRIPE_SUCCESS_URL
DEV_STRIPE_CANCEL_URL
DEV_SKIP_SIGNATURE_VALIDATION (true)
```

#### 本番環境用（PROD\_プレフィックス）

```
PROD_LINE_CHANNEL_ACCESS_TOKEN
PROD_LINE_CHANNEL_SECRET
PROD_DB_HOST
PROD_DB_USER
PROD_DB_PASSWORD
PROD_DB_NAME
PROD_STRIPE_SECRET_KEY (sk_live_...)
PROD_STRIPE_WEBHOOK_SECRET
PROD_STRIPE_QUOTA_PRICE_ID
PROD_STRIPE_PREMIUM_PRICE_ID
PROD_STRIPE_SUCCESS_URL
PROD_STRIPE_CANCEL_URL
PROD_SKIP_SIGNATURE_VALIDATION (false)
```

### 自動デプロイの流れ

1. **テスト環境へのデプロイ**

   ```bash
   git checkout develop
   git add .
   git commit -m "Add new feature"
   git push origin develop
   # → 自動的にテスト環境にデプロイ
   ```

2. **本番環境へのデプロイ**

   ```bash
   git checkout main
   git merge develop
   git push origin main
   # → 自動的に本番環境にデプロイ
   ```

3. **手動デプロイ**
   - GitHub の Actions タブから "Deploy to AWS" を選択
   - "Run workflow" をクリック
   - デプロイ先の環境（dev/prod）を選択して実行

## まとめ

- テスト環境と本番環境は完全に独立した AWS リソースを持ちます
- 各環境は独自の設定ファイル（`.env.dev`、`.env.prod`）を使用します
- ローカルデプロイは`npm run deploy:dev`または`npm run deploy:prod`で実行します
- CI/CD では`develop`ブランチがテスト環境、`main`ブランチが本番環境に自動デプロイされます
- 新しい機能は必ずテスト環境で検証してから本番環境にデプロイしてください
