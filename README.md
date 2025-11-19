# LINE Bot with Azure OpenAI and MySQL (AWS CDK)

AWS CDK を使用して AWS Lambda で Azure OpenAI に接続し、LINE の API を使って会話できるチャットボットです。ユーザー管理と会話履歴の保存に MySQL を使用します。

## 機能

- LINE Messaging API を使用したチャットボット
- Azure OpenAI による自然な会話
- MySQL でのユーザー管理と会話履歴保存
- AWS CDK によるインフラストラクチャ管理
- AWS Lambda でのサーバーレス実行

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

以下の環境変数を設定してください：

```bash
# LINE Bot設定
export LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
export LINE_CHANNEL_SECRET=your_line_channel_secret

# Azure OpenAI設定
export AZURE_OPENAI_API_KEY=your_azure_openai_api_key
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
export AZURE_OPENAI_DEPLOYMENT_NAME=your_deployment_name

# MySQL設定
export DB_HOST=your_mysql_host
export DB_USER=your_mysql_user
export DB_PASSWORD=your_mysql_password
export DB_NAME=your_database_name
```

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

## ローカル開発

```bash
# CDKテンプレートを生成してからSAM CLIで実行
npm run synth
npm run local
```

## アーキテクチャ

```text
LINE User → LINE Messaging API → API Gateway → AWS Lambda → Azure OpenAI
                                                    ↓
                                                MySQL Database
```

## ファイル構成

### アプリケーションコード

- `src/handlers/webhook.js` - LINE Webhook ハンドラー
- `src/services/line.js` - LINE API 関連処理
- `src/services/openai.js` - Azure OpenAI API 処理
- `src/services/database.js` - MySQL 操作
- `src/utils/logger.js` - ログ出力ユーティリティ

### インフラストラクチャコード

- `infrastructure/app.ts` - CDK アプリケーションエントリーポイント
- `infrastructure/line-chatbot-stack.ts` - AWS リソース定義
- `cdk.json` - CDK 設定ファイル
- `tsconfig.json` - TypeScript 設定

### その他

- `database/schema.sql` - データベーススキーマ
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
