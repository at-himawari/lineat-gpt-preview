const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

async function getChatResponse(userMessage, conversationHistory = []) {
  try {
    // Gemini APIクライアントの初期化
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
      toolConfig: [{ google_search: {} }],
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

    // Gemini用に会話履歴を変換
    let history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    // Geminiでは履歴の最初は必ず'user'ロールである必要がある
    // 最初が'model'の場合は削除
    while (history.length > 0 && history[0].role === "model") {
      history.shift();
    }

    // チャットセッションを開始
    const chat = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "8000", 10),
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "1"),
      },
      systemInstruction: systemInstruction,
    });

    // メッセージを送信
    const result = await chat.sendMessage(userMessage);
    const response = result.response;

    // candidatesから最初のテキストを取得
    if (!response.candidates || response.candidates.length === 0) {
      logger.error("No candidates in Gemini response");
      throw new Error("Gemini APIから応答がありませんでした");
    }

    const candidate = response.candidates[0];
    const text = candidate.content.parts.map((part) => part.text).join("");

    return text;
  } catch (error) {
    logger.error("Gemini API error:", {
      message: error.message,
      status: error.status,
      response: error.response?.data,
    });
    throw new Error("AI応答の生成に失敗しました: " + error.message);
  }
}

module.exports = {
  getChatResponse,
};
