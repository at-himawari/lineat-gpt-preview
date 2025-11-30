# LINE Bot with Google Gemini and MySQL (AWS CDK)

AWS CDK を使用して AWS Lambda で Google Gemini API に接続し、LINE の API を使って会話できるチャットボットです。ユーザー管理と会話履歴の保存に MySQL を使用します。

## 機能

- LINE Messaging API を使用したチャットボット
- Google Gemini API による自然な会話
- MySQL でのユーザー管理と会話履歴保存（最新 10 件を参照）
- **Stripe 決済統合による 2 段階課金システム**
  - **メッセージ枠拡張**: 3 日間で 300 件のメッセージ制限を超えた場合、追加の 300 件を購入可能（買い切り：500 円）
  - **プレミアムモデルアップグレード**: より高度な AI モデル（Gemini Pro）への月額サブスクリプション（月額 1,000 円）
- **サブスクリプション管理**: 自動更新、解約、支払い失敗時の処理
- **メッセージ使用量追跡**: 残り枠の表示と警告機能
- **トランザクション管理**: 決済履歴の記録と監査
- AWS CDK によるインフラストラクチャ管理（Serverless Framework 不要）
- AWS Lambda でのサーバーレス実行
- 自己署名 SSL 証明書対応
- エラーハンドリング（DB 接続失敗時も AI 応答は継続）

## アーキテクチャ

```text
LINE User → LINE Messaging API → API Gateway → AWS Lambda → Google Gemini API
                                                    ↓
                                                MySQL Database
                                                (会話履歴・決済情報保存)
                                                    ↑
Stripe → Stripe Webhook → API Gateway → AWS Lambda (Stripe Handler)
```

### 課金システムの仕組み

1. **メッセージ枠管理**

   - すべてのユーザーに 3 日間で 300 件のメッセージ枠を提供
   - メッセージ送信ごとに枠を 1 減算
   - 3 日経過後に自動的に 300 件にリセット
   - 枠がゼロになると決済リンクを送信

2. **決済フロー**

   **メッセージ枠拡張（買い切り）:**

   - ユーザーが枠を使い切る
   - システムが Stripe Checkout セッションを作成（payment モード）
   - ユーザーが Stripe で決済を完了（500 円）
   - Stripe が webhook で決済完了を通知
   - システムが枠に 300 件を追加

   **プレミアムモデル（サブスクリプション）:**

   - ユーザーがプレミアムモデルを要求
   - システムが Stripe Checkout セッションを作成（subscription モード）
   - ユーザーが Stripe で決済を完了（月額 1,000 円）
   - Stripe が webhook で決済完了を通知
   - システムがプレミアムモデルを有効化
   - 毎月自動更新（支払い成功/失敗を webhook で処理）

3. **AI モデル選択**

   - 基本ユーザー: Gemini Flash モデル
   - プレミアムユーザー: Gemini Pro モデル（より高度な推論能力）
   - サブスクリプションが active 状態の場合のみプレミアムモデルを使用

4. **サブスクリプション管理**
   - 毎月の支払い成功: サブスクリプション継続
   - 支払い失敗: ステータスが past_due に変更、プレミアムアクセス停止
   - 解約: プレミアムモデルアクセスを無効化

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. AWS CDK の初期化（初回のみ）

```bash
npx cdk bootstrap
```

### 3. 環境変数の設定

このプロジェクトは**テスト環境（dev）**と**本番環境（prod）**を分けてデプロイできます。

#### 環境別の設定ファイル

- `.env.dev` - テスト環境用の設定
- `.env.prod` - 本番環境用の設定

サンプルファイル（`.env.dev.example`、`.env.prod.example`）をコピーして使用してください：

```bash
# テスト環境用
cp .env.dev.example .env.dev

# 本番環境用
cp .env.prod.example .env.prod
```

#### 環境変数の設定

`.env`ファイルを編集して、実際の認証情報を設定してください：

