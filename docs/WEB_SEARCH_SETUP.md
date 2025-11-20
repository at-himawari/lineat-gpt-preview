# Web 検索機能のセットアップガイド（完全無料版）

このボットには、**完全無料**の Web 検索機能が組み込まれています。

## 機能概要

ユーザーが以下のようなキーワードを含むメッセージを送信すると、自動的に Web 検索が実行されます：

- 「検索」「調べて」「探して」
- 「最新」「ニュース」
- 「今日」「現在」
- 「いつ」「どこ」「誰」「何」

検索結果は AI の回答に自動的に組み込まれ、より正確で最新の情報を提供できます。

## 無料検索 API

### 1. DuckDuckGo Instant Answer API（デフォルト・完全無料）

**特徴:**

- ✅ 完全無料
- ✅ API キー不要
- ✅ 制限なし
- ✅ セットアップ不要

**使い方:**
何もする必要はありません！デフォルトで有効になっています。

**制限事項:**

- 検索結果が限定的な場合がある
- リアルタイムニュースには弱い
- 日本語の結果が少ない場合がある

### 2. SerpApi（オプション・無料プラン月 100 回）

DuckDuckGo の結果が不十分な場合、自動的に SerpApi にフォールバックします。

**特徴:**

- ✅ 無料プラン: 月 100 回まで
- ✅ Google 検索結果を取得
- ✅ 日本語対応が充実
- ⚠️ API キーが必要

**セットアップ手順:**

1. **SerpApi アカウント作成**

   - https://serpapi.com/ にアクセス
   - 「Sign Up」をクリック
   - メールアドレスで無料登録

2. **API キーの取得**

   - ダッシュボードにログイン
   - 「API Key」セクションからキーをコピー

3. **環境変数の設定**

   `.env`ファイルに追加：

   ```bash
   SERPAPI_API_KEY=your_serpapi_key_here
   ```

4. **GitHub Secrets の設定（CI/CD 使用時）**

   リポジトリの Settings → Secrets and variables → Actions で追加：

   - `SERPAPI_API_KEY`: 取得した SerpApi API キー

## 動作の仕組み

```
ユーザーメッセージ
    ↓
キーワード検出（「調べて」など）
    ↓
1. DuckDuckGo APIで検索（無料・無制限）
    ↓
結果が少ない場合
    ↓
2. SerpApi APIで検索（月100回まで）
    ↓
検索結果をAIに渡す
    ↓
AIが検索結果を参考に回答生成
```

## 使用例

### ユーザー入力

```
今日の東京の天気を調べて
```

### ボットの動作

1. 「調べて」というキーワードを検出
2. DuckDuckGo API で「今日の東京の天気」を検索
3. 検索結果を AI に渡す
4. AI が検索結果を参考に回答を生成

### 応答例

```
今日の東京の天気について調べました🦭

【検索結果より】
東京の今日の天気は晴れ、最高気温は25度です。
午後から雲が増える予報となっています。

詳しい情報はこちらをご覧ください：
https://weather.example.com/tokyo
```

## トラブルシューティング

### 検索が実行されない

**原因:**

- キーワードが検出されていない
- API 接続エラー

**対処法:**

1. ログを確認（CloudWatch Logs）
2. 「調べて」「検索」などのキーワードを明示的に使う

### 検索結果が少ない

**原因:**

- DuckDuckGo の結果が限定的
- SerpApi が設定されていない

**対処法:**

1. SerpApi の API キーを設定（月 100 回まで無料）
2. より具体的な検索クエリを使う

### SerpApi の制限に達した

**原因:**

- 月 100 回の無料枠を使い切った

**対処法:**

1. DuckDuckGo のみで運用（完全無料）
2. 有料プランにアップグレード（$50/月で 5,000 回）
3. 翌月まで待つ

## 検索機能の無効化

Web 検索機能を完全に無効にしたい場合は、`src/services/openai.js`の`needsWebSearch`関数を以下のように変更：

```javascript
function needsWebSearch(message) {
  return false; // 常にfalseを返す
}
```

## カスタマイズ

### 検索トリガーキーワードの変更

`src/services/openai.js`の`needsWebSearch`関数を編集：

```javascript
function needsWebSearch(message) {
  const searchKeywords = [
    "検索",
    "調べて",
    "探して",
    // ここにキーワードを追加
    "教えて",
    "知りたい",
  ];
  return searchKeywords.some((keyword) => message.includes(keyword));
}
```

### 検索結果の件数変更

`src/services/openai.js`の`searchWeb`呼び出しを編集：

```javascript
// 3件 → 5件に変更
const searchResults = await searchWeb(userMessage, 5);
```

## コスト比較

| サービス        | 無料枠          | 有料プラン         | 特徴                   |
| --------------- | --------------- | ------------------ | ---------------------- |
| **DuckDuckGo**  | 無制限          | なし               | 完全無料、API キー不要 |
| **SerpApi**     | 月 100 回       | $50/月（5,000 回） | Google 検索、高品質    |
| ~~Bing Search~~ | ~~月 1,000 回~~ | ~~$7/月~~          | ~~削除済み~~           |

## おすすめ構成

### 個人利用・テスト環境

- DuckDuckGo のみ（完全無料）

### 本番環境・低頻度利用

- DuckDuckGo + SerpApi 無料プラン（月 100 回）

### 本番環境・高頻度利用

- DuckDuckGo + SerpApi 有料プラン（$50/月）

## まとめ

- **API キー不要**: DuckDuckGo がデフォルトで動作
- **完全無料**: 基本機能は追加コストなし
- **オプション強化**: SerpApi で検索品質向上（月 100 回無料）
- **簡単セットアップ**: 環境変数を設定するだけ
