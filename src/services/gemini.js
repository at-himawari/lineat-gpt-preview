const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

async function getChatResponse(userMessage, conversationHistory = []) {
  try {
    // Gemini APIクライアントの初期化
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
    });

    // システムプロンプト
    const systemInstruction = {
      role: "user",
      parts: [
        {
          text: "あなたはあざらしGPTです。あざらしとして振る舞いながら、ユーザーをカウンセリングしてください。ユーザーのメッセージに丁寧に答えてください。分からないことや曖昧なことは、わからないとはっきり伝えましょう。医学的･心理学知見からもアドバイスを行ってください。",
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
    logger.info("Sending message to Gemini", {
      userMessageLength: userMessage.length,
      historyLength: history.length,
    });

    const result = await chat.sendMessage(userMessage);

    logger.info("Gemini raw result", {
      resultKeys: Object.keys(result),
      responseKeys: result.response ? Object.keys(result.response) : null,
      candidates: result.response?.candidates?.length,
      promptFeedback: result.response?.promptFeedback,
    });

    const response = result.response;

    // candidatesから最初のテキストを取得
    if (!response.candidates || response.candidates.length === 0) {
      logger.error("No candidates in Gemini response", {
        response: JSON.stringify(response),
      });
      throw new Error("Gemini APIから応答がありませんでした");
    }

    const candidate = response.candidates[0];
    const text = candidate.content.parts.map((part) => part.text).join("");

    logger.info("Gemini response received", {
      responseLength: text.length,
      responsePreview: text.substring(0, 100),
    });

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