```bash
# .envファイルを編集
# LINE Bot設定（必須）
LINE_CHANNEL_ACCESS_TOKEN=your_actual_line_channel_access_token
LINE_CHANNEL_SECRET=your_actual_line_channel_secret

# Google Gemini API設定（必須）
GEMINI_API_KEY=your_gemini_api_key
GEMINI_BASIC_MODEL=gemini-2.0-flash-exp
GEMINI_PREMIUM_MODEL=gemini-2.0-flash-thinking-exp-01-21
GEMINI_MAX_TOKENS=8000
GEMINI_TEMPERATURE=1
GEMINI_RESPONSE_CHAR_LIMIT=500

# MySQL設定（必須）
DB_HOST=your_mysql_host
DB_USER=lineat_gpt_prod_user
DB_PASSWORD=your_prod_password_here
DB_NAME=lineat_gpt_prod

# Stripe設定（必須）
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_QUOTA_PRICE_ID=price_your_quota_price_id
STRIPE_PREMIUM_PRICE_ID=price_your_premium_price_id
STRIPE_SUCCESS_URL=https://your-success-url.com
STRIPE_CANCEL_URL=https://your-cancel-url.com

# デバッグ設定（テスト時のみ）
SKIP_SIGNATURE_VALIDATION=false
```

**重要**: `.env`ファイルは`.gitignore`に含まれているため、Git にコミットされません。

#### Stripe 設定の取得方法

1. **Stripe アカウント作成**: https://stripe.com でアカウントを作成
2. **API キーの取得**: Dashboard → Developers → API keys
   - `STRIPE_SECRET_KEY`: Secret key（本番環境では `sk_live_...`、テスト環境では `sk_test_...`）
   - `STRIPE_PUBLISHABLE_KEY`: Publishable key
3. **商品と価格の作成**: Dashboard → Products
   - メッセージ枠拡張商品を作成（例: 300 件 / 500 円）
   - プレミアムモデル商品を作成（例: 1,000 円）
   - 各商品の Price ID をコピー
4. **Webhook シークレット**: デプロイ後に設定（後述）
5. **リダイレクト URL**: 決済完了後のリダイレクト先 URL を設定

### 4. データベースの準備

**重要**: テスト環境と本番環境で異なるデータベースを使用することを強く推奨します。

#### 自動セットアップ（推奨）

環境変数ファイルを設定した後、セットアップスクリプトを実行：

```bash
# テスト環境
./database/setup_dev.sh

# 本番環境
./database/setup_prod.sh
```

#### 手動セットアップ

データベースの作成：

```bash
# テスト環境用
mysql -h your_dev_mysql_host -u root -p
CREATE DATABASE line_chatbot_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 本番環境用
mysql -h your_prod_mysql_host -u root -p
CREATE DATABASE line_chatbot_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

スキーマとマイグレーションの適用：

```bash
# テスト環境
mysql -h your_dev_mysql_host -u your_user -p line_chatbot_dev < database/schema.sql
mysql -h your_dev_mysql_host -u your_user -p line_chatbot_dev < database/migration_add_stripe_billing.sql
mysql -h your_dev_mysql_host -u your_user -p line_chatbot_dev < database/migration_add_subscription_support.sql
mysql -h your_dev_mysql_host -u your_user -p line_chatbot_dev < database/migration_add_message_limit.sql

# 本番環境
mysql -h your_prod_mysql_host -u your_user -p line_chatbot_prod < database/schema.sql
mysql -h your_prod_mysql_host -u your_user -p line_chatbot_prod < database/migration_add_stripe_billing.sql
mysql -h your_prod_mysql_host -u your_user -p line_chatbot_prod < database/migration_add_subscription_support.sql
mysql -h your_prod_mysql_host -u your_user -p line_chatbot_prod < database/migration_add_message_limit.sql
```

**詳細なデータベースセットアップ手順は `docs/DATABASE_SETUP.md` を参照してください。**

### 5. デプロイ

#### テスト環境へのデプロイ

```bash
# CloudFormationテンプレートの確認
npm run synth:dev

