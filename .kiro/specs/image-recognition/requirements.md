# 要件定義書

## はじめに

本システムは、LINE Bot に画像認識機能を追加し、ユーザーが送信した画像を Google Gemini の Vision API を使用して分析し、画像の内容を説明する機能を提供します。現在、画像メッセージは「テキストメッセージでお話しいただけると嬉しいです！」という応答で拒否されていますが、この機能により画像の内容を理解し、適切な応答を返すことができるようになります。

## 用語集

- **System**: LINE Bot システム全体
- **User**: LINE アプリケーションを使用してボットと対話するエンドユーザー
- **Image Message**: LINE Messaging API を通じて送信される画像タイプのメッセージ
- **Vision API**: Google Gemini の画像認識機能を提供する API
- **Message Content**: LINE Messaging API から取得される画像のバイナリデータ
- **Image Analysis**: Vision API による画像の内容分析と説明生成
- **Conversation History**: データベースに保存されるユーザーとの会話履歴
- **Message Quota**: ユーザーが 1 日に送信できるメッセージの上限数

## 要件

### 要件 1

**ユーザーストーリー:** プレミアムユーザーとして、画像を送信して AI にその内容を説明してもらいたい。そうすることで、画像に何が写っているかを理解できる。

#### 受入基準

1. WHEN User が Image Message を送信する THEN System はデータベースから User のサブスクリプション状態を確認する
2. WHEN User がプレミアムサブスクリプションを持たない THEN System はプレミアムプラン案内メッセージと決済リンクを返信する
3. WHEN User がプレミアムサブスクリプションを持つ THEN System は LINE Messaging API から Message Content を取得する
4. WHEN System が Message Content を取得する THEN System は Vision API に画像データを送信して Image Analysis を実行する
5. WHEN Vision API が Image Analysis を完了する THEN System は画像の説明テキストを生成する
6. WHEN System が画像の説明テキストを生成する THEN System は User に説明テキストを返信する
7. WHEN System が画像の説明を返信する THEN System は Conversation History に画像メッセージと説明を保存する

### 要件 2

**ユーザーストーリー:** プレミアムユーザーとして、画像と一緒にテキストメッセージを送信して、特定の質問に答えてもらいたい。そうすることで、画像について具体的な情報を得られる。

#### 受入基準

1. WHEN User がプレミアムサブスクリプションを持つ AND User が Image Message とテキストを同時に送信する THEN System は両方のコンテンツを取得する
2. WHEN System がテキストと画像を取得する THEN System は Vision API にテキストと画像の両方を送信する
3. WHEN Vision API がテキストと画像を処理する THEN System はテキストの質問に基づいて画像を分析する
4. WHEN System が分析結果を生成する THEN System はテキストの質問に対する回答を返信する

### 要件 3

**ユーザーストーリー:** プレミアムユーザーとして、画像送信時にもメッセージ枠が消費されることを理解したい。そうすることで、利用状況を把握できる。

#### 受入基準

1. WHEN User がプレミアムサブスクリプションを持つ AND User が Image Message を送信する THEN System は Message Quota を 1 減算する
2. WHEN Message Quota がゼロの状態で User が Image Message を送信する THEN System は決済リンクを送信する
3. WHEN System が Message Quota を更新する THEN System はデータベースに更新を記録する

### 要件 4

**ユーザーストーリー:** システム管理者として、画像取得エラーが発生した場合でも適切なエラーメッセージを返したい。そうすることで、ユーザーエクスペリエンスを維持できる。

#### 受入基準

1. WHEN LINE Messaging API からの Message Content 取得が失敗する THEN System はエラーログを記録する
2. WHEN Message Content 取得が失敗する THEN System は User にエラーメッセージを返信する
3. WHEN Vision API の呼び出しが失敗する THEN System はエラーログを記録する
4. WHEN Vision API の呼び出しが失敗する THEN System は User にエラーメッセージを返信する
5. WHEN エラーが発生する THEN System は Message Quota を減算しない

### 要件 5

**ユーザーストーリー:** プレミアムユーザーとして、プレミアムモデルを使用して画像を分析したい。そうすることで、より詳細で正確な画像分析結果を得られる。

#### 受入基準

1. WHEN User がプレミアムサブスクリプションを持つ THEN System は Vision API 呼び出し時にプレミアムモデルを使用する
2. WHEN System がモデルを選択する THEN System はデータベースからユーザーのサブスクリプション状態を取得する

### 要件 6

**ユーザーストーリー:** システム管理者として、画像メッセージの処理を会話履歴に統合したい。そうすることで、画像とテキストの混在した会話の文脈を維持できる。

#### 受入基準

1. WHEN System が画像メッセージを処理する THEN System は Conversation History を取得する
2. WHEN System が Image Analysis を実行する THEN System は Conversation History を Vision API に送信する
3. WHEN Vision API が応答を生成する THEN System は Conversation History の文脈を考慮した応答を生成する
4. WHEN System が応答を保存する THEN System は画像データを Base64 エンコードして Conversation History に保存する
5. WHEN System が画像データを保存する THEN System は画像の MIME タイプも記録する

### 要件 7

**ユーザーストーリー:** システム管理者として、画像データのサイズと形式を検証したい。そうすることで、システムの安定性を確保できる。

#### 受入基準

1. WHEN System が Message Content を取得する THEN System は画像データのサイズを確認する
2. WHEN 画像データが 10MB を超える THEN System はエラーメッセージを返信する
3. WHEN 画像データの形式がサポートされていない THEN System はエラーメッセージを返信する
4. WHEN System が画像データを検証する THEN System はサポートされる形式（JPEG、PNG、GIF、WebP）を確認する
