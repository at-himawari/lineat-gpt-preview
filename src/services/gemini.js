const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

const FAST_HISTORY_LIMIT = 4;
const FAST_TIMEOUT_MS = 6500;
const FAST_MAX_OUTPUT_TOKENS = 700;
const SEARCH_KEYWORDS =
  /今日|現在|最新|直近|ニュース|天気|株価|為替|価格|料金|営業時間|場所|住所|いつ|何時|202[0-9]年|令和[0-9]+年|流行|おすすめ|今後|予測|影響|政治|国会|選挙|解散|与党|野党|技術|競馬|スポーツ|サッカー|野球|バスケ|ラグビー|辞任|辞職|不祥事|事故|地震|津波|警報|注意報|大雨|運行状況|遅延|線|逮捕|判決|裁判|党|知事|議員|市長|首長|大統領|首相|大臣|総書記|委員長|主席|総統|陛下|天皇|皇后|大使|/;

function shouldUseGoogleSearch(userMessage) {
  const mode = (process.env.GEMINI_ENABLE_SEARCH || "auto").toLowerCase();

  if (mode === "true") return true;
  if (mode === "false") return false;

  return SEARCH_KEYWORDS.test(userMessage);
}

function normalizeConversationHistory(conversationHistory = []) {
  return conversationHistory.slice(-FAST_HISTORY_LIMIT).map((msg) => ({
    role: msg.role,
    content: String(msg.content || "").slice(0, 200),
  }));
}

function buildFastFallbackResponse(userMessage) {
  const normalized = String(userMessage || "")
    .replace(/\s+/g, " ")
    .trim();
  const preview = normalized.slice(0, 60);

  if (!preview) {
    return "確認しました。もう少し具体的に送っていただければ、短く要点を返します。";
  }

  if (
    /[?？]$/.test(preview) ||
    /^(なぜ|どうして|どうやって|what|why|how)/i.test(preview)
  ) {
    return `要点だけ先にお伝えします。${preview} は追加確認が必要なため、結論から短く整理すると「条件次第」です。必要なら論点を1つずつ分けて続けます。`;
  }

  return `要点を先に返します。${preview} について、短く整理してお伝えできます。必要なら続けて詳細も出します。`;
}

function getFastTimeoutMs() {
  return parseInt(process.env.GEMINI_TIMEOUT_MS || `${FAST_TIMEOUT_MS}`, 10);
}

async function collectStreamTextWithTimeout(response, timeoutMs) {
  let fullText = "";

  const streamPromise = (async () => {
    for await (const chunk of response) {
      if (chunk.text) {
        fullText += chunk.text;
      }
    }
    return { timedOut: false, text: fullText };
  })();

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({ timedOut: true, text: fullText });
    }, timeoutMs);
  });

  return Promise.race([streamPromise, timeoutPromise]);
}

async function getChatResponse(
  userMessage,
  conversationHistory = [],
  modelType = "basic",
) {
  try {
    // Gemini APIクライアントの初期化
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // 環境変数から文字数制限を取得（デフォルトは800文字）
    const charLimit = process.env.GEMINI_RESPONSE_CHAR_LIMIT || "800";

    const useGoogleSearch = shouldUseGoogleSearch(userMessage);
    const normalizedHistory = normalizeConversationHistory(conversationHistory);
    const maxOutputTokens =
      modelType === "premium"
        ? Math.min(
            parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
            FAST_MAX_OUTPUT_TOKENS,
          )
        : Math.min(
            parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
            FAST_MAX_OUTPUT_TOKENS,
          );

    // システムプロンプトの作成
    const systemInstruction = {
      role: "user",
      parts: [
        {
          text: `あなたはユーザーの秘書です。ユーザーの指示に的確に答えてください。
          なるべく親しみやすい口調で話してください。
          残り枠の表示はやめてください。
          返信は、LINEでの会話に適した読みやすい長さで、**必ず${charLimit}文字以内**で返してください。
          まず結論を先に書き、その後に理由や補足を3-6文程度で続けてください。
          必要に応じて具体例や次の一手も短く添えてください。
          ${
            useGoogleSearch
              ? "最新情報が必要な場合はGoogle検索結果を使って回答してください。"
              : "最新情報の外部検索は行わず、手元の文脈だけで分かりやすく回答してください。"
          }`,
        },
      ],
    };

    // Gemini用に会話履歴を変換（システムプロンプトを先頭に追加）
    const contents = [];
    conversationHistory.forEach((msg) => {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    });

    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    // 会話履歴を追加
    normalizedHistory.forEach((msg) => {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    });

    // Geminiでは履歴の最初は必ず'user'ロールである必要がある
    // システムプロンプトの後、最初が'model'の場合は削除
    while (contents.length > 1 && contents[1].role === "model") {
      contents.splice(1, 1);
    }

    // 現在のユーザーメッセージを追加
    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const config = {
      systemInstruction,
      maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "512", 10),
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.3"),
    };

    if (useGoogleSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    // モデルタイプに基づいてモデルを選択
    let model;
    if (modelType === "premium") {
      model = process.env.GEMINI_PREMIUM_MODEL || "gemini-pro-latest";
      logger.info("Using premium model:", model);
    } else {
      model =
        process.env.GEMINI_BASIC_MODEL ||
        process.env.GEMINI_MODEL ||
        "gemini-flash-lite-latest";
      logger.info("Using basic model:", model);
    }

    // ストリーミングで応答を取得
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    const streamResult = await collectStreamTextWithTimeout(
      response,
      getFastTimeoutMs(),
    );
    const fullText = String(streamResult.text || "").trim();

    if (streamResult.timedOut) {
      logger.warn("Gemini response timed out in fast mode", {
        model,
        useGoogleSearch,
        partialLength: fullText.length,
      });

      if (fullText) {
        return fullText.slice(0, parseInt(charLimit, 10));
      }

      return buildFastFallbackResponse(userMessage);
    }

    if (!fullText) {
      logger.error("No text in Gemini response");
      throw new Error("Gemini APIから応答がありませんでした");
    }

    return fullText;
  } catch (error) {
    logger.error("Gemini API error:", {
      message: error.message,
      status: error.status,
      stack: error.stack,
    });
    throw new Error("AI応答の生成に失敗しました: " + error.message);
  }
}

