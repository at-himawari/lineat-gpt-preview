# 設計ドキュメント

## 概要

本設計は、LINE チャットボットに 2 つの独立した課金機能を統合します：

1. **メッセージ枠拡張**: ユーザーが 3 日間で 300 件のメッセージ制限を超えた場合、Stripe 決済を通じて追加の 300 件の枠を購入できる
2. **プレミアムモデルアップグレード**: より高度な AI モデル（Gemini Pro）へのアクセスを購入できる

システムは既存の LINE webhook、データベース、Gemini API 統合を拡張し、Stripe 決済処理、webhook 処理、およびモデル切り替えロジックを追加します。

## アーキテクチャ

### システムコンポーネント図

```
┌─────────────┐
│ LINE User   │
└──────┬──────┘
       │ Messages
       ▼
┌─────────────────────────────────────────┐
│         LINE Webhook Handler            │
│  (src/handlers/webhook.js)              │
│  - Message validation                   │
│  - Quota checking                       │
│  - Model selection                      │
└──────┬──────────────────────────────────┘
       │
       ├──────────────┬──────────────┬─────────────┐
       ▼              ▼              ▼             ▼
┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│  Database   │ │  Gemini  │ │  Stripe  │ │ LINE Reply   │
│  Service    │ │  Service │ │  Service │ │ Service      │
└─────────────┘ └──────────┘ └──────────┘ └──────────────┘
       │              │              │
       ▼              ▼              ▼
┌─────────────┐ ┌──────────┐ ┌──────────────────┐
│   MySQL     │ │  Gemini  │ │  Stripe API      │
│  Database   │ │   API    │ │  + Webhooks      │
└─────────────┘ └──────────┘ └──────────────────┘
```

### データフロー

#### メッセージ処理フロー

1. ユーザーが LINE でメッセージを送信
2. Webhook handler がメッセージを受信
3. データベースでユーザーを作成/更新
4. メッセージ枠をチェック
   - 枠が残っている → 処理を続行
   - 枠がゼロ → Stripe 決済リンクを送信して終了
5. ユーザーのモデルサブスクリプション状態を確認
6. 適切な AI モデル（Basic または Premium）を選択
7. Gemini API で応答を生成
8. 応答を LINE で返信
9. メッセージと応答をデータベースに保存

#### 決済フロー（枠拡張）

1. ユーザーが枠制限に達する
2. システムが Stripe Checkout セッションを作成（product_type: "quota_extension"）
3. 決済リンクを LINE で送信
4. ユーザーが Stripe で決済を完了
5. Stripe が webhook イベント（checkout.session.completed）を送信
6. Webhook handler がイベントを検証
7. ユーザーの枠に 300 件を追加
8. トランザクションをデータベースに記録

#### 決済フロー（モデルアップグレード）

1. ユーザーがアップグレードコマンドを送信（例: "プレミアム"）
2. システムが Stripe Checkout セッションを作成（product_type: "model_upgrade"）
3. 決済リンクを LINE で送信
4. ユーザーが Stripe で決済を完了
5. Stripe が webhook イベント（checkout.session.completed）を送信
6. Webhook handler がイベントを検証
7. ユーザーのプレミアムモデルアクセスを有効化
8. トランザクションをデータベースに記録

## コンポーネントとインターフェース

### 1. Stripe サービス（新規）

**ファイル**: `src/services/stripe.js`

**責務**:

- Stripe Checkout セッションの作成
- Webhook 署名の検証
- 決済イベントの処理

**主要メソッド**:

```javascript
// Checkoutセッションを作成
async function createCheckoutSession(userId, productType, metadata)

// Webhook署名を検証
function verifyWebhookSignature(payload, signature, secret)

// Webhookイベントを処理
async function handleWebhookEvent(event)
```

### 2. データベースサービス（拡張）

**ファイル**: `src/services/database.js`

**新規メソッド**:

```javascript
// 枠を追加（決済後）
async function addMessageQuota(userId, amount)

// プレミアムモデルアクセスを有効化
async function activatePremiumModel(userId)

// ユーザーのモデルサブスクリプション状態を取得
async function getUserModelStatus(userId)

// トランザクションを保存
async function saveTransaction(sessionId, userId, productType, amount, status)

// トランザクションを更新
async function updateTransaction(sessionId, status, completedAt)
```

