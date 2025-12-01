const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

async function getChatResponse(
  userMessage,
  conversationHistory = [],
  modelType = "basic"
) {
  try {
    // Gemini APIクライアントの初期化
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // 環境変数から文字数制限を取得（デフォルトは500文字）
    const charLimit = process.env.GEMINI_RESPONSE_CHAR_LIMIT || "300";

    // システムプロンプト
    const systemInstruction = {
      role: "user",
      parts: [
        {
          text: `あなたはユーザーの秘書です。ユーザーの指示に的確に答えてください。
          最新の情報や天気など、あなたの知識にない情報はGoogle検索機能を使って調べ、その結果に基づいて回答してください。
          なるべく親しみやすい口調で話してください。
          残り枠の表示はやめてください。
          返信は、LINEでの会話に適した読みやすい長さで、**必ず${charLimit}文字以内**で簡潔に返してください。`,
        },
      ],
    };

    // Gemini用に会話履歴を変換（システムプロンプトを先頭に追加）
    let contents = [systemInstruction];

    // 会話履歴を追加
    conversationHistory.forEach((msg) => {
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

    // Google Search toolsを有効化
    const tools = [{ googleSearch: {} }];

    const config = {
      tools,
      maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "1"),
    };

    // モデルタイプに基づいてモデルを選択
    let model;
    if (modelType === "premium") {
      model =
        process.env.GEMINI_PREMIUM_MODEL ||
        "gemini-2.0-flash-thinking-exp-01-21";
      logger.info("Using premium model:", model);
    } else {
      model =
        process.env.GEMINI_BASIC_MODEL ||
        process.env.GEMINI_MODEL ||
        "gemini-2.0-flash-exp";
      logger.info("Using basic model:", model);
    }

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
  mimeType = "image/jpeg"
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
        mimeType: mimeType,
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

    // モデルを選択（プレミアムモデルを使用）
    let model;
    if (modelType === "premium") {
      model = process.env.GEMINI_PREMIUM_MODEL || "gemini-2.0-flash-exp";
      logger.info("Using premium model for image analysis:", model);
    } else {
      model = process.env.GEMINI_BASIC_MODEL || "gemini-2.0-flash-exp";
      logger.info("Using basic model for image analysis:", model);
    }

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
  analyzeImage,
};
