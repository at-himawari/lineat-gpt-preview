# 設計書

## 概要

本設計書は、LINE Bot に画像認識機能を追加するための詳細な設計を定義します。この機能により、プレミアムサブスクリプションを持つユーザーは、画像を送信して Google Gemini の Vision API による画像分析結果を受け取ることができます。画像メッセージは会話履歴に統合され、文脈を考慮した応答が可能になります。

## アーキテクチャ

### システムフロー

```
LINE User (Premium) → Image Message → LINE Messaging API
                                            ↓
                                      API Gateway
                                            ↓
                                      Lambda Handler
                                            ↓
                                    Premium Check (DB)
                                            ↓
                                    [Premium: Yes]
                                            ↓
                                    Get Image Content
                                    (LINE Content API)
                                            ↓
                                    Validate Image
                                    (Size, Format)
                                            ↓
                                    Get Conversation History (DB)
                                            ↓
                                    Gemini Vision API
                                    (Premium Model)
                                            ↓
                                    Save to DB
                                            ↓
                                    Reply to User
```

### 非プレミアムユーザーのフロー

```
LINE User (Non-Premium) → Image Message → LINE Messaging API
                                                ↓
                                          API Gateway
                                                ↓
                                          Lambda Handler
                                                ↓
                                      Premium Check (DB)
                                                ↓
                                      [Premium: No]
                                                ↓
                                      Send Premium Offer
                                      + Checkout Link
```

## コンポーネントとインターフェース

### 1. Webhook Handler の拡張 (`src/handlers/webhook.js`)

既存の webhook handler に画像メッセージ処理を追加します。

**変更点:**

- 画像メッセージタイプの検出
- プレミアムステータスの確認
- 画像コンテンツの取得と検証
- Gemini Vision API の呼び出し

**インターフェース:**

```javascript
// 既存の処理に追加
if (messageType === "image") {
  // プレミアムチェック
  const userStatus = await getUserModelStatus(userId);

  if (!userStatus.hasPremium) {
    // プレミアムプラン案内を送信
    await sendPremiumOffer(client, lineEvent.replyToken);
    continue;
  }

  // メッセージ制限チェック
  const limitCheck = await checkAndUpdateMessageLimit(userId);
  if (!limitCheck.allowed) {
    // 枠超過処理
    continue;
  }

  // 画像コンテンツを取得
  const imageContent = await getImageContent(lineEvent.message.id, client);

  // 画像を検証
  const validation = validateImage(imageContent);
  if (!validation.valid) {
    await sendErrorMessage(client, lineEvent.replyToken, validation.error);
    continue;
  }

  // 会話履歴を取得（画像データを含む）
  const conversationHistory = await getConversationHistoryWithImages(userId, 10);

  // Gemini Vision API で画像を分析
  const analysis = await analyzeImage(imageContent, conversationHistory, "premium");

  // 結果を保存（画像データとMIMEタイプを含む）
  await saveImageMessage(userId, imageContent, validation.mimeType);
  await saveMessage(userId, "assistant", analysis);

  // 返信
  await client.replyMessage({
    replyToken: lineEvent.replyToken,
    messages: [{ type: "text", text: analysis }]
  });
}
```

### 2. LINE Content API サービス (`src/services/line.js` に追加)

LINE Messaging API から画像コンテンツを取得する機能を追加します。

**新規関数:**

```javascript
/**
 * LINE Messaging API から画像コンテンツを取得
 * @param {string} messageId - メッセージID
 * @param {MessagingApiClient} client - LINE SDK クライアント
 * @returns {Promise<Buffer>} 画像データ
 */
async function getImageContent(messageId, client) {
  // LINE Content API を使用して画像を取得
  const stream = await client.getMessageContent(messageId);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

module.exports = {
  getImageContent,
};
```

### 2.5. データベースサービスの拡張 (`src/services/database.js` に追加)

画像データを保存する機能を追加します。

**新規関数:**