**既存メソッドの変更**:

```javascript
// checkAndUpdateMessageLimit: 300件制限に変更
```

### 3. Gemini サービス（拡張）

**ファイル**: `src/services/gemini.js`

**新規メソッド**:

```javascript
// モデルを指定してチャット応答を取得
async function getChatResponse(userMessage, conversationHistory, modelType)
```

**変更点**:

- `modelType`パラメータを追加（'basic' または 'premium'）
- Basic: `gemini-2.5-flash`
- Premium: `gemini-3-pro-preview`

### 4. Stripe Webhook Handler（新規）

**ファイル**: `src/handlers/stripe-webhook.js`

**責務**:

- Stripe からの webhook イベントを受信
- 署名を検証
- イベントタイプに基づいて処理を分岐
- データベースを更新

### 5. LINE Webhook Handler（拡張）

**ファイル**: `src/handlers/webhook.js`

**変更点**:

- モデルサブスクリプション状態の確認を追加
- モデルタイプの選択ロジックを追加
- 特定のコマンド処理を追加（"プレミアム"、"料金"など）
- 枠警告メッセージの追加

## データモデル

### データベーススキーマの変更

#### users テーブル（変更）

```sql
ALTER TABLE users
MODIFY COLUMN message_count_3days INT DEFAULT 300,  -- 100から300に変更
ADD COLUMN has_premium_model BOOLEAN DEFAULT FALSE,
ADD COLUMN premium_activated_at TIMESTAMP NULL;
```

#### transactions テーブル（新規）

```sql
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  product_type ENUM('quota_extension', 'model_upgrade') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'JPY',
  status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  metadata JSON,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_session_id (stripe_session_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 環境変数

新規追加:

```
# Stripe設定
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_QUOTA_PRICE_ID=price_...
STRIPE_PREMIUM_PRICE_ID=price_...
STRIPE_SUCCESS_URL=https://...
STRIPE_CANCEL_URL=https://...

