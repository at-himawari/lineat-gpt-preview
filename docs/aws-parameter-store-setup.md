# AWS Systems Manager Parameter Store セットアップ

このドキュメントでは、Stripe 決済機能に必要な環境変数を AWS Systems Manager Parameter Store に追加する手順を説明します。

## 必要なパラメータ

以下のパラメータを Parameter Store に追加してください：

### Stripe 設定

```bash
# Stripe Secret Key（SecureString推奨）
aws ssm put-parameter \
  --name "/linechatbot/stripe/secret-key" \
  --value "sk_test_your_stripe_secret_key" \
  --type "SecureString" \
  --description "Stripe API Secret Key"

# Stripe Webhook Secret（SecureString推奨）
aws ssm put-parameter \
  --name "/linechatbot/stripe/webhook-secret" \
  --value "whsec_your_webhook_secret" \
  --type "SecureString" \
  --description "Stripe Webhook Secret for signature verification"

# Stripe Quota Price ID
aws ssm put-parameter \
  --name "/linechatbot/stripe/quota-price-id" \
  --value "price_your_quota_price_id" \
  --type "String" \
  --description "Stripe Price ID for message quota extension (300 messages)"

# Stripe Premium Price ID
aws ssm put-parameter \
  --name "/linechatbot/stripe/premium-price-id" \
  --value "price_your_premium_price_id" \
  --type "String" \
  --description "Stripe Price ID for premium model upgrade"

# Stripe Success URL
aws ssm put-parameter \
  --name "/linechatbot/stripe/success-url" \
  --value "https://your-domain.com/success" \
  --type "String" \
  --description "Redirect URL after successful payment"

# Stripe Cancel URL
aws ssm put-parameter \
  --name "/linechatbot/stripe/cancel-url" \
  --value "https://your-domain.com/cancel" \
  --type "String" \
  --description "Redirect URL after cancelled payment"
```

### モデル設定

```bash
# Gemini Basic Model
aws ssm put-parameter \
  --name "/linechatbot/gemini/basic-model" \
  --value "gemini-2.0-flash-exp" \
  --type "String" \
  --description "Gemini model name for basic users"

# Gemini Premium Model
aws ssm put-parameter \
  --name "/linechatbot/gemini/premium-model" \
  --value "gemini-2.0-flash-thinking-exp-01-21" \
  --type "String" \
  --description "Gemini model name for premium users"
```

## パラメータの確認

設定したパラメータを確認するには：

```bash
# すべてのlinechatbotパラメータを一覧表示
aws ssm get-parameters-by-path \
  --path "/linechatbot" \
  --recursive

# 特定のパラメータを取得（SecureStringの値も表示）
aws ssm get-parameter \
  --name "/linechatbot/stripe/secret-key" \
  --with-decryption
```

## Lambda 関数へのアクセス権限

Lambda 関数が Parameter Store にアクセスできるように、IAM ロールに以下のポリシーを追加してください：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:ap-northeast-1:*:parameter/linechatbot/*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "*"
    }
  ]
}
```

## 本番環境への移行

開発環境（テストモード）から本番環境に移行する際は：

1. Stripe ダッシュボードで本番モードに切り替え
2. 本番用の API キーと Webhook シークレットを取得
3. Parameter Store の値を本番用に更新：

```bash
aws ssm put-parameter \
  --name "/linechatbot/stripe/secret-key" \
  --value "sk_live_your_production_key" \
  --type "SecureString" \
  --overwrite
```

## セキュリティのベストプラクティス

- **SecureString**: 機密情報（API キー、シークレット）は必ず SecureString タイプを使用
- **アクセス制限**: IAM ポリシーで必要最小限のアクセス権限のみを付与
- **監査ログ**: CloudTrail で Parameter Store へのアクセスを監視
- **定期的なローテーション**: API キーとシークレットを定期的に更新

## トラブルシューティング

### Lambda 関数がパラメータにアクセスできない

1. IAM ロールに適切な権限があるか確認
2. パラメータ名が正しいか確認（大文字小文字を区別）
3. リージョンが一致しているか確認

### Webhook 署名検証が失敗する

1. Webhook Secret が正しく設定されているか確認
2. Stripe ダッシュボードで Webhook URL が正しく登録されているか確認
3. CloudWatch Logs でエラーメッセージを確認
