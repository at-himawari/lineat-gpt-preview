const logger = require("../utils/logger");

async function webhookHandler(event, context) {
  logger.info("Webhook called", {
    headers: event.headers,
    bodyLength: event.body ? event.body.length : 0,
    isBase64Encoded: event.isBase64Encoded,
  });

  try {
    // 基本的な環境変数チェック
    if (
      !process.env.LINE_CHANNEL_ACCESS_TOKEN ||
      !process.env.LINE_CHANNEL_SECRET
    ) {
      logger.error("Missing LINE credentials");
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing LINE credentials" }),
      };
    }

    // リクエストボディの確認
    if (!event.body) {
      logger.error("No request body");
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No request body" }),
      };
    }

    // LINE SDKを読み込み
    let lineSDK;
    try {
      lineSDK = require("@line/bot-sdk");
    } catch (error) {
      logger.error("Failed to load LINE SDK:", error);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to load LINE SDK" }),
      };
    }

    const config = {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
    };

    // 新しいLINE SDK v8のクライアント
    const client = new lineSDK.messagingApi.MessagingApiClient(config);
    const crypto = require("crypto");

    // ボディの処理（Base64デコードが必要な場合）
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    // 署名の取得
    const signature =
      event.headers["x-line-signature"] ||
      event.headers["X-Line-Signature"] ||
      event.headers["X-LINE-SIGNATURE"];

    logger.info("Request details", {
      hasBody: !!body,
      hasSignature: !!signature,
      bodyLength: body ? body.length : 0,
      channelSecret: config.channelSecret ? "present" : "missing",
    });

    // LINE署名検証
    function validateLineSignature(body, signature, secret) {
      if (!signature || !secret) return false;

      const hash = crypto
        .createHmac("sha256", secret)
        .update(body, "utf8")
        .digest("base64");

      return hash === signature;
    }

    // 署名検証をスキップするかどうか
    const skipSignatureValidation =
      process.env.SKIP_SIGNATURE_VALIDATION === "true";

    if (!skipSignatureValidation) {
      if (!signature) {
        logger.error("No signature header");
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "No signature header" }),
        };
      }

      if (!validateLineSignature(body, signature, config.channelSecret)) {
        logger.error("Invalid signature");
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid signature" }),
        };
      }
    } else {
      logger.warn("Signature validation is SKIPPED - only for testing!");
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch (error) {
      logger.error("Failed to parse JSON body:", error);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    logger.info("Parsed body", {
      events: parsedBody.events?.length || 0,
      destination: parsedBody.destination,
    });

    // イベント処理（Azure OpenAI連携 + DB保存）
    if (parsedBody.events && parsedBody.events.length > 0) {
      for (const lineEvent of parsedBody.events) {
        logger.info("Processing event", {
          type: lineEvent.type,
          replyToken: lineEvent.replyToken ? "present" : "missing",
        });

        if (lineEvent.type === "message") {
          const messageType = lineEvent.message.type;

          // 画像メッセージの場合は非対応メッセージを返す
          if (messageType === "image") {
            try {
              await client.replyMessage({
                replyToken: lineEvent.replyToken,
                messages: [
                  {
                    type: "text",
                    text: "テキストメッセージでお話しいただけると嬉しいです！",
                  },
                ],
              });
            } catch (error) {
              logger.error("Failed to send image unsupported message:", error);
            }
            continue;
          }

          // テキストメッセージの処理
          if (messageType === "text") {
            try {
              const userId = lineEvent.source.userId;
              const userMessage = lineEvent.message.text;
              logger.info("User message received", {
                userId: userId,
                message: userMessage,
              });

              let conversationHistory = [];
              let dbAvailable = true;

              // データベース関連の処理（エラーが発生しても続行）
              try {
                const {
                  createOrUpdateUser,
                  saveMessage,
                  getConversationHistory,
                } = require("../services/database");

                // ユーザーを作成/更新
                await createOrUpdateUser(userId);

                // ユーザーメッセージを保存
                await saveMessage(userId, "user", userMessage);

                // 会話履歴を取得（最新10件）
                conversationHistory = await getConversationHistory(userId, 10);
                logger.info("Conversation history retrieved", {
                  historyCount: conversationHistory.length,
                });
              } catch (dbError) {
                logger.error("Database error (continuing without history):", {
                  error: dbError.message,
                  stack: dbError.stack,
                });
                dbAvailable = false;
              }

              // Azure OpenAIから応答を取得
              const { getChatResponse } = require("../services/openai");
              const aiResponse = await getChatResponse(
                userMessage,
                conversationHistory
              );

              logger.info("AI response generated", {
                responseLength: aiResponse.length,
                dbAvailable: dbAvailable,
              });

              // AI応答を保存（DBが利用可能な場合のみ）
              if (dbAvailable) {
                try {
                  const { saveMessage } = require("../services/database");
                  await saveMessage(userId, "assistant", aiResponse);
                } catch (dbError) {
                  logger.error("Failed to save AI response to DB:", dbError);
                }
              }

              const replyMessage = {
                type: "text",
                text: aiResponse,
              };

              await client.replyMessage({
                replyToken: lineEvent.replyToken,
                messages: [replyMessage],
              });

              logger.info("Reply sent successfully");
            } catch (replyError) {
              logger.error("Failed to process message:", {
                error: replyError.message,
                stack: replyError.stack,
                status: replyError.response?.status,
                data: replyError.response?.data,
              });

              // エラー時はエラーメッセージを返す
              try {
                await client.replyMessage({
                  replyToken: lineEvent.replyToken,
                  messages: [
                    {
                      type: "text",
                      text: "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
                    },
                  ],
                });
              } catch (errorReplyError) {
                logger.error("Failed to send error reply:", errorReplyError);
              }
            }
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "OK" }),
    };
  } catch (error) {
    logger.error("Webhook error:", {
      message: error.message,
      stack: error.stack,
    });
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

module.exports.handler = webhookHandler;
