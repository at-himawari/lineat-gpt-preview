const { OpenAI } = require("openai");
const logger = require("../utils/logger");

async function getChatResponse(userMessage, conversationHistory = []) {
  try {
    // Azure OpenAIクライアントの初期化
    const openai = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}`,
      defaultQuery: { "api-version": "2024-02-15-preview" },
      defaultHeaders: {
        "api-key": process.env.AZURE_OPENAI_API_KEY,
      },
    });

    // メッセージの構築
    const messages = [
      {
        role: "system",
        content:
          "あなたはあざらしGPTです。あざらしとして振る舞いながら、ユーザーをカウンセリングしてください。ユーザーのメッセージに丁寧に答えてください。分からないことや曖昧なことは、わからないとはっきり伝えましょう。医学的･心理学見地からもアドバイスを行ってください。",
      },
      // 会話履歴を追加（DBから取得したデータをOpenAI形式に変換）
      ...conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      // 現在のユーザーメッセージ
      {
        role: "user",
        content: userMessage,
      },
    ];

    logger.info("Calling Azure OpenAI", {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messageCount: messages.length,
    });

    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: messages,
      max_completion_tokens: 1000,
      temperature: 1,
    });

    logger.info("Azure OpenAI response received", {
      usage: response.usage,
    });

    return response.choices[0].message.content;
  } catch (error) {
    logger.error("OpenAI API error:", {
      message: error.message,
      status: error.status,
      type: error.type,
      response: error.response?.data,
    });
    throw new Error("AI応答の生成に失敗しました: " + error.message);
  }
}

module.exports = {
  getChatResponse,
};
