# LINE Bot with Azure OpenAI and MySQL (AWS CDK)

AWS CDK を使用して AWS Lambda で Azure OpenAI に接続し、LINE の API を使って会話できるチャットボットです。ユーザー管理と会話履歴の保存に MySQL を使用します。

## 機能

- LINE Messaging API を使用したチャットボット
- Azure OpenAI (GPT-5.1-chat) による自然な会話
- **完全無料の Web 検索機能（DuckDuckGo API）** - API キー不要で最新情報に対応
- MySQL でのユーザー管理と会話履歴保存（最新 10 件を参照）
- AWS CDK によるインフラストラクチャ管理（Serverless Framework 不要）
- AWS Lambda でのサーバーレス実行
- 自己署名 SSL 証明書対応
- エラーハンドリング（DB 接続失敗時も AI 応答は継続）

## アーキテクチャ

```text
LINE User → LINE Messaging API → API Gateway → AWS Lambda → Azure OpenAI
                                                    ↓
                                                MySQL Database
                                                (会話履歴保存)
```

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

`.env`ファイルを編集して、実際の認証情報を設定してください：

```bash
# .envファイルを編集
# LINE Bot設定（必須）
LINE_CHANNEL_ACCESS_TOKEN=your_actual_line_channel_access_token
LINE_CHANNEL_SECRET=your_actual_line_channel_secret

# Azure OpenAI設定（必須）
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=your_deployment_name

# Web検索API設定（オプション）
# DuckDuckGoは完全無料・APIキー不要（デフォルトで有効）
# SerpApiは無料プラン月100回まで（オプション強化）
SERPAPI_API_KEY=your_serpapi_key_optional

# MySQL設定（オプション）
DB_HOST=your_mysql_host
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_database_name

# デバッグ設定（テスト時のみ）
SKIP_SIGNATURE_VALIDATION=false
```

**重要**: `.env`ファイルは`.gitignore`に含まれているため、Git にコミットされません。

### 4. データベースの準備

MySQL データベースに以下のスキーマを適用してください：

```bash
mysql -u your_user -p your_database < database/schema.sql
```

### 5. デプロイ

```bash
# CloudFormationテンプレートの確認
npm run synth

# 差分確認
npm run diff

# デプロイ実行
npm run deploy
```

### 6. LINE Bot 設定

1. LINE Developers Console でチャンネルを作成
2. デプロイ後に表示される Webhook URL を設定
3. Webhook 使用を有効化

## CDK コマンド

```bash
npm run build      # TypeScriptコンパイル
npm run synth      # CloudFormationテンプレート生成
npm run diff       # 現在のスタックとの差分表示
npm run deploy     # スタックデプロイ
npm run destroy    # スタック削除
```

## CI/CD

GitHub Actions を使用した自動デプロイが設定されています。

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

- `AWS_ROLE_ARN`: 作成した IAM ロールの ARN（例: `arn:aws:iam::123456789012:role/GitHubActionsDeployRole`）
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE チャンネルアクセストークン
- `LINE_CHANNEL_SECRET`: LINE チャンネルシークレット
- `AZURE_OPENAI_API_KEY`: Azure OpenAI API キー
- `AZURE_OPENAI_ENDPOINT`: Azure OpenAI エンドポイント
- `AZURE_OPENAI_DEPLOYMENT_NAME`: Azure OpenAI デプロイメント名
- `DB_HOST`: MySQL ホスト
- `DB_USER`: MySQL ユーザー
- `DB_PASSWORD`: MySQL パスワード
- `DB_NAME`: MySQL データベース名
- `SKIP_SIGNATURE_VALIDATION`: 署名検証スキップフラグ（通常は `false`）
- `SERPAPI_API_KEY`: SerpApi API キー（オプション - 月 100 回まで無料）

3. **デプロイ**

`main` ブランチにプッシュすると自動的にデプロイされます：

```bash
git add .
git commit -m "Deploy to AWS"
git push origin main
```

手動でデプロイする場合は、GitHub の Actions タブから "Deploy to AWS" ワークフローを実行できます。

## ローカル開発

```bash
# CDKテンプレートを生成してからSAM CLIで実行
npm run synth
npm run local
```

## ファイル構成

### アプリケーションコード

- `src/handlers/webhook.js` - LINE Webhook ハンドラー
- `src/services/line.js` - LINE API 関連処理
- `src/services/openai.js` - Azure OpenAI API 処理
- `src/services/search.js` - Web 検索機能（DuckDuckGo + SerpApi）
- `src/services/database.js` - MySQL 操作
- `src/utils/logger.js` - ログ出力ユーティリティ

### インフラストラクチャコード

- `infrastructure/app.ts` - CDK アプリケーションエントリーポイント
- `infrastructure/line-chatbot-stack.ts` - AWS リソース定義
- `cdk.json` - CDK 設定ファイル
- `tsconfig.json` - TypeScript 設定

### その他

- `database/schema.sql` - データベーススキーマ
- `docs/WEB_SEARCH_SETUP.md` - Web 検索機能の詳細ガイド
- `package.json` - 依存関係とスクリプト

## AWS CDK の利点

- **AWS ネイティブ**: Serverless Framework に依存しない
- **型安全**: TypeScript による型チェック
- **細かい制御**: AWS リソースの詳細設定が可能
- **CloudFormation**: AWS 標準の IaC ツール使用
- **バージョン管理**: インフラコードの変更履歴管理

## 注意事項

- Azure OpenAI の API キーとエンドポイントは適切に管理してください
- MySQL の接続情報は環境変数で管理し、直接コードに記述しないでください
- LINE Bot の署名検証を必ず有効にしてください
- CDK デプロイ前に必ず`cdk diff`で変更内容を確認してください
