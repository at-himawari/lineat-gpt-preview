# デプロイガイド

このドキュメントでは、Stripe 課金機能を含む LINE チャットボットの完全なデプロイ手順を説明します。

## 目次

1. [前提条件](#前提条件)
2. [データベースマイグレーション](#データベースマイグレーション)
3. [Stripe 設定](#stripe-設定)
4. [環境変数の設定](#環境変数の設定)
5. [AWS へのデプロイ](#aws-へのデプロイ)
6. [Stripe Webhook の設定](#stripe-webhook-の設定)
7. [動作確認](#動作確認)
8. [トラブルシューティング](#トラブルシューティング)
9. [ロールバック手順](#ロールバック手順)

## 前提条件

デプロイを開始する前に、以下が準備されていることを確認してください：

- [ ] AWS アカウント（IAM 権限あり）
- [ ] MySQL データベース（AWS RDS または互換性のあるデータベース）
- [ ] LINE Developers アカウントとチャンネル
- [ ] Google Gemini API キー
- [ ] Stripe アカウント
- [ ] Node.js 18.x 以上
- [ ] AWS CLI 設定済み
- [ ] AWS CDK CLI インストール済み（`npm install -g aws-cdk`）

## データベースマイグレーション

### ステップ 1: 現在のデータベース状態を確認

```bash
# データベースに接続
mysql -h your_db_host -u your_db_user -p your_db_name

# 既存のテーブルを確認
SHOW TABLES;

# usersテーブルの構造を確認
DESCRIBE users;
```

### ステップ 2: バックアップの作成

**重要**: マイグレーション前に必ずバックアップを作成してください。

```bash
# データベース全体のバックアップ
mysqldump -h your_db_host -u your_db_user -p your_db_name > backup_$(date +%Y%m%d_%H%M%S).sql

# 特定のテーブルのみバックアップ
mysqldump -h your_db_host -u your_db_user -p your_db_name users conversations > backup_users_conversations_$(date +%Y%m%d_%H%M%S).sql
```

### ステップ 3: 初期スキーマの適用（新規デプロイの場合）

新規デプロイの場合のみ実行：

```bash
mysql -h your_db_host -u your_db_user -p your_db_name < database/schema.sql
```

### ステップ 4: Stripe 課金機能のマイグレーション

```bash
# マイグレーションファイルの内容を確認
cat database/migration_add_stripe_billing.sql

# マイグレーションを実行
mysql -h your_db_host -u your_db_user -p your_db_name < database/migration_add_stripe_billing.sql
```

このマイグレーションは以下を実行します：

1. `users` テーブルに新しいカラムを追加：

   - `has_premium_model`: プレミアムモデルアクセスフラグ
   - `premium_activated_at`: プレミアムモデル有効化日時
   - `message_count_3days` のデフォルト値を 300 に変更

2. `transactions` テーブルを作成：
   - 決済履歴を記録するテーブル
   - セッション ID、ユーザー ID、商品タイプ、金額、ステータスなど

### ステップ 5: メッセージ制限の更新

既存ユーザーの枠を 100 から 300 に更新：

```bash
mysql -h your_db_host -u your_db_user -p your_db_name < database/migration_add_message_limit.sql
```

### ステップ 6: マイグレーション結果の確認

```bash
mysql -h your_db_host -u your_db_user -p your_db_name
```

```sql
-- usersテーブルの構造を確認
DESCRIBE users;

-- 新しいカラムが追加されていることを確認
-- has_premium_model, premium_activated_at が存在するはず

-- transactionsテーブルが作成されていることを確認
DESCRIBE transactions;

-- 既存ユーザーの枠が更新されていることを確認
SELECT user_id, message_count_3days, has_premium_model FROM users LIMIT 10;
```

## Stripe 設定

### ステップ 1: Stripe アカウントの作成

1. https://stripe.com にアクセス
2. アカウントを作成（まだの場合）
3. ビジネス情報を入力

### ステップ 2: API キーの取得

1. Stripe Dashboard にログイン
2. **Developers** → **API keys** に移動
3. 以下のキーをコピー：
   - **Secret key**: `sk_test_...`（テスト環境）または `sk_live_...`（本番環境）
   - **Publishable key**: `pk_test_...` または `pk_live_...`

**注意**: テスト環境で動作確認してから本番環境に移行してください。

### ステップ 3: 商品と価格の作成

#### メッセージ枠拡張商品

1. Dashboard → **Products** → **Add product**
2. 商品情報を入力：
   - **Name**: メッセージ枠拡張（300 件）
   - **Description**: 3 日間で使える追加メッセージ 300 件
3. 価格を設定：
   - **Price**: 500（円）
   - **Billing period**: One time
   - **Currency**: JPY
4. **Save product** をクリック
5. **Price ID** をコピー（例: `price_1234567890abcdef`）

#### プレミアムモデル商品（サブスクリプション）

1. Dashboard → **Products** → **Add product**
2. 商品情報を入力：
   - **Name**: プレミアムモデルアップグレード
   - **Description**: より高度な AI モデル（Gemini Pro）へのアクセス（月額サブスクリプション）
3. 価格を設定：
   - **Price**: 1000（円）
   - **Billing period**: Monthly（毎月）← **重要：サブスクリプション**
   - **Currency**: JPY
4. **Save product** をクリック
5. **Price ID** をコピー（例: `price_0987654321fedcba`）

**注意**: プレミアムモデルは毎月課金のサブスクリプションです。メッセージ枠拡張は買い切り（One time）です。

### ステップ 4: テストモードの確認

Dashboard の左上で **Test mode** が有効になっていることを確認してください。本番環境へのデプロイ前に、必ずテストモードで動作確認を行います。

## 環境変数の設定

### ローカル開発環境

`.env` ファイルを作成（`.env.example` をコピー）：

```bash
cp .env.example .env
```

`.env` ファイルを編集：

```bash
# LINE Bot設定
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_CHANNEL_SECRET=your_line_channel_secret

# Google Gemini API設定
GEMINI_API_KEY=your_gemini_api_key
GEMINI_BASIC_MODEL=gemini-2.0-flash-exp
GEMINI_PREMIUM_MODEL=gemini-2.0-flash-thinking-exp-01-21
GEMINI_MAX_TOKENS=8000
GEMINI_TEMPERATURE=1
GEMINI_RESPONSE_CHAR_LIMIT=500

# MySQL設定
DB_HOST=your_mysql_host
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_database_name

# Stripe設定（テストモード）
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_QUOTA_PRICE_ID=price_your_quota_price_id
STRIPE_PREMIUM_PRICE_ID=price_your_premium_price_id
STRIPE_SUCCESS_URL=https://your-success-url.com
STRIPE_CANCEL_URL=https://your-cancel-url.com

# デバッグ設定
SKIP_SIGNATURE_VALIDATION=false
```

### AWS Systems Manager Parameter Store

本番環境では、環境変数を AWS Systems Manager Parameter Store に保存します：

```bash
# LINE設定
aws ssm put-parameter --name "/linechatbot/line/channel-access-token" --value "your_token" --type "SecureString"
aws ssm put-parameter --name "/linechatbot/line/channel-secret" --value "your_secret" --type "SecureString"

# Gemini設定
aws ssm put-parameter --name "/linechatbot/gemini/api-key" --value "your_api_key" --type "SecureString"
aws ssm put-parameter --name "/linechatbot/gemini/basic-model" --value "gemini-2.0-flash-exp" --type "String"
aws ssm put-parameter --name "/linechatbot/gemini/premium-model" --value "gemini-2.0-flash-thinking-exp-01-21" --type "String"

# MySQL設定
aws ssm put-parameter --name "/linechatbot/db/host" --value "your_db_host" --type "String"
aws ssm put-parameter --name "/linechatbot/db/user" --value "your_db_user" --type "String"
aws ssm put-parameter --name "/linechatbot/db/password" --value "your_db_password" --type "SecureString"
aws ssm put-parameter --name "/linechatbot/db/name" --value "your_db_name" --type "String"

# Stripe設定
aws ssm put-parameter --name "/linechatbot/stripe/secret-key" --value "sk_test_your_key" --type "SecureString"
aws ssm put-parameter --name "/linechatbot/stripe/publishable-key" --value "pk_test_your_key" --type "String"
aws ssm put-parameter --name "/linechatbot/stripe/webhook-secret" --value "whsec_your_secret" --type "SecureString"
aws ssm put-parameter --name "/linechatbot/stripe/quota-price-id" --value "price_your_id" --type "String"
aws ssm put-parameter --name "/linechatbot/stripe/premium-price-id" --value "price_your_id" --type "String"
aws ssm put-parameter --name "/linechatbot/stripe/success-url" --value "https://your-url.com" --type "String"
aws ssm put-parameter --name "/linechatbot/stripe/cancel-url" --value "https://your-url.com" --type "String"
```

**注意**: `STRIPE_WEBHOOK_SECRET` は後で設定します（Webhook エンドポイント作成後）。

## AWS へのデプロイ

### ステップ 1: 依存関係のインストール

```bash
# ルートディレクトリ
npm install

# srcディレクトリ
cd src
npm install
cd ..
```

### ステップ 2: TypeScript のコンパイル

```bash
npm run build
```

### ステップ 3: CDK Bootstrap（初回のみ）

```bash
npx cdk bootstrap
```

### ステップ 4: デプロイ前の確認

```bash
# CloudFormationテンプレートを生成
npm run synth

# 変更内容を確認
npm run diff
```

以下の変更が表示されるはずです：

- 新しい Lambda 関数: `StripeWebhookHandler`
- 新しい API Gateway エンドポイント: `/stripe/webhook`
- 環境変数の追加

### ステップ 5: デプロイ実行

```bash
npm run deploy
```

デプロイが完了すると、以下の情報が出力されます：

```
Outputs:
LineChatbotStack.LineWebhookUrl = https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/webhook
LineChatbotStack.StripeWebhookUrl = https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/stripe/webhook
```

**重要**: これらの URL をメモしてください。

### ステップ 6: デプロイ結果の確認

```bash
# スタックの状態を確認
aws cloudformation describe-stacks --stack-name LineChatbotStack

# Lambda関数を確認
aws lambda list-functions | grep -E "LineWebhook|StripeWebhook"

# API Gatewayエンドポイントを確認
aws apigateway get-rest-apis
```

## Stripe Webhook の設定

### ステップ 1: Webhook エンドポイントの登録

1. Stripe Dashboard → **Developers** → **Webhooks**
2. **Add endpoint** をクリック
3. 以下を入力：
   - **Endpoint URL**: デプロイ時に出力された `StripeWebhookUrl`
     ```
     https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/stripe/webhook
     ```
   - **Description**: LINE Chatbot Payment Webhook
4. **Select events to listen to** で以下を選択：
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. **Add endpoint** をクリック

### ステップ 2: Webhook Signing Secret の取得

1. 作成した Webhook エンドポイントをクリック
2. **Signing secret** セクションで **Reveal** をクリック
3. Secret をコピー（`whsec_...` で始まる文字列）

### ステップ 3: Webhook Secret の設定

```bash
# AWS Systems Manager Parameter Storeに保存
aws ssm put-parameter \
  --name "/linechatbot/stripe/webhook-secret" \
  --value "whsec_your_actual_secret" \
  --type "SecureString" \
  --overwrite

# または.envファイルを更新（ローカル開発の場合）
# STRIPE_WEBHOOK_SECRET=whsec_your_actual_secret
```

### ステップ 4: 再デプロイ

Webhook secret を反映するために再デプロイ：

```bash
npm run deploy
```

### ステップ 5: Webhook のテスト

Stripe Dashboard で Webhook をテスト：

1. Webhook エンドポイントの詳細ページに移動
2. **Send test webhook** をクリック
3. イベントタイプ: `checkout.session.completed`
4. **Send test webhook** をクリック
5. レスポンスが `200 OK` であることを確認

## 動作確認

### ステップ 1: LINE Bot の設定

1. LINE Developers Console にログイン
2. チャンネルを選択
3. **Messaging API** タブに移動
4. **Webhook URL** にデプロイ時の `LineWebhookUrl` を設定
5. **Webhook の利用** を有効化
6. **検証** をクリックして接続を確認

### ステップ 2: 基本機能のテスト

LINE で Bot にメッセージを送信：

```
こんにちは
```

期待される動作：

- Bot が応答を返す
- 残り枠が 299 になる

### ステップ 3: 枠確認コマンドのテスト

```
枠
```

期待される動作：

- 現在の残り枠数が表示される
- 次のリセット日時が表示される

### ステップ 4: 料金確認コマンドのテスト

```
料金
```

期待される動作：

- メッセージ枠拡張の価格が表示される
- プレミアムモデルの価格が表示される

### ステップ 5: プレミアムモデル情報のテスト

```
プレミアム
```

期待される動作：

- プレミアムモデルの説明が表示される
- 決済リンクが表示される

### ステップ 6: 決済フローのテスト（テストモード）

1. データベースで枠を 0 に設定：

```sql
UPDATE users SET message_count_3days = 0 WHERE line_user_id = 'your_test_user_id';
```

2. LINE でメッセージを送信

期待される動作：

- 決済リンクが送信される

3. 決済リンクをクリック

期待される動作：

- Stripe Checkout ページが開く
- テストカード番号で決済可能

4. テストカード情報を入力：

```
カード番号: 4242 4242 4242 4242
有効期限: 12/34
CVC: 123
郵便番号: 123-4567
```

5. 決済を完了

期待される動作：

- 決済が成功
- Webhook が呼ばれる
- 枠が 300 に更新される

6. データベースで確認：

```sql
-- 枠が更新されていることを確認
SELECT user_id, message_count_3days FROM users WHERE line_user_id = 'your_test_user_id';

-- トランザクションが記録されていることを確認
SELECT * FROM transactions WHERE user_id = (SELECT id FROM users WHERE line_user_id = 'your_test_user_id') ORDER BY created_at DESC LIMIT 1;
```

### ステップ 7: プレミアムモデルのテスト（サブスクリプション）

1. プレミアムモデルを購入（上記の手順と同様）

2. データベースで確認：

```sql
SELECT user_id, has_premium_model, premium_activated_at, stripe_customer_id, stripe_subscription_id, subscription_status FROM users WHERE line_user_id = 'your_test_user_id';
```

期待される結果：

- `has_premium_model`: 1
- `subscription_status`: 'active'
- `stripe_customer_id`: 'cus\_...'
- `stripe_subscription_id`: 'sub\_...'

3. LINE でメッセージを送信

期待される動作：

- プレミアムモデル（Gemini Pro）が使用される
- より高度な応答が返される

4. サブスクリプション解約のテスト：

Stripe Dashboard で：

- Customers → 該当顧客を選択
- Subscriptions → Cancel subscription

データベースで確認：

```sql
SELECT subscription_status, has_premium_model FROM users WHERE line_user_id = 'your_test_user_id';
```

期待される結果：

- `subscription_status`: 'canceled'
- `has_premium_model`: 0（プレミアムアクセスが無効化）

### ステップ 8: ログの確認

CloudWatch Logs でログを確認：

```bash
# LINE Webhook Handlerのログ
aws logs tail /aws/lambda/LineChatbotStack-LineWebhookHandler --follow

# Stripe Webhook Handlerのログ
aws logs tail /aws/lambda/LineChatbotStack-StripeWebhookHandler --follow
```

## トラブルシューティング

### 問題 1: Webhook が 401 エラーを返す

**原因**: Webhook 署名検証の失敗

**解決方法**:

1. Stripe Dashboard で Webhook secret を確認
2. AWS Systems Manager Parameter Store の値を確認：

```bash
aws ssm get-parameter --name "/linechatbot/stripe/webhook-secret" --with-decryption
```

3. 値が一致しない場合は更新して再デプロイ

### 問題 2: 枠が更新されない

**原因**: データベース接続エラーまたはトランザクション失敗

**解決方法**:

1. CloudWatch Logs でエラーを確認
2. データベース接続情報を確認
3. `transactions` テーブルでステータスを確認：

```sql
SELECT * FROM transactions WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10;
```

4. エラーログを確認して原因を特定

### 問題 3: プレミアムモデルが有効化されない

**原因**: 商品タイプの不一致

**解決方法**:

1. Stripe Checkout セッションのメタデータを確認
2. `product_type` が `model_upgrade` になっているか確認
3. Webhook ハンドラーのログを確認

### 問題 4: Lambda がタイムアウトする

**原因**: データベースクエリが遅い、または外部 API 呼び出しが遅い

**解決方法**:

1. Lambda のタイムアウト設定を増やす（CDK スタックで設定）
2. データベースのインデックスを確認
3. 不要なクエリを削減

### 問題 5: 決済リンクが生成されない

**原因**: Stripe API キーの問題または価格 ID の不一致

**解決方法**:

1. Stripe API キーが正しいか確認
2. 価格 ID が正しいか確認：

```bash
aws ssm get-parameter --name "/linechatbot/stripe/quota-price-id"
aws ssm get-parameter --name "/linechatbot/stripe/premium-price-id"
```

3. Stripe Dashboard で価格 ID を確認

## ロールバック手順

問題が発生した場合のロールバック手順：

### データベースのロールバック

```bash
# バックアップから復元
mysql -h your_db_host -u your_db_user -p your_db_name < backup_YYYYMMDD_HHMMSS.sql
```

### AWS スタックのロールバック

```bash
# 前のバージョンにロールバック
aws cloudformation update-stack \
  --stack-name LineChatbotStack \
  --use-previous-template

# または完全に削除して再デプロイ
npm run destroy
npm run deploy
```

### 段階的ロールバック

1. Stripe Webhook を無効化（Dashboard で）
2. Lambda 関数を前のバージョンに戻す
3. データベースを復元
4. 動作確認後、Webhook を再有効化

## 本番環境への移行

テスト環境で動作確認が完了したら、本番環境に移行：

### ステップ 1: Stripe を本番モードに切り替え

1. Stripe Dashboard で **Test mode** を無効化
2. 本番環境の API キーを取得
3. 本番環境の商品と価格を作成
4. 本番環境の Webhook を設定

### ステップ 2: 環境変数を更新

```bash
# 本番環境のStripe設定に更新
aws ssm put-parameter --name "/linechatbot/stripe/secret-key" --value "sk_live_your_key" --type "SecureString" --overwrite
aws ssm put-parameter --name "/linechatbot/stripe/publishable-key" --value "pk_live_your_key" --type "String" --overwrite
# ... 他の設定も更新
```

### ステップ 3: 再デプロイ

```bash
npm run deploy
```

### ステップ 4: 本番環境での動作確認

少額の実際の決済でテストを実行し、すべてが正常に動作することを確認してください。

## 監視とメンテナンス

### CloudWatch アラームの設定

```bash
# Lambda エラー率のアラーム
aws cloudwatch put-metric-alarm \
  --alarm-name LineChatbot-Lambda-Errors \
  --alarm-description "Alert when Lambda error rate is high" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold

# Stripe Webhook 失敗のアラーム
aws cloudwatch put-metric-alarm \
  --alarm-name LineChatbot-Stripe-Webhook-Failures \
  --alarm-description "Alert when Stripe webhook failures occur" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --dimensions Name=FunctionName,Value=LineChatbotStack-StripeWebhookHandler \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

### 定期的なメンテナンス

- **毎日**: CloudWatch Logs でエラーを確認
- **毎週**: データベースのバックアップを確認
- **毎月**: Stripe の決済レポートを確認
- **四半期ごと**: 依存関係のアップデート（`npm update`）

## サポート

問題が解決しない場合：

1. CloudWatch Logs を確認
2. Stripe Dashboard のログを確認
3. データベースのトランザクションログを確認
4. GitHub Issues で報告

---

**最終更新**: 2024 年 1 月