# 差分確認
npm run diff:dev

# デプロイ実行
npm run deploy:dev
```

または、デプロイスクリプトを使用：

```bash
./deploy.sh dev
```

#### 本番環境へのデプロイ

```bash
# CloudFormationテンプレートの確認
npm run synth:prod

# 差分確認
npm run diff:prod

# デプロイ実行
npm run deploy:prod
```

または、デプロイスクリプトを使用：

```bash
./deploy.sh prod
```

**注意**: テスト環境と本番環境は別々のスタック（`LineChatbotStack-dev`、`LineChatbotStack-prod`）として作成されます。

### 6. Stripe Webhook の設定

デプロイ後に Stripe Dashboard で webhook を設定します：

1. Stripe Dashboard → Developers → Webhooks
2. "Add endpoint" をクリック
3. Endpoint URL: デプロイ時に出力された Stripe Webhook URL（例: `https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/stripe/webhook`）
4. イベントを選択: `checkout.session.completed`
5. Webhook signing secret をコピーして環境変数 `STRIPE_WEBHOOK_SECRET` に設定
6. 再デプロイして webhook secret を反映

### 7. LINE Bot 設定

1. LINE Developers Console でチャンネルを作成
2. デプロイ後に表示される Webhook URL を設定
3. Webhook 使用を有効化

## ユーザー向け機能

### LINE コマンド一覧

ユーザーは LINE トーク画面で以下のコマンドを送信できます：

| コマンド       | 説明                           | 応答内容                                                                                                        |
| -------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **ヘルプ**     | 利用可能なコマンド一覧を表示   | すべてのコマンドの説明を表示                                                                                    |
| **枠**         | メッセージ枠の状態を確認       | 現在の残り枠数、次のリセットまでの時間を表示                                                                    |
| **料金**       | 料金プランを確認               | メッセージ枠拡張（300 円）とプレミアムモデル（月額 1,400 円）の詳細、現在の残り枠を表示                         |
| **プレミアム** | プレミアムモデルを購入         | プレミアムモデルの特徴、料金、解約方法の案内と決済リンクを送信<br>※すでに契約済みの場合は利用中であることを通知 |
| **解約**       | サブスクリプションの解約・管理 | Stripe 顧客ポータルへのリンクを送信。サブスクリプションの解約、支払い方法の変更が可能                           |

### コマンドの使用例

#### 0. ヘルプの表示

```
ユーザー: ヘルプ
Bot: 📖 利用可能なコマンド 📖

【料金】
料金プランと現在の利用状況を表示

【枠】
現在のメッセージ枠情報を表示

【プレミアム】
プレミアムモデルの購入

【解約】
サブスクリプションの解約・管理

その他、通常のメッセージを送信するとAIが応答します。
```

#### 1. メッセージ枠の確認

```
ユーザー: 枠
Bot: 📊 メッセージ枠情報 📊

現在の残り枠: 250件
リセットまで: 約48時間30分

枠がなくなった場合は、追加購入が可能です。
```

#### 2. 料金プランの確認

```
ユーザー: 料金
Bot: 💰 料金プラン 💰

【メッセージ枠追加】
（現在未購入）
・500円（買い切り）
・300件のメッセージ追加
・3日間の枠に追加されます
・枠がなくなった際に購入可能

【プレミアムモデル】
（現在未購入）
・月額1,000円（サブスクリプション）
・より高度なAIモデル
・毎月自動更新
・いつでも解約可能
・「プレミアム」と送信して購入

現在の残り枠: 250件
```

#### 3. プレミアムモデルの購入

```
ユーザー: プレミアム
Bot: 🌟 プレミアムモデルアップグレード 🌟

より高度なAIモデル（Gemini Pro）で、さらに質の高い会話をお楽しみいただけます。

