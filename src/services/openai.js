const { OpenAI } = require("openai");
const logger = require("../utils/logger");
const { searchWeb, formatSearchResults } = require("./search");

/**
 * メッセージがWeb検索を必要とするか判定
 */
function needsWebSearch(message) {
  const searchKeywords = [
    "検索",
    "調べて",
    "探して",
    "最新",
    "ニュース",
    "今日",
    "現在",
    "いつ",
    "どこ",
    "誰",
    "何",
  ];
  return searchKeywords.some((keyword) => message.includes(keyword));
}

async function getChatResponse(userMessage, conversationHistory = []) {
  try {
    // Web検索が必要か判定
    let searchContext = "";
    if (needsWebSearch(userMessage)) {
      const searchResults = await searchWeb(userMessage, 3);
      if (searchResults.length > 0) {
        searchContext = `\n\n【参考情報（Web検索結果）】\n${formatSearchResults(
          searchResults
        )}`;
      }
    }

    // Azure OpenAIクライアントの初期化
    const openai = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}`,
      defaultQuery: { "api-version": "2024-02-15-preview" },
      defaultHeaders: {
        "api-key": process.env.AZURE_OPENAI_API_KEY,
      },
    });

    // システムプロンプト
    const systemPrompt =
      "あなたはあざらしGPTです。あざらしとして振る舞いながら、ユーザーをカウンセリングしてください。ユーザーのメッセージに丁寧に答えてください。分からないことや曖昧なことは、わからないとはっきり伝えましょう。医学的･心理学見地からもアドバイスを行ってください。" +
      (searchContext
        ? "\n\n※参考情報としてWeb検索結果が提供されている場合は、その情報を自然に活用して回答してください。必要に応じて情報源のURLも提示してください。参考情報は、自動的に追加されているので、ユーザには参考情報が追加されたことを明示しないでください。"
        : "");

    // メッセージの構築
    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      // 会話履歴を追加（DBから取得したデータをOpenAI形式に変換）
      ...conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      // 現在のユーザーメッセージ（検索結果を含む）
      {
        role: "user",
        content: userMessage + searchContext,
      },
    ];

    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: messages,
      max_completion_tokens: 1000,
      temperature: 1,
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