# モデル設定
GEMINI_BASIC_MODEL=gemini-2.0-flash-exp
GEMINI_PREMIUM_MODEL=gemini-2.0-flash-thinking-exp-01-21
```

## 正確性プロパティ

_プロパティとは、システムのすべての有効な実行において真であるべき特性または動作です。本質的には、システムが何をすべきかについての形式的な記述です。プロパティは、人間が読める仕様と機械で検証可能な正確性保証との橋渡しとして機能します。_

### プロパティ 1: メッセージ送信による枠の減少

*任意の*ユーザーと任意の正の枠数に対して、メッセージを送信すると残り枠が正確に 1 減少する
**検証: 要件 1.2**

### プロパティ 2: 3 日経過後の枠リセット

*任意の*ユーザーに対して、枠期間開始から 3 日以上経過した場合、次のメッセージ送信時に枠が 300 にリセットされる
**検証: 要件 1.3**

### プロパティ 3: 残り枠がある場合のメッセージ処理

*任意の*ユーザーと任意の正の枠数に対して、メッセージを送信するとシステムは応答を生成する
**検証: 要件 1.4**

### プロパティ 4: 枠超過時の決済リンク送信

*任意の*ユーザーに対して、枠がゼロの状態でメッセージを送信すると、Stripe 決済リンクを含む応答が返される
**検証: 要件 2.1**

### プロパティ 5: 決済完了後の枠追加

*任意の*ユーザーと任意の現在枠数に対して、quota_extension 決済が完了すると、枠が正確に 300 件増加する
**検証: 要件 2.4**

### プロパティ 6: 決済キャンセル時の枠不変性

*任意の*ユーザーに対して、決済をキャンセルした場合、枠数は変更されない
**検証: 要件 2.5**

### プロパティ 7: 応答メタデータへの残り枠数の含有

*任意の*ユーザーと任意のメッセージに対して、システムの応答には現在の残り枠数が含まれる
**検証: 要件 4.1**

### プロパティ 8: トランザクション作成時の必須フィールド保存

*任意の*Checkout セッションに対して、トランザクションレコードにはセッション ID、ユーザー ID、商品タイプ、金額、作成タイムスタンプが含まれる
**検証: 要件 5.1**

### プロパティ 9: トランザクション履歴の降順ソート

*任意の*ユーザーのトランザクション履歴に対して、レコードは作成タイムスタンプの降順で返される
**検証: 要件 5.4**

### プロパティ 10: トランザクションと枠更新のアトミック性

*任意の*決済完了イベントに対して、トランザクションレコードの作成と枠更新は両方成功するか両方失敗する
**検証: 要件 5.5**

### プロパティ 11: Stripe API エラー時のユーザーフレンドリーなメッセージ

*任意の*Stripe API 呼び出し失敗に対して、システムはエラーをログに記録し、ユーザーに分かりやすいエラーメッセージを返す
**検証: 要件 6.1**

### プロパティ 12: 複数購入の枠累積

*任意の*ユーザーと任意の購入回数に対して、枠期間内の複数の quota_extension 購入はすべて累積される
**検証: 要件 8.3**

### プロパティ 13: 枠拡張時のリセット時刻不変性

*任意の*ユーザーに対して、枠拡張を購入しても枠期間のリセット時刻は変更されない
**検証: 要件 8.5**

### プロパティ 14: 決済完了後のプレミアムモデル有効化

*任意の*ユーザーに対して、model_upgrade 決済が完了すると、プレミアムモデルアクセスが有効化される
**検証: 要件 9.3**

### プロパティ 15: プレミアムユーザーのモデル選択

*任意の*プレミアムモデルアクセスを持つユーザーに対して、メッセージ送信時にプレミアムモデルが使用される
**検証: 要件 9.4**

### プロパティ 16: 非プレミアムユーザーのモデル選択

*任意の*プレミアムモデルアクセスを持たないユーザーに対して、メッセージ送信時に基本モデルが使用される
**検証: 要件 9.5**

### プロパティ 17: 枠リセット後のサブスクリプション維持

*任意の*プレミアムモデルアクセスを持つユーザーに対して、枠期間がリセットされてもサブスクリプション状態は維持される
**検証: 要件 10.2**

### プロパティ 18: セッションメタデータへの商品タイプ含有

*任意の*Checkout セッション作成に対して、セッションメタデータには商品タイプ（quota_extension または model_upgrade）が含まれる
**検証: 要件 11.1**

## エラーハンドリング

### 1. Stripe API エラー

- **ネットワークエラー**: 指数バックオフで最大 3 回再試行
- **認証エラー**: ログに記録し、管理者に通知
- **レート制限**: 適切な待機時間後に再試行
- **ユーザーへの応答**: "決済処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。"

### 2. データベースエラー

- **接続エラー**: 接続プールの再初期化を試行
- **トランザクションエラー**: ロールバックし、エラーをログに記録
- **制約違反**: 適切なエラーメッセージをユーザーに返す
- **デッドロック**: 自動的に再試行（最大 3 回）

### 3. Webhook 検証エラー

- **無効な署名**: 401 ステータスコードを返し、リクエストを拒否
- **不明なイベントタイプ**: ログに記録し、200 ステータスコードを返す（Stripe の再試行を防ぐ）
- **処理エラー**: 500 ステータスコードを返し、Stripe に再試行させる

### 4. ビジネスロジックエラー

- **重複セッション作成**: 既存のアクティブセッションを返す
- **不正な商品タイプ**: 400 ステータスコードとエラーメッセージを返す
- **ユーザーが見つからない**: エラーをログに記録し、適切なメッセージを返す

### 5. Gemini API エラー

- **API エラー**: 既存のエラーハンドリングを維持
- **モデル選択エラー**: 基本モデルにフォールバック

## テスト戦略

### 単体テスト

#### Stripe サービス

- Checkout セッション作成のパラメータ検証
- Webhook 署名検証ロジック
- 商品タイプに基づく処理分岐
- エラーハンドリング

#### データベースサービス

- 枠追加ロジック
- プレミアムモデル有効化
- トランザクション保存と更新
- 枠リセットロジック

#### Gemini サービス

- モデルタイプに基づくモデル選択
- パラメータの正しい渡し方

### プロパティベーステスト

プロパティベーステストには**fast-check**ライブラリを使用します。各テストは最低 100 回の反復を実行します。

#### テスト対象プロパティ

- プロパティ 1-18（上記の正確性プロパティセクションで定義）

#### ジェネレータ

```javascript
// ユーザーIDジェネレータ
fc.string({ minLength: 10, maxLength: 50 });