✨ プレミアムモデルの特徴：
・より深い推論能力
・より正確な回答
・複雑な質問への対応

💰 料金：月額1,400円
※毎月自動更新されます
※いつでも解約可能

📋 解約方法：
Stripeの顧客ポータルから、いつでもサブスクリプションを解約できます。解約後も、現在の請求期間の終了まではプレミアムモデルをご利用いただけます。

以下のリンクから決済を完了してください：
https://checkout.stripe.com/...
```

#### 4. サブスクリプションの解約

```
ユーザー: 解約
Bot: 🔧 サブスクリプション管理 🔧

以下のリンクから、サブスクリプションの解約や支払い方法の変更ができます。

⚠️ 解約後も、現在の請求期間の終了（2025/12/29）まではプレミアムモデルをご利用いただけます。

https://billing.stripe.com/...
```

**注意**:

- プレミアムサブスクリプションを契約していない場合は、「現在、プレミアムサブスクリプションをご利用いただいていません。」と表示されます
- Stripe 顧客ポータルでは、サブスクリプションの解約だけでなく、支払い方法の変更や請求履歴の確認も可能です
- 解約後も、現在の請求期間が終了するまではプレミアムモデルを利用できます

### 自動通知機能

コマンド以外にも、以下の状況で自動的にメッセージが送信されます：

#### メッセージ枠の警告

- **残り枠 10 件未満**: 緊急警告メッセージを AI 応答の末尾に表示
  ```
  ---⚠️ 残り枠: 8件
  枠がなくなる前に追加購入をご検討ください。
  ```

#### メッセージ枠の超過

残り枠が 0 件になると、自動的に決済リンクが送信されます：

```
Bot: 申し訳ございません。3日間で300通のメッセージ制限に達しました。

追加で300件のメッセージ枠を購入いただけます。
以下のリンクから決済を完了してください：
https://checkout.stripe.com/...
```

### 決済フロー

1. ユーザーが枠を使い切るか、プレミアムモデルを要求
2. システムが Stripe 決済リンクを送信
3. ユーザーがリンクをクリックして Stripe で決済
4. 決済完了後、自動的に枠が追加されるか、プレミアムモデルが有効化される

### 画像メッセージについて

現在、画像メッセージには対応していません。画像を送信すると以下のメッセージが返されます：

```
Bot: テキストメッセージでお話しいただけると嬉しいです！
```

## CDK コマンド

### 基本コマンド

```bash
npm run build      # TypeScriptコンパイル
```

### テスト環境（dev）

```bash
npm run synth:dev   # CloudFormationテンプレート生成
npm run diff:dev    # 現在のスタックとの差分表示
npm run deploy:dev  # スタックデプロイ
npm run destroy:dev # スタック削除
```

### 本番環境（prod）

```bash
npm run synth:prod   # CloudFormationテンプレート生成
npm run diff:prod    # 現在のスタックとの差分表示
npm run deploy:prod  # スタックデプロイ
npm run destroy:prod # スタック削除
```

### デプロイスクリプト

```bash
./deploy.sh dev   # テスト環境へデプロイ
./deploy.sh prod  # 本番環境へデプロイ
```

## CI/CD

GitHub Actions を使用した環境別の自動デプロイが設定されています。

### デプロイフロー

- **develop ブランチ**: テスト環境（dev）に自動デプロイ
- **main ブランチ**: 本番環境（prod）に自動デプロイ
- **手動実行**: 任意の環境を選択してデプロイ可能

### セットアップ手順

1. **AWS IAM ロールの作成**

GitHub Actions が AWS にアクセスするための OIDC プロバイダーとロールを作成します：

```bash
# AWS CLIで実行
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# 信頼ポリシーを作成（trust-policy.json）
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_USERNAME/YOUR_REPO_NAME:*"
        }
      }
    }
  ]
}
EOF

# ロールを作成
aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document file://trust-policy.json

# 必要なポリシーをアタッチ
aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

