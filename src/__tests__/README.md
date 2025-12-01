# テストディレクトリ構造

このディレクトリには、LINE Chatbot の Stripe 決済機能とメッセージカウントロジックのテストが含まれています。

## ディレクトリ構造

```
__tests__/
├── setup.js                    # テスト環境のセットアップ
├── example.test.js             # サンプルテスト
├── services/                   # サービス層の単体テスト
│   ├── stripe.test.js         # Stripe サービスのテスト
│   ├── database.test.js       # データベースサービスのテスト
│   └── gemini.test.js         # Gemini サービスのテスト
├── handlers/                   # ハンドラーの単体テスト
│   ├── webhook.test.js        # LINE Webhook ハンドラーのテスト
│   └── stripe-webhook.test.js # Stripe Webhook ハンドラーのテスト
└── integration/                # 統合テスト
    ├── payment-flow.test.js   # 決済フローの統合テスト
    └── count-logic.test.js    # カウントロジックの統合テスト
```

## テストの実行

```bash
# すべてのテストを実行
npm test

# ウォッチモードで実行
npm run test:watch

# カバレッジレポート付きで実行
npm run test:coverage

# 単体テストのみ実行
npm run test:unit

# 統合テストのみ実行
npm run test:integration
```

## テストの種類

### 単体テスト

- 各サービスとハンドラーの個別機能をテスト
- モックを使用して外部依存を排除

### プロパティベーステスト

- fast-check ライブラリを使用
- 多数のランダム入力で正確性プロパティを検証
- 最低 100 回の反復を実行

### 統合テスト

- 複数のコンポーネントを組み合わせたエンドツーエンドのフローをテスト
- 実際のデータベース接続や API 呼び出しをシミュレート

## 環境変数

テスト用の環境変数は `setup.js` で設定されています。
