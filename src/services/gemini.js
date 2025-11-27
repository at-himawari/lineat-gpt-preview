const { GoogleGenAI } = require("@google/genai");
const logger = require("../utils/logger");

async function getChatResponse(userMessage, conversationHistory = []) {
  try {
    // Gemini APIクライアントの初期化
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // システムプロンプト
    const systemInstruction = {
      role: "user",
      parts: [
        {
          text: "あなたはカウンセラーです。ユーザーをカウンセリングしてください。分からないことや曖昧なことは、わからないとはっきり伝えましょう。医学的･心理学知見からもアドバイスを行ってください。返信は簡潔で500文字以内で返して",
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
      thinkingConfig: {
        thinkingLevel: "HIGH",
      },
      tools,
      maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "1"),
    };

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

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