2. **GitHub Secrets の設定**

リポジトリの Settings → Secrets and variables → Actions で以下のシークレットを追加：

#### 共通設定

- `AWS_ROLE_ARN`: 作成した IAM ロールの ARN（例: `arn:aws:iam::123456789012:role/GitHubActionsDeployRole`）
- `GEMINI_API_KEY`: Google Gemini API キー
- `GEMINI_BASIC_MODEL`: 基本 Gemini モデル名（例: `gemini-2.0-flash-exp`）
- `GEMINI_PREMIUM_MODEL`: プレミアム Gemini モデル名（例: `gemini-2.0-flash-thinking-exp-01-21`）
- `GEMINI_MAX_TOKENS`: 最大出力トークン数（デフォルト: 8000）
- `GEMINI_TEMPERATURE`: 生成温度（デフォルト: 1）
- `GEMINI_RESPONSE_CHAR_LIMIT`: 応答の文字数制限（デフォルト: 500）

#### テスト環境（dev）用

- `DEV_LINE_CHANNEL_ACCESS_TOKEN`: LINE チャンネルアクセストークン（テスト用）
- `DEV_LINE_CHANNEL_SECRET`: LINE チャンネルシークレット（テスト用）
- `DEV_DB_HOST`: MySQL ホスト（テスト用）
- `DEV_DB_USER`: MySQL ユーザー（テスト用）
- `DEV_DB_PASSWORD`: MySQL パスワード（テスト用）
- `DEV_DB_NAME`: MySQL データベース名（テスト用）
- `DEV_STRIPE_SECRET_KEY`: Stripe シークレットキー（テストモード: `sk_test_`）
- `DEV_STRIPE_PUBLISHABLE_KEY`: Stripe パブリッシャブルキー（テストモード）
- `DEV_STRIPE_WEBHOOK_SECRET`: Stripe Webhook シークレット（テストモード）
- `DEV_STRIPE_QUOTA_PRICE_ID`: メッセージ枠拡張の Price ID（テストモード）
- `DEV_STRIPE_PREMIUM_PRICE_ID`: プレミアムモデルの Price ID（テストモード）
- `DEV_STRIPE_SUCCESS_URL`: 決済成功時のリダイレクト URL（テスト用）
- `DEV_STRIPE_CANCEL_URL`: 決済キャンセル時のリダイレクト URL（テスト用）
- `DEV_SKIP_SIGNATURE_VALIDATION`: 署名検証スキップフラグ（テスト用: `true`）

#### 本番環境（prod）用

- `PROD_LINE_CHANNEL_ACCESS_TOKEN`: LINE チャンネルアクセストークン（本番用）
- `PROD_LINE_CHANNEL_SECRET`: LINE チャンネルシークレット（本番用）
- `PROD_DB_HOST`: MySQL ホスト（本番用）
- `PROD_DB_USER`: MySQL ユーザー（本番用）
- `PROD_DB_PASSWORD`: MySQL パスワード（本番用）
- `PROD_DB_NAME`: MySQL データベース名（本番用）
- `PROD_STRIPE_SECRET_KEY`: Stripe シークレットキー（本番モード: `sk_live_`）
- `PROD_STRIPE_PUBLISHABLE_KEY`: Stripe パブリッシャブルキー（本番モード）
- `PROD_STRIPE_WEBHOOK_SECRET`: Stripe Webhook シークレット（本番モード）
- `PROD_STRIPE_QUOTA_PRICE_ID`: メッセージ枠拡張の Price ID（本番モード）
- `PROD_STRIPE_PREMIUM_PRICE_ID`: プレミアムモデルの Price ID（本番モード）
- `PROD_STRIPE_SUCCESS_URL`: 決済成功時のリダイレクト URL（本番用）
- `PROD_STRIPE_CANCEL_URL`: 決済キャンセル時のリダイレクト URL（本番用）
- `PROD_SKIP_SIGNATURE_VALIDATION`: 署名検証スキップフラグ（本番用: `false`）

