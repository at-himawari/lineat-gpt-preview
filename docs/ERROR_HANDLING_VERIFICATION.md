# エラーハンドリング検証ドキュメント

## 概要

このドキュメントは、画像認識機能のエラーハンドリング実装（タスク 10）の検証方法を説明します。

## 実装内容

### 1. メッセージ枠のロールバック機能

**新規関数**: `rollbackMessageLimit(userId)`

- **場所**: `src/services/database.js`
- **目的**: エラー発生時にメッセージ枠を返却する
- **動作**: メッセージカウントを 1 減らす（最小値は 0）

```javascript
async function rollbackMessageLimit(userId) {
  try {
    const conn = await getConnection();
    await conn.execute(
      "UPDATE users SET message_count_3days = GREATEST(message_count_3days - 1, 0) WHERE line_user_id = ?",
      [userId]
    );
    logger.info(`Message quota rolled back for user: ${userId}`);
  } catch (error) {
    logger.error("Database error in rollbackMessageLimit:", error);
  }
}
```

### 2. エラーハンドリングの実装箇所

#### 2.1 LINE API エラー（要件 4.1, 4.2）

**場所**: `src/handlers/webhook.js` - 画像コンテンツ取得時

```javascript
try {
  imageContent = await getImageContent(lineEvent.message.id, client);
} catch (lineApiError) {
  logger.error("LINE API error while fetching image:", {
    error: lineApiError.message,
    userId,
    stack: lineApiError.stack,
  });

  // エラー時はメッセージ枠をロールバック（要件 4.5）
  const { rollbackMessageLimit } = require("../services/database");
  await rollbackMessageLimit(userId);

  await client.replyMessage({
    replyToken: lineEvent.replyToken,
    messages: [
      {
        type: "text",
        text: "画像の取得に失敗しました。しばらく時間をおいてから再度お試しください。",
      },
    ],
  });
  continue;
}
```

**検証項目**:

- ✅ エラーログが記録される（メッセージ、userId、スタックトレース）
- ✅ ユーザーにエラーメッセージが送信される
- ✅ メッセージ枠がロールバックされる

#### 2.2 画像検証エラー（要件 7.1, 7.2, 7.3, 7.4, 4.5）

**場所**: `src/handlers/webhook.js` - 画像検証時

```javascript
const validation = validateImage(imageContent);

if (!validation.valid) {
  logger.warn("Image validation failed", {
    userId,
    error: validation.error,
    imageSize: imageContent.length,
  });

  // エラー時はメッセージ枠をロールバック（要件 4.5）
  const { rollbackMessageLimit } = require("../services/database");
  await rollbackMessageLimit(userId);

  await client.replyMessage({
    replyToken: lineEvent.replyToken,
    messages: [
      {
        type: "text",
        text: validation.error,
      },
    ],
  });
  continue;
}
```

**検証項目**:

- ✅ 検証エラーがログに記録される（userId、エラー内容、画像サイズ）
- ✅ ユーザーに検証エラーメッセージが送信される
- ✅ メッセージ枠がロールバックされる

#### 2.3 Vision API エラー（要件 4.3, 4.4, 4.5）

**場所**: `src/handlers/webhook.js` - Vision API 呼び出し時

```javascript
try {
  analysis = await analyzeImage(
    imageContent,
    conversationHistory,
    "premium",
    userPrompt,
    validation.mimeType
  );
} catch (visionApiError) {
  logger.error("Vision API error:", {
    error: visionApiError.message,
    userId,
    stack: visionApiError.stack,
  });

  // エラー時はメッセージ枠をロールバック（要件 4.5）
  const { rollbackMessageLimit } = require("../services/database");
  await rollbackMessageLimit(userId);

  await client.replyMessage({
    replyToken: lineEvent.replyToken,
    messages: [
      {
        type: "text",
        text: "画像の分析に失敗しました。しばらく時間をおいてから再度お試しください。",
      },
    ],
  });
  continue;
}
```

**検証項目**:

- ✅ エラーログが記録される（メッセージ、userId、スタックトレース）
- ✅ ユーザーにエラーメッセージが送信される
- ✅ メッセージ枠がロールバックされる

#### 2.4 データベースエラー（要件 4.5）

**場所**: `src/handlers/webhook.js` - データベース処理時

```javascript
} catch (dbError) {
  logger.error("Database error in image processing:", {
    error: dbError.message,
    stack: dbError.stack,
    userId,
  });

  // エラー時はメッセージ枠をロールバック（要件 4.5）
  try {
    const { rollbackMessageLimit } = require("../services/database");
    await rollbackMessageLimit(userId);
  } catch (rollbackError) {
    logger.error("Failed to rollback message limit:", rollbackError);
  }

  await client.replyMessage({
    replyToken: lineEvent.replyToken,
    messages: [
      {
        type: "text",
        text: "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
      },
    ],
  });
}
```

**検証項目**:

- ✅ エラーログが記録される（メッセージ、スタックトレース、userId）
- ✅ ユーザーにエラーメッセージが送信される
- ✅ メッセージ枠がロールバックされる
- ✅ ロールバック失敗時もエラーログが記録される

#### 2.5 一般的なエラー（要件 4.5）

**場所**: `src/handlers/webhook.js` - 画像処理全体のエラーハンドリング