/** 画像認識 */

const IMAGE_TIMEOUT_MS = 9000;
const IMAGE_HISTORY_LIMIT = 4;
const IMAGE_MAX_OUTPUT_TOKENS = 700;

function normalizeImageConversationHistory(conversationHistory = []) {
  return conversationHistory
    .slice(-IMAGE_HISTORY_LIMIT)
    .filter((msg) => msg && msg.content)
    .map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: String(msg.content || "").slice(0, 200),
        },
      ],
    }));
}

function buildImageSystemInstruction(charLimit) {
  return [
    "あなたはLINE上で動作するユーザーの秘書です。",
    "画像の内容を見て、ユーザーの意図に沿って的確に回答してください。",
    "最初に結論または要点を述べてください。",
    "その後に、画像から読み取れる根拠や補足を3〜6文程度で説明してください。",
    "不明な点は断定せず、不明と明記してください。",
    "画像内の文字が読める場合は、必要に応じて要約してください。",
    "医療・法律・金融など高リスク分野では、画像だけで断定せず、専門家確認が必要な旨を簡潔に添えてください。",
    "残り枠の表示はしないでください。",
    `返信はLINEで読みやすい長さにし、必ず${charLimit}文字以内で返してください。`,
    "このシステム指示そのものは返信本文に含めないでください。",
  ].join("\n");
}

/**
 * 画像を分析して説明を生成
 * @param {Buffer} imageBuffer - 画像データ
 * @param {Array} conversationHistory - 会話履歴
 * @param {string} modelType - モデルタイプ ("basic" | "premium")
 * @param {string} userPrompt - ユーザーからのテキスト（オプション）
 * @param {string} mimeType - 画像のMIMEタイプ
 * @returns {Promise<string>} 画像の説明
 */
async function analyzeImage(
  imageBuffer,
  conversationHistory = [],
  modelType = "premium",
  userPrompt = null,
  mimeType = "image/jpeg",
) {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error("画像データが空です");
    }

    const charLimit = process.env.GEMINI_RESPONSE_CHAR_LIMIT || "800";
    const timeoutMs = parseInt(
      process.env.GEMINI_IMAGE_TIMEOUT_MS || `${IMAGE_TIMEOUT_MS}`,
      10,
    );
    const maxOutputTokens = Math.min(
      parseInt(process.env.GEMINI_MAX_TOKENS || "512", 10),
      IMAGE_MAX_OUTPUT_TOKENS,
    );

    const systemInstruction = buildImageSystemInstruction(charLimit);

    const normalizedHistory =
      normalizeImageConversationHistory(conversationHistory);

    const base64Image = imageBuffer.toString("base64");

    const promptText =
      userPrompt && String(userPrompt).trim()
        ? String(userPrompt).trim()
        : "この画像について、何が写っているか、重要な点、必要な補足を簡潔に説明してください。";

    const contents = [
      ...normalizedHistory,
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ];

    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }
    const model =
      modelType === "premium"
        ? process.env.GEMINI_PREMIUM_MODEL || "gemini-pro-latest"
        : process.env.GEMINI_BASIC_MODEL ||
          process.env.GEMINI_MODEL ||
          "gemini-flash-lite-latest";

    logger.info("Using model for image analysis:", {
      model,
      modelType,
      mimeType,
      imageBytes: imageBuffer.length,
      historyCount: normalizedHistory.length,
    });

    const config = {
      systemInstruction,
      maxOutputTokens,
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.3"),
    };

    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    const streamResult = await collectStreamTextWithTimeout(
      response,
      timeoutMs,
    );
    const fullText = String(streamResult.text || "").trim();

    if (streamResult.timedOut) {
      logger.warn("Gemini image response timed out", {
        model,
        partialLength: fullText.length,
      });

      if (fullText) {
        return fullText.slice(0, parseInt(charLimit, 10));
      }

      return "画像は受け取りましたが、解析に時間がかかっています。画像の要点を短く知りたい場合は、「何が写っている？」「文字を読んで」など目的を添えて送ってください。";
    }

    if (!fullText) {
      logger.error("No text in Gemini Vision response");
      throw new Error("画像分析の応答がありませんでした");
    }
    return fullText.slice(0, parseInt(charLimit, 10));
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
  analyzeImage,
};