3. **自動デプロイ**

#### テスト環境へのデプロイ

`develop` ブランチにプッシュすると自動的にテスト環境にデプロイされます：

```bash
git checkout develop
git add .
git commit -m "Deploy to dev environment"
git push origin develop
```

#### 本番環境へのデプロイ

`main` ブランチにプッシュすると自動的に本番環境にデプロイされます：

```bash
git checkout main
git merge develop
git push origin main
```

4. **手動デプロイ**

GitHub の Actions タブから "Deploy to AWS" ワークフローを手動実行し、デプロイ先の環境（dev/prod）を選択できます。

## ローカル開発

```bash
# CDKテンプレートを生成してからSAM CLIで実行
npm run synth
npm run local
```

## ファイル構成

### アプリケーションコード

- `src/handlers/webhook.js` - LINE Webhook ハンドラー
- `src/handlers/stripe-webhook.js` - Stripe Webhook ハンドラー
- `src/services/line.js` - LINE API 関連処理
- `src/services/gemini.js` - Google Gemini API 処理（モデル選択機能付き）
- `src/services/stripe.js` - Stripe 決済処理
- `src/services/database.js` - MySQL 操作（枠管理・トランザクション記録）
- `src/utils/logger.js` - ログ出力ユーティリティ

### インフラストラクチャコード

- `infrastructure/app.ts` - CDK アプリケーションエントリーポイント
- `infrastructure/line-chatbot-stack.ts` - AWS リソース定義
- `cdk.json` - CDK 設定ファイル
- `tsconfig.json` - TypeScript 設定

### その他

- `database/schema.sql` - データベーススキーマ
- `database/migration_add_stripe_billing.sql` - Stripe 課金機能のマイグレーション
- `database/migration_add_message_limit.sql` - メッセージ制限の更新
- `package.json` - 依存関係とスクリプト
- `docs/DEPLOYMENT.md` - 詳細なデプロイガイド

## AWS CDK の利点

- **AWS ネイティブ**: Serverless Framework に依存しない
- **型安全**: TypeScript による型チェック
- **細かい制御**: AWS リソースの詳細設定が可能
- **CloudFormation**: AWS 標準の IaC ツール使用
- **バージョン管理**: インフラコードの変更履歴管理

## トラブルシューティング

### Stripe Webhook が動作しない

1. Webhook URL が正しく設定されているか確認
2. Webhook secret が環境変数に正しく設定されているか確認
3. CloudWatch Logs で Lambda のログを確認
4. Stripe Dashboard の Webhook ログで配信状況を確認

### 枠が正しく更新されない

1. データベースのトランザクションログを確認
2. `transactions` テーブルでステータスを確認
3. Lambda のログでエラーを確認

### プレミアムモデルが有効化されない

1. `users` テーブルの `has_premium_model` カラムを確認
2. Stripe の商品タイプが正しく設定されているか確認
3. Webhook イベントが正しく処理されているか確認

## セキュリティ

- **API キーの管理**: すべての API キーは環境変数で管理し、コードに直接記述しない
- **Webhook 署名検証**: LINE と Stripe の署名検証を必ず有効化
- **データベース接続**: SSL/TLS を使用した暗号化接続を推奨
- **本番環境**: Stripe の本番環境キーは慎重に管理し、テストキーと混同しない

## 注意事項

- Google Gemini API キーは適切に管理してください（https://aistudio.google.com/app/apikey から取得）
- MySQL の接続情報は環境変数で管理し、直接コードに記述しないでください
- LINE Bot の署名検証を必ず有効にしてください
- CDK デプロイ前に必ず`cdk diff`で変更内容を確認してください
- Stripe のテストモードと本番モードを適切に使い分けてください
- 詳細なデプロイ手順は `docs/DEPLOYMENT.md` を参照してください

## ライセンス

MIT
