# サブスクリプション対応への移行ガイド

このドキュメントでは、プレミアムモデルを買い切りから月額サブスクリプションに変更するための移行手順を説明します。

## 変更内容の概要

### 変更前（買い切り）

- プレミアムモデル: 1 回限りの支払い（1,000 円）
- 一度購入すれば永続的にアクセス可能

### 変更後（サブスクリプション）

- プレミアムモデル: 月額 1,400 円
- 毎月自動更新
- 支払い失敗時はアクセス停止
- いつでも解約可能

## 移行手順

### 1. データベースマイグレーション

既存のデータベースに新しいカラムを追加します。

```bash
# マイグレーションを実行
mysql -h your_db_host -u your_db_user -p your_db_name < database/migration_add_subscription_support.sql
```

このマイグレーションは以下を実行します：

**users テーブルに追加されるカラム:**

- `stripe_customer_id`: Stripe カスタマー ID
- `stripe_subscription_id`: Stripe サブスクリプション ID
- `subscription_status`: サブスクリプションステータス（active, canceled, past_due, unpaid, trialing）
- `subscription_current_period_end`: 現在の課金期間終了日

**transactions テーブルに追加されるカラム:**

- `stripe_customer_id`: Stripe カスタマー ID
- `stripe_subscription_id`: Stripe サブスクリプション ID

### 2. Stripe 商品の作成

#### 新しいプレミアムモデル商品を作成

1. Stripe Dashboard → Products → Add product
2. 商品情報を入力：
   ```
   Name: プレミアムモデルアップグレード（月額）
   Description: より高度なAIモデル（Gemini Pro）へのアクセス（月額サブスクリプション）
   ```
3. 価格を設定：
   ```
   Price: 1000
   Currency: JPY
   Billing period: Monthly ← 重要！
   ```
4. Save product
5. Price ID をコピー（例: `price_new_subscription_id`）

#### 環境変数を更新

```bash
# 新しいPrice IDに更新
STRIPE_PREMIUM_PRICE_ID=price_new_subscription_id
```

または AWS Systems Manager Parameter Store:

```bash
aws ssm put-parameter \
  --name "/linechatbot/stripe/premium-price-id" \
  --value "price_new_subscription_id" \
  --type "String" \
  --overwrite
```

### 3. Stripe Webhook イベントの追加

既存の Webhook エンドポイントに新しいイベントを追加します。

1. Stripe Dashboard → Developers → Webhooks
2. 既存のエンドポイントをクリック
3. "Add events" をクリック
4. 以下のイベントを追加：
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Save

### 4. コードのデプロイ

更新されたコードをデプロイします。

```bash
# 依存関係の更新
npm install

# ビルド
npm run build

# デプロイ
npm run deploy
```

### 5. 既存ユーザーの移行（オプション）

既に買い切りでプレミアムモデルを購入しているユーザーがいる場合、以下の選択肢があります：

#### オプション 1: 既存ユーザーは買い切りのまま維持

既存ユーザーのプレミアムアクセスを維持し、新規ユーザーのみサブスクリプションにする場合：

```sql
-- 既存のプレミアムユーザーのsubscription_statusを'active'に設定
UPDATE users
SET subscription_status = 'active'
WHERE has_premium_model = TRUE
AND stripe_subscription_id IS NULL;
```

この場合、既存ユーザーは引き続きプレミアムモデルを使用できます。

#### オプション 2: 既存ユーザーをサブスクリプションに移行

既存ユーザーにサブスクリプションへの移行を促す場合：

1. 既存ユーザーに通知を送信
2. 一定期間後にプレミアムアクセスを無効化
3. サブスクリプション購入を促す

```sql
-- 既存のプレミアムユーザーのアクセスを無効化（移行期間後）
UPDATE users
SET has_premium_model = FALSE,
    subscription_status = NULL
WHERE has_premium_model = TRUE
AND stripe_subscription_id IS NULL;
```

