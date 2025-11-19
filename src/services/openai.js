const { OpenAI } = require('openai');
const logger = require('../utils/logger');

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
  defaultQuery: { 'api-version': '2024-02-15-preview' },
  defaultHeaders: {
    'api-key': process.env.AZURE_OPENAI_API_KEY,
  },
});

async function getChatResponse(conversationHistory) {
  try {
    // 会話履歴をOpenAI形式に変換
    const messages = [
      {
        role: 'system',
        content: 'あなたは親切で丁寧なアシスタントです。ユーザーの質問に適切に答えてください。'
      },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    ];

    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    return response.choices[0].message.content;
  } catch (error) {
    logger.error('OpenAI API error:', error);
    throw new Error('AI応答の生成に失敗しました');
  }
}

module.exports = {
  getChatResponse
};