```javascript
/**
 * 画像メッセージを保存
 * @param {string} userId - LINE ユーザーID
 * @param {Buffer} imageBuffer - 画像データ
 * @param {string} mimeType - 画像のMIMEタイプ
 * @returns {Promise<void>}
 */
async function saveImageMessage(userId, imageBuffer, mimeType) {
  try {
    const conn = await getConnection();

    // ユーザーIDを取得
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error("User not found");
    }

    const userDbId = userRows[0].id;

    // 画像をBase64エンコード
    const base64Image = imageBuffer.toString("base64");

    // 画像メッセージを保存
    await conn.execute(
      "INSERT INTO messages (user_id, role, content, image_data, image_mime_type, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
      [userDbId, "user", "[画像]", base64Image, mimeType]
    );

    logger.info(
      `Image message saved for user: ${userId}, mimeType: ${mimeType}`
    );
  } catch (error) {
    logger.error("Database error in saveImageMessage:", error);
    throw error;
  }
}

/**
 * 画像を含む会話履歴を取得
 * @param {string} userId - LINE ユーザーID
 * @param {number} limit - 取得件数
 * @returns {Promise<Array>} 会話履歴（画像データを含む）
 */
async function getConversationHistoryWithImages(userId, limit = 10) {
  try {
    const conn = await getConnection();

    const limitInt = parseInt(limit, 10);

    const [rows] = await conn.execute(
      `SELECT m.role, m.content, m.image_data, m.image_mime_type, m.created_at
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE u.line_user_id = ?
       ORDER BY m.created_at DESC
       LIMIT ${limitInt}`,
      [userId]
    );

    logger.info(
      `Retrieved ${rows.length} messages (with images) for user: ${userId}`
    );

    // 時系列順に並び替え
    return rows.reverse();
  } catch (error) {
    logger.error("Database error in getConversationHistoryWithImages:", error);
    throw error;
  }
}

module.exports = {
  // ... 既存のエクスポート
  saveImageMessage,
  getConversationHistoryWithImages,
};
```

### 3. 画像検証ユーティリティ (`src/utils/imageValidator.js` - 新規)

画像のサイズと形式を検証します。

**インターフェース:**

```javascript
/**
 * 画像データを検証
 * @param {Buffer} imageBuffer - 画像データ
 * @returns {{valid: boolean, error?: string, mimeType?: string}}
 */
function validateImage(imageBuffer) {
  // サイズチェック (10MB制限)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (imageBuffer.length > MAX_SIZE) {
    return { valid: false, error: "画像サイズが大きすぎます（最大10MB）" };
  }

  // MIME タイプを検出
  const mimeType = detectMimeType(imageBuffer);
  const supportedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  if (!supportedTypes.includes(mimeType)) {
    return { valid: false, error: "サポートされていない画像形式です" };
  }

  return { valid: true, mimeType };
}

/**
 * バイナリデータから MIME タイプを検出
 * @param {Buffer} buffer - 画像データ
 * @returns {string} MIME タイプ
 */
function detectMimeType(buffer) {
  // マジックナンバーで判定
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return "unknown";
}

module.exports = {
  validateImage,
  detectMimeType,
};
```

### 4. Gemini Vision API サービス (`src/services/gemini.js` に追加)

既存の Gemini サービスに画像分析機能を追加します。

**新規関数:**

```javascript
/**
 * 画像を分析して説明を生成
 * @param {Buffer} imageBuffer - 画像データ
 * @param {Array} conversationHistory - 会話履歴
 * @param {string} modelType - モデルタイプ ("basic" | "premium")
 * @param {string} userPrompt - ユーザーからのテキスト（オプション）
 * @returns {Promise<string>} 画像の説明
 */
async function analyzeImage(
  imageBuffer,
  conversationHistory = [],
  modelType = "premium",
  userPrompt = null
) {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const charLimit = process.env.GEMINI_RESPONSE_CHAR_LIMIT || "300";

    // システムプロンプト
    const systemInstruction = {
      role: "user",
      parts: [
        {
          text: `あなたはユーザーの秘書です。画像の内容を分析し、的確に説明してください。
          なるべく親しみやすい口調で話してください。
          返信は、LINEでの会話に適した読みやすい長さで、**必ず${charLimit}文字以内**で簡潔に返してください。`,
        },
      ],
    };

    // 会話履歴を変換（画像データを含む）
    let contents = [systemInstruction];

    conversationHistory.forEach((msg) => {
      const parts = [];

      // テキストコンテンツを追加
      parts.push({ text: msg.content });

      // 画像データがある場合は追加
      if (msg.image_data && msg.image_mime_type) {
        parts.push({
          inlineData: {
            mimeType: msg.image_mime_type,
            data: msg.image_data,
          },
        });
      }

      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: parts,
      });
    });

    // 最初が'model'の場合は削除
    while (contents.length > 1 && contents[1].role === "model") {
      contents.splice(1, 1);
    }

    // 画像データを Base64 エンコード
    const base64Image = imageBuffer.toString("base64");

    // 画像とプロンプトを追加
    const imagePart = {
      inlineData: {
        mimeType: "image/jpeg", // 実際の MIME タイプを使用
        data: base64Image,
      },
    };

    const textPart = {
      text: userPrompt || "この画像について説明してください。",
    };

    contents.push({
      role: "user",
      parts: [textPart, imagePart],
    });

    // モデルを選択（プレミアムのみ）
    const model = process.env.GEMINI_PREMIUM_MODEL || "gemini-2.5-flash";

    const config = {
      maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "1"),
    };

    // ストリーミングで応答を取得
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    let fullText = "";
    for await (const chunk of response) {
      if (chunk.text) {
        fullText += chunk.text;
      }
    }

    if (!fullText) {
      logger.error("No text in Gemini Vision response");
      throw new Error("画像分析の応答がありませんでした");
    }

    return fullText;
  } catch (error) {
    logger.error("Gemini Vision API error:", {
      message: error.message,
      status: error.status,
      stack: error.stack,
    });
    throw new Error("画像分析に失敗しました: " + error.message);
  }
}

module.exports = {
  getChatResponse,
  analyzeImage, // 新規エクスポート
};
```

