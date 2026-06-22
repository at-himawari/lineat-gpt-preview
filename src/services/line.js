const { getChatResponse } = require("./gemini");
const {
  saveMessage,
  getConversationHistory,
  createOrUpdateUser,
} = require("./database");
const logger = require("../utils/logger");
const LINE_LOADING_SECONDS = 30;

async function showLineLoadingAnimation(
  userId,
  loadingSeconds = LINE_LOADING_SECONDS
) {
  const response = await fetch("https://api.line.me/v2/bot/chat/loading/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      chatId: userId,
      loadingSeconds,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `LINE loading animation request failed: ${response.status} ${errorBody}`
    );
  }
}

async function handleMessage(client, event) {
  try {
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    if (event.source.type !== "group" && event.source.type !== "room") {
      try {
        await showLineLoadingAnimation(userId);
      } catch (loadingError) {
        logger.error("Failed to show LINE loading animation:", {
          error: loadingError.message,
          stack: loadingError.stack,
        });
      }
    }

    // ユーザー情報を作成/更新
    await createOrUpdateUser(userId);

    // ユーザーメッセージを保存
    await saveMessage(userId, "user", userMessage);

    // 5秒優先モードでは履歴を絞ってAI生成時間を短縮する
    const conversationHistory = await getConversationHistory(userId, 4);

    // Azure OpenAIから応答を取得
    const aiResponse = await getChatResponse(
      userMessage,
      conversationHistory.slice(0, -1)
    );

    await client.replyMessage(replyToken, {
      type: "text",
      text: aiResponse,
    });

    await saveMessage(userId, "assistant", aiResponse);

    logger.info(`Message handled for user: ${userId}`);
  } catch (error) {
    logger.error("Error handling message:", error);

    // エラー時の返信
    try {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
      });
    } catch (replyError) {
      logger.error("Error sending error reply:", replyError);
    }
  }
}

/**
 * LINE Messaging API から画像コンテンツを取得
 * @param {string} messageId - メッセージID
 * @param {MessagingApiClient} client - LINE SDK クライアント（未使用、互換性のため残す）
 * @returns {Promise<Buffer>} 画像データ
 */
async function getImageContent(messageId, client) {
  try {
    logger.info(`Fetching image content for message: ${messageId}`);

    // LINE SDK v8では MessagingApiBlobClient を使用
    const lineSDK = require("@line/bot-sdk");
    const blobClient = new lineSDK.messagingApi.MessagingApiBlobClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    // LINE Content API を使用して画像を取得
    const stream = await blobClient.getMessageContent(messageId);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const imageBuffer = Buffer.concat(chunks);
    logger.info(`Image content retrieved: ${imageBuffer.length} bytes`);

    return imageBuffer;
  } catch (error) {
    logger.error("Error fetching image content from LINE API:", {
      messageId,
      error: error.message,
      stack: error.stack,
    });
    throw new Error("画像の取得に失敗しました: " + error.message);
  }
}

module.exports = {
  handleMessage,
  getImageContent,
  showLineLoadingAnimation,
};
