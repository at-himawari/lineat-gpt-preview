const { getChatResponse } = require('./openai');
const { saveMessage, getConversationHistory, createOrUpdateUser } = require('./database');
const logger = require('../utils/logger');

async function handleMessage(client, event) {
  try {
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    // ユーザー情報を作成/更新
    await createOrUpdateUser(userId);

    // ユーザーメッセージを保存
    await saveMessage(userId, 'user', userMessage);

    // 会話履歴を取得（最新10件）
    const conversationHistory = await getConversationHistory(userId, 10);

    // Azure OpenAIから応答を取得
    const aiResponse = await getChatResponse(conversationHistory);

    // AI応答を保存
    await saveMessage(userId, 'assistant', aiResponse);

    // LINEに返信
    await client.replyMessage(replyToken, {
      type: 'text',
      text: aiResponse
    });

    logger.info(`Message handled for user: ${userId}`);
  } catch (error) {
    logger.error('Error handling message:', error);
    
    // エラー時の返信
    try {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。'
      });
    } catch (replyError) {
      logger.error('Error sending error reply:', replyError);
    }
  }
}

module.exports = {
  handleMessage
};