// 枠数ジェネレータ
fc.integer({ min: 0, max: 1000 });

// 商品タイプジェネレータ
fc.constantFrom("quota_extension", "model_upgrade");

// タイムスタンプジェネレータ
fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") });
```

### 統合テスト

#### 決済フロー統合テスト

1. ユーザーが枠を使い切る
2. 決済リンクが生成される
3. Stripe webhook をシミュレート
4. 枠が正しく更新される
5. トランザクションが記録される

#### モデルアップグレードフロー統合テスト

1. ユーザーがアップグレードを要求
2. 決済リンクが生成される
3. Stripe webhook をシミュレート
4. プレミアムモデルアクセスが有効化される
5. 次のメッセージでプレミアムモデルが使用される

#### エンドツーエンドテスト

- Stripe Test Mode を使用した実際の決済フロー
- LINE Messaging API のモック使用
- データベースのテスト環境使用

### テスト環境

#### 環境変数

```
NODE_ENV=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...
DB_HOST=localhost
DB_NAME=test_db
```

#### モック

- Stripe API: `stripe-mock`または手動モック
- LINE Messaging API: `nock`を使用した HTTP モック
- Gemini API: レスポンスのモック

## 実装の考慮事項

### 1. セキュリティ

- Stripe webhook 署名の厳密な検証
- 環境変数の暗号化保存
- SQL インジェクション対策（プリペアドステートメント使用）
- レート制限の実装

### 2. パフォーマンス

- データベース接続プーリング
- トランザクションの最小化
- 非同期処理の活用
- キャッシング戦略（ユーザーのサブスクリプション状態）

### 3. スケーラビリティ

- ステートレスな Lambda 関数設計
- データベースインデックスの最適化
- Stripe webhook の冪等性処理

### 4. 監視とロギング

- すべての決済イベントのログ記録
- エラー率の監視
- 決済成功率の追跡
- ユーザー枠使用状況の分析

### 5. 移行戦略

- 既存ユーザーの枠を 100 から 300 に更新
- 新しいデータベーステーブルの作成
- 段階的なロールアウト（フィーチャーフラグ使用）
- ロールバック計画

## デプロイメント

### インフラストラクチャの変更

#### Lambda 関数

- 新規: `stripe-webhook-handler`
- 更新: `line-webhook-handler`（モデル選択ロジック追加）

#### API Gateway

- 新規エンドポイント: `POST /stripe/webhook`
- 既存エンドポイント: `POST /webhook`（変更なし）

#### 環境変数（AWS Systems Manager Parameter Store）

```
/linechatbot/stripe/secret-key
/linechatbot/stripe/webhook-secret
/linechatbot/stripe/quota-price-id
/linechatbot/stripe/premium-price-id
/linechatbot/gemini/basic-model
/linechatbot/gemini/premium-model
```

#### データベースマイグレーション

```sql
-- migration_add_stripe_billing.sql
ALTER TABLE users
MODIFY COLUMN message_count_3days INT DEFAULT 300,
ADD COLUMN has_premium_model BOOLEAN DEFAULT FALSE,
ADD COLUMN premium_activated_at TIMESTAMP NULL;

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  product_type ENUM('quota_extension', 'model_upgrade') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'JPY',
  status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  metadata JSON,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_session_id (stripe_session_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 既存ユーザーの枠を更新
UPDATE users SET message_count_3days = 300 WHERE message_count_3days < 300;
```

### デプロイ手順

1. データベースマイグレーションの実行
2. 環境変数の設定
3. Lambda 関数のデプロイ
4. Stripe webhook エンドポイントの登録
5. 動作確認（テストモード）
6. 本番環境への切り替え

## 今後の拡張

### フェーズ 2 の機能

- サブスクリプションの自動更新
- 複数の価格プラン（月額、年額）
- 使用状況ダッシュボード
- 管理者用の決済管理画面

### 最適化

- キャッシュレイヤーの追加（Redis）
- 非同期 webhook 処理（SQS 使用）
- より詳細な分析とレポート