```javascript
} catch (error) {
  logger.error("Failed to process image message:", {
    error: error.message,
    stack: error.stack,
    userId: lineEvent.source?.userId,
  });

  // エラー時はメッセージ枠をロールバック（要件 4.5）
  try {
    const userId = lineEvent.source?.userId;
    if (userId) {
      const { rollbackMessageLimit } = require("../services/database");
      await rollbackMessageLimit(userId);
    }
  } catch (rollbackError) {
    logger.error("Failed to rollback message limit:", rollbackError);
  }

  try {
    await client.replyMessage({
      replyToken: lineEvent.replyToken,
      messages: [
        {
          type: "text",
          text: "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
        },
      ],
    });
  } catch (errorReplyError) {
    logger.error("Failed to send error reply:", errorReplyError);
  }
}
```

**検証項目**:

- ✅ エラーログが記録される（メッセージ、スタックトレース、userId）
- ✅ ユーザーにエラーメッセージが送信される
- ✅ メッセージ枠がロールバックされる
- ✅ エラーメッセージ送信失敗時もログが記録される

## 要件との対応

| 要件 | 内容                                | 実装箇所           | 状態 |
| ---- | ----------------------------------- | ------------------ | ---- |
| 4.1  | LINE API エラーのログ記録           | webhook.js:259-263 | ✅   |
| 4.2  | LINE API エラー時のメッセージ送信   | webhook.js:272-280 | ✅   |
| 4.3  | Vision API エラーのログ記録         | webhook.js:375-379 | ✅   |
| 4.4  | Vision API エラー時のメッセージ送信 | webhook.js:385-393 | ✅   |
| 4.5  | エラー時のメッセージ枠保護          | 全エラーパスで実装 | ✅   |

## エラーメッセージ一覧

| エラー種別         | メッセージ                                                                             |
| ------------------ | -------------------------------------------------------------------------------------- |
| LINE API エラー    | 画像の取得に失敗しました。しばらく時間をおいてから再度お試しください。                 |
| 画像サイズ超過     | 画像サイズが大きすぎます（最大 10MB）                                                  |
| 画像形式エラー     | サポートされていない画像形式です                                                       |
| Vision API エラー  | 画像の分析に失敗しました。しばらく時間をおいてから再度お試しください。                 |
| データベースエラー | 申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。 |
| 一般的なエラー     | 申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。 |

## 手動テスト手順

### 1. LINE API エラーのテスト

**シナリオ**: 無効なメッセージ ID で画像を取得しようとする

1. プレミアムユーザーとしてログイン
2. 画像を送信
3. LINE API が画像取得に失敗する（無効なメッセージ ID）
4. **期待結果**:
   - エラーログに "LINE API error while fetching image" が記録される
   - ユーザーに「画像の取得に失敗しました」メッセージが送信される
   - メッセージ枠が減っていない（ロールバックされた）

### 2. 画像検証エラーのテスト

**シナリオ**: 10MB 以上の画像を送信

1. プレミアムユーザーとしてログイン
2. 10MB 以上の画像を送信
3. **期待結果**:
   - エラーログに "Image validation failed" が記録される
   - ユーザーに「画像サイズが大きすぎます（最大 10MB）」メッセージが送信される
   - メッセージ枠が減っていない（ロールバックされた）

### 3. Vision API エラーのテスト

**シナリオ**: Vision API が一時的に利用できない

1. プレミアムユーザーとしてログイン
2. 画像を送信
3. Vision API がエラーを返す
4. **期待結果**:
   - エラーログに "Vision API error" が記録される
   - ユーザーに「画像の分析に失敗しました」メッセージが送信される
   - メッセージ枠が減っていない（ロールバックされた）

### 4. データベースエラーのテスト

**シナリオ**: データベース接続が失敗

1. プレミアムユーザーとしてログイン
2. データベース接続を一時的に切断
3. 画像を送信
4. **期待結果**:
   - エラーログに "Database error in image processing" が記録される
   - ユーザーに「エラーが発生しました」メッセージが送信される
   - メッセージ枠が減っていない（ロールバックされた）

## ログ出力例

### LINE API エラー

```json
{
  "level": "error",
  "message": "LINE API error while fetching image:",
  "error": "Failed to fetch message content",
  "userId": "U1234567890abcdef",
  "stack": "Error: Failed to fetch message content\n    at ..."
}
```

### Vision API エラー

```json
{
  "level": "error",
  "message": "Vision API error:",
  "error": "API quota exceeded",
  "userId": "U1234567890abcdef",
  "stack": "Error: API quota exceeded\n    at ..."
}
```

### 画像検証エラー

```json
{
  "level": "warn",
  "message": "Image validation failed",
  "userId": "U1234567890abcdef",
  "error": "画像サイズが大きすぎます（最大10MB）",
  "imageSize": 12582912
}
```

## まとめ

すべてのエラーシナリオで以下が実装されています：

1. ✅ **エラーログの記録**: すべてのエラーで詳細なログが記録される
2. ✅ **ユーザーへのエラーメッセージ送信**: ユーザーフレンドリーなメッセージが送信される
3. ✅ **メッセージ枠の保護**: すべてのエラーパスで `rollbackMessageLimit` が呼び出される
4. ✅ **スタックトレースの記録**: デバッグのためにスタックトレースが記録される
5. ✅ **ネストされたエラーハンドリング**: エラーメッセージ送信やロールバック失敗時もログが記録される

これにより、要件 4.1, 4.2, 4.3, 4.4, 4.5 がすべて満たされています。