## データモデル

画像サポートのために `messages` テーブルを拡張します。

**messages テーブル (拡張):**

- `id`: INT (主キー)
- `user_id`: INT (外部キー)
- `role`: ENUM('user', 'assistant', 'system') - メッセージの送信者
- `content`: TEXT - テキストメッセージ（画像の場合は「[画像]」）
- `image_data`: MEDIUMTEXT (NULL 可) - Base64 エンコードされた画像データ
- `image_mime_type`: VARCHAR(50) (NULL 可) - 画像の MIME タイプ (image/jpeg, image/png, image/gif, image/webp)
- `created_at`: TIMESTAMP

**users テーブル (既存):**

- `has_premium_model`: BOOLEAN - プレミアムアクセス
- `subscription_status`: VARCHAR(50) - サブスクリプションステータス
- `message_count_3days`: INT - メッセージ使用回数

**マイグレーション:**

`database/migration_add_image_support.sql` を実行して、既存の `messages` テーブルに画像データ用のカラムを追加します。

**画像データの保存形式:**

- 画像データは Base64 エンコードして `image_data` カラムに保存
- MIME タイプは `image_mime_type` カラムに保存
- `content` カラムには「[画像]」というテキストを保存（会話履歴の表示用）
- MEDIUMTEXT は最大 16MB まで保存可能（10MB 制限内で十分）

**会話履歴での画像の扱い:**

会話履歴を取得する際、画像データは以下のように処理されます：

1. **テキストベースの会話履歴（既存の動作）:**

   - `getConversationHistory` 関数は `content` カラムのみを返す
   - 画像メッセージは「[画像]」というテキストとして表示される
   - これにより、テキストのみの会話でも文脈が維持される

2. **画像を含む会話履歴（Vision API 用）:**

   - 新しい `getConversationHistoryWithImages` 関数を追加
   - `image_data` と `image_mime_type` カラムも取得
   - 画像データがある場合は、Base64 データと MIME タイプを返す
   - Vision API に送信する際、画像データを含めて文脈を提供

3. **メモリ効率:**
   - 通常のテキスト会話では画像データを読み込まない
   - 画像分析時のみ、必要に応じて画像データを取得
   - 会話履歴は最新 10 件に制限（既存の動作）

## 正確性プロパティ

_プロパティとは、システムのすべての有効な実行において真であるべき特性または動作です。プロパティは、人間が読める仕様と機械で検証可能な正確性保証の橋渡しとなります。_

### プロパティ 1: プレミアムチェックの実行

_任意の_ 画像メッセージに対して、システムはデータベースからユーザーのサブスクリプション状態を確認する必要がある
**検証: 要件 1.1, 5.2**

### プロパティ 2: 非プレミアムユーザーへの案内

_任意の_ プレミアムサブスクリプションを持たないユーザーが画像メッセージを送信した場合、システムはプレミアムプラン案内メッセージと決済リンクを返信する必要がある
**検証: 要件 1.2**

### プロパティ 3: プレミアムユーザーの画像処理

_任意の_ プレミアムサブスクリプションを持つユーザーが画像メッセージを送信した場合、システムは LINE Messaging API から画像コンテンツを取得し、Vision API で分析し、結果を返信する必要がある
**検証: 要件 1.3, 1.4, 1.5, 1.6**