### 6. 動作確認

#### テスト 1: 新規サブスクリプション購入

1. LINE で「プレミアム」と送信
2. 決済リンクをクリック
3. テストカードで決済完了
4. データベースで確認：

```sql
SELECT
  line_user_id,
  has_premium_model,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status
FROM users
WHERE line_user_id = 'test_user_id';
```

期待される結果：

- `has_premium_model`: 1
- `stripe_customer_id`: 'cus\_...'
- `stripe_subscription_id`: 'sub\_...'
- `subscription_status`: 'active'

#### テスト 2: 毎月の支払い成功

Stripe Dashboard で手動で invoice を作成してテスト：

1. Customers → 該当顧客
2. Subscriptions → Create invoice
3. Webhook が正常に処理されることを確認

#### テスト 3: 支払い失敗

Stripe Dashboard でテストカードを失敗するカードに変更：

1. Customers → 該当顧客
2. Payment methods → Update
3. テスト失敗カード: `4000000000000341`
4. 次回請求時に失敗することを確認
5. データベースで `subscription_status` が `past_due` になることを確認

#### テスト 4: サブスクリプション解約

1. Stripe Dashboard → Customers → 該当顧客
2. Subscriptions → Cancel subscription
3. データベースで確認：

```sql
SELECT
  has_premium_model,
  subscription_status
FROM users
WHERE line_user_id = 'test_user_id';
```

期待される結果：

- `has_premium_model`: 0
- `subscription_status`: 'canceled'

### 7. 監視とアラート

サブスクリプション関連のイベントを監視するために、CloudWatch Logs を確認します：

```bash
# Stripe Webhook Handlerのログを確認
aws logs tail /aws/lambda/LineChatbotStack-StripeWebhookHandler --follow

# 特定のイベントを検索
aws logs filter-pattern /aws/lambda/LineChatbotStack-StripeWebhookHandler \
  --filter-pattern "subscription"
```

### 8. ロールバック手順

問題が発生した場合のロールバック：

1. **環境変数を元に戻す**:

   ```bash
   # 古いPrice IDに戻す
   STRIPE_PREMIUM_PRICE_ID=price_old_onetime_id
   ```

2. **コードを前のバージョンにロールバック**:

   ```bash
   git revert HEAD
   npm run deploy
   ```

3. **データベースは変更不要**:
   - 新しいカラムは NULL 許容なので、古いコードでも動作します

## トラブルシューティング

### 問題 1: サブスクリプションが作成されない

**原因**: Price ID が間違っている、または Billing period が Monthly になっていない

**解決方法**:

1. Stripe Dashboard で Price ID を確認
2. Billing period が Monthly であることを確認
3. 環境変数を更新して再デプロイ

### 問題 2: Webhook イベントが処理されない

**原因**: Webhook エンドポイントに新しいイベントが登録されていない

**解決方法**:

1. Stripe Dashboard → Developers → Webhooks
2. エンドポイントをクリック
3. 必要なイベントがすべて登録されているか確認
4. 登録されていない場合は追加

### 問題 3: 既存ユーザーのプレミアムアクセスが無効化される

**原因**: `subscription_status` が NULL のため、アクセスチェックで失敗

**解決方法**:

```sql
-- 既存ユーザーのステータスを'active'に設定
UPDATE users
SET subscription_status = 'active'
WHERE has_premium_model = TRUE
AND subscription_status IS NULL;
```

## まとめ

この移行により、以下のメリットが得られます：

1. **継続的な収益**: 毎月の課金により安定した収益
2. **柔軟な価格設定**: 将来的に異なるプランを追加可能
3. **ユーザー管理**: サブスクリプション状態の追跡が容易
4. **自動更新**: 手動での更新が不要

移行後は、Stripe Dashboard でサブスクリプションの状態を定期的に確認し、支払い失敗やキャンセルに適切に対応してください。
