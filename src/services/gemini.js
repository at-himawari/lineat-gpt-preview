const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

async function getChatResponse(userMessage, conversationHistory = []) {
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
          text: `あなたはユーザーの秘書です。ユーザーの指示に的確に答えてください。最新の情報や天気など、あなたの知識にない情報はGoogle検索機能を使って調べ、その結果に基づいて回答してください。
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

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

module.exports = {
  getChatResponse,
};