### プロパティ 4: 会話履歴の保存

_任意の_ 画像メッセージ処理が完了した場合、システムは画像データを Base64 エンコードして、MIME タイプと共に会話履歴に保存し、AI 応答を通常のテキストとして保存する必要がある
**検証: 要件 1.7, 6.4, 6.5**

### プロパティ 5: テキスト付き画像の処理

_任意の_ プレミアムユーザーが画像とテキストを同時に送信した場合、システムは両方のコンテンツを Vision API に送信し、テキストの質問に基づいた分析結果を返信する必要がある
**検証: 要件 2.1, 2.2, 2.4**

### プロパティ 6: メッセージ枠の減算

_任意の_ プレミアムユーザーが画像メッセージを送信した場合、システムはメッセージ枠を 1 減算し、データベースに記録する必要がある
**検証: 要件 3.1, 3.3**

### プロパティ 7: 枠超過時の決済リンク送信

_任意の_ メッセージ枠がゼロのユーザーが画像メッセージを送信した場合、システムは決済リンクを送信する必要がある
**検証: 要件 3.2**

### プロパティ 8: LINE API エラーハンドリング

_任意の_ LINE Messaging API からの画像コンテンツ取得が失敗した場合、システムはエラーログを記録し、ユーザーにエラーメッセージを返信する必要がある
**検証: 要件 4.1, 4.2**

### プロパティ 9: Vision API エラーハンドリング

_任意の_ Vision API 呼び出しが失敗した場合、システムはエラーログを記録し、ユーザーにエラーメッセージを返信する必要がある
**検証: 要件 4.3, 4.4**

### プロパティ 10: エラー時の枠保護

_任意の_ エラーが発生した場合、システムはメッセージ枠を減算してはならない
**検証: 要件 4.5**

### プロパティ 11: プレミアムモデルの使用

_任意の_ プレミアムユーザーの画像分析において、システムは Vision API 呼び出し時にプレミアムモデルを使用する必要がある
**検証: 要件 5.1**

### プロパティ 12: 会話履歴の統合

_任意の_ 画像メッセージ処理において、システムは会話履歴を取得し、Vision API リクエストに含める必要がある
**検証: 要件 6.1, 6.2**

### プロパティ 13: 画像サイズの検証

_任意の_ 画像データに対して、システムはサイズを確認し、10MB を超える場合はエラーメッセージを返信する必要がある
**検証: 要件 7.1, 7.2**

### プロパティ 14: 画像形式の検証

_任意の_ 画像データに対して、システムは形式を確認し、サポートされていない形式（JPEG、PNG、GIF、WebP 以外）の場合はエラーメッセージを返信する必要がある
**検証: 要件 7.3, 7.4**

## エラーハンドリング

### エラーシナリオと対応

1. **LINE API エラー**

   - 画像コンテンツ取得失敗
   - 対応: エラーログ記録 + ユーザーへのエラーメッセージ送信
   - メッセージ枠は減算しない

2. **Vision API エラー**

   - API 呼び出し失敗
   - タイムアウト
   - 対応: エラーログ記録 + ユーザーへのエラーメッセージ送信
   - メッセージ枠は減算しない

3. **画像検証エラー**

   - サイズ超過（10MB 以上）
   - サポートされていない形式
   - 対応: ユーザーへのエラーメッセージ送信
   - メッセージ枠は減算しない

4. **データベースエラー**
   - 接続失敗
   - クエリエラー
   - 対応: エラーログ記録 + ユーザーへのエラーメッセージ送信
   - 処理を中断

### エラーメッセージ例

```javascript
const ERROR_MESSAGES = {
  IMAGE_TOO_LARGE:
    "画像サイズが大きすぎます（最大10MB）。小さい画像を送信してください。",
  UNSUPPORTED_FORMAT:
    "サポートされていない画像形式です。JPEG、PNG、GIF、WebPのいずれかを送信してください。",
  LINE_API_ERROR:
    "画像の取得に失敗しました。しばらく時間をおいてから再度お試しください。",
  VISION_API_ERROR:
    "画像の分析に失敗しました。しばらく時間をおいてから再度お試しください。",
  DATABASE_ERROR:
    "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
  NOT_PREMIUM: "画像認識機能はプレミアムプラン限定です。",
};
```

## テスト戦略

### ユニットテスト

ユニットテストは、個々の関数とコンポーネントの動作を検証します。

**テスト対象:**

1. **画像検証関数 (`validateImage`)**

   - 有効な画像（JPEG、PNG、GIF、WebP）
   - サイズ超過の画像
   - サポートされていない形式

2. **MIME タイプ検出 (`detectMimeType`)**

   - 各形式のマジックナンバー検証

3. **エラーメッセージ生成**
   - 各エラーシナリオでの適切なメッセージ

### プロパティベーステスト

プロパティベーステストは、すべての入力に対して成り立つべき普遍的なプロパティを検証します。

**使用ライブラリ:** `fast-check` (JavaScript 用プロパティベーステストライブラリ)

**テスト設定:**

- 各プロパティテストは最低 100 回の反復を実行
- ランダムな入力データを生成してプロパティを検証

**テスト対象プロパティ:**

1. **プロパティ 1: プレミアムチェックの実行**

   - ランダムなユーザー ID と画像メッセージに対して、データベースクエリが実行されることを検証

2. **プロパティ 2: 非プレミアムユーザーへの案内**

   - ランダムな非プレミアムユーザーに対して、案内メッセージと決済リンクが返信されることを検証

3. **プロパティ 6: メッセージ枠の減算**

   - ランダムなプレミアムユーザーの画像送信に対して、枠が 1 減ることを検証

4. **プロパティ 10: エラー時の枠保護**

   - ランダムなエラーシナリオに対して、枠が減算されないことを検証

5. **プロパティ 13: 画像サイズの検証**

   - ランダムなサイズの画像データに対して、10MB 超過時にエラーが返されることを検証

6. **プロパティ 14: 画像形式の検証**
   - ランダムな形式の画像データに対して、サポートされていない形式でエラーが返されることを検証

**プロパティテストの例:**

```javascript
// fast-check を使用したプロパティテスト
const fc = require("fast-check");
const { validateImage } = require("../utils/imageValidator");

describe("Property: 画像サイズの検証", () => {
  it("10MBを超える画像はエラーを返す", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({
          minLength: 10 * 1024 * 1024 + 1,
          maxLength: 20 * 1024 * 1024,
        }),
        (imageData) => {
          const result = validateImage(Buffer.from(imageData));
          return !result.valid && result.error.includes("大きすぎます");
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### 統合テスト

統合テストは、複数のコンポーネントが連携して動作することを検証します。

**テストシナリオ:**

1. **プレミアムユーザーの画像送信フロー**

   - 画像メッセージ受信 → プレミアムチェック → 画像取得 → 分析 → 返信 → DB 保存

2. **非プレミアムユーザーの画像送信フロー**

   - 画像メッセージ受信 → プレミアムチェック → 案内メッセージ送信

3. **エラーハンドリングフロー**
   - LINE API エラー → エラーログ → エラーメッセージ送信
   - Vision API エラー → エラーログ → エラーメッセージ送信

## セキュリティ考慮事項

1. **画像データの検証**

   - サイズ制限（10MB）を厳格に適用
   - サポートされている形式のみを許可

2. **プレミアムアクセス制御**

   - すべての画像処理前にプレミアムステータスを確認
   - データベースから最新のサブスクリプション状態を取得

3. **エラー情報の保護**

   - ユーザーには一般的なエラーメッセージのみを表示
   - 詳細なエラー情報はログに記録

4. **メッセージ枠の保護**
   - エラー時には枠を減算しない
   - トランザクション処理で整合性を保証

## パフォーマンス考慮事項

1. **画像データの処理**

   - 画像データはメモリ上で処理（一時ファイルは作成しない）
   - 10MB 制限により、メモリ使用量を制御

2. **Vision API 呼び出し**

   - タイムアウト設定を適用
   - エラー時のリトライは実装しない（ユーザーに再送信を促す）

3. **データベースクエリ**
   - 既存のコネクションプールを使用
   - 会話履歴は最新 10 件に制限

## デプロイメント考慮事項

1. **環境変数**

   - 既存の環境変数を使用（`GEMINI_PREMIUM_MODEL`、`GEMINI_API_KEY`など）
   - 新規の環境変数は不要

2. **依存関係**

   - 新規パッケージ: なし（既存の `@google/genai` と `@line/bot-sdk` を使用）

3. **データベース変更**

   - スキーマ変更なし（既存のテーブルを使用）

4. **Lambda 設定**
   - メモリ: 512MB 以上を推奨（画像処理のため）
   - タイムアウト: 30 秒以上を推奨（Vision API 呼び出しのため）
