const logger = require("../utils/logger");

// 処理済みreplyTokenを保持（Lambda実行中のみ有効）
const processedTokens = new Set();

async function webhookHandler(event, context) {
  logger.info("Webhook called", {
    headers: event.headers,
    bodyLength: event.body ? event.body.length : 0,
    isBase64Encoded: event.isBase64Encoded,
    requestId: context.requestId,
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

    // イベント処理（Gemini API連携 + DB保存）
    if (parsedBody.events && parsedBody.events.length > 0) {
      for (const lineEvent of parsedBody.events) {
        // replyTokenの重複チェック
        if (lineEvent.replyToken && processedTokens.has(lineEvent.replyToken)) {
          logger.warn("Duplicate replyToken detected, skipping", {
            replyToken: lineEvent.replyToken,
          });
          continue;
        }

        logger.info("Processing event", {
          type: lineEvent.type,
          replyToken: lineEvent.replyToken ? "present" : "missing",
          eventId: lineEvent.webhookEventId,
        });

        // replyTokenを処理済みとしてマーク
        if (lineEvent.replyToken) {
          processedTokens.add(lineEvent.replyToken);
        }

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
              let modelType = "basic"; // デフォルトは基本モデル
              let userStatus = null;

              // データベース関連の処理（エラーが発生しても続行）
              try {
                const {
                  createOrUpdateUser,
                  saveMessage,
                  getConversationHistory,
                  checkAndUpdateMessageLimit,
                  getUserModelStatus,
                } = require("../services/database");

                // ユーザーを作成/更新
                await createOrUpdateUser(userId);

                // 特定コマンドの処理
                const trimmedMessage = userMessage.trim();

                // "プレミアム"コマンド: モデルアップグレード情報と決済リンク
                if (trimmedMessage === "プレミアム") {
                  try {
                    const {
                      createCheckoutSession,
                    } = require("../services/stripe");

                    // ユーザーのモデル状態を確認
                    userStatus = await getUserModelStatus(userId);

                    if (userStatus.hasPremium) {
                      await client.replyMessage({
                        replyToken: lineEvent.replyToken,
                        messages: [
                          {
                            type: "text",
                            text: "すでにプレミアムモデルをご利用いただいています！より高度なAIモデルで会話をお楽しみください。",
                          },
                        ],
                      });
                      continue;
                    }

                    // 決済セッションを作成
                    const session = await createCheckoutSession(
                      userId,
                      "model_upgrade"
                    );

                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: `🌟 プレミアムモデルアップグレード 🌟\n\nより高度なAIモデル（Gemini Pro）で、さらに質の高い会話をお楽しみいただけます。\n\n✨ プレミアムモデルの特徴：\n・より深い推論能力\n・より正確な回答\n・複雑な質問への対応\n\n💰 料金：月額1,000円\n※毎月自動更新されます\n※いつでも解約可能\n\n以下のリンクから決済を完了してください：\n${session.url}`,
                        },
                      ],
                    });
                    continue;
                  } catch (error) {
                    logger.error("Failed to create premium checkout session:", {
                      error: error.message,
                    });
                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: "決済リンクの生成に失敗しました。しばらく時間をおいてから再度お試しください。",
                        },
                      ],
                    });
                    continue;
                  }
                }

                // "料金"コマンド: 両方の決済オプションを表示
                if (trimmedMessage === "料金") {
                  try {
                    userStatus = await getUserModelStatus(userId);
                    const remainingQuota = 300 - userStatus.quota;

                    const quotaStatus = userStatus.hasPremium
                      ? ""
                      : "\n（現在未購入）";
                    const premiumStatus = userStatus.hasPremium
                      ? `\n（✓ ご利用中 - ${userStatus.subscriptionStatus}）`
                      : "\n（現在未購入）";

                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: `💰 料金プラン 💰\n\n【メッセージ枠追加】${quotaStatus}\n・500円（買い切り）\n・300件のメッセージ追加\n・3日間の枠に追加されます\n・枠がなくなった際に購入可能\n\n【プレミアムモデル】${premiumStatus}\n・月額1,000円（サブスクリプション）\n・より高度なAIモデル\n・毎月自動更新\n・いつでも解約可能\n・「プレミアム」と送信して購入\n\n現在の残り枠: ${remainingQuota}件`,
                        },
                      ],
                    });
                    continue;
                  } catch (error) {
                    logger.error("Failed to show pricing:", {
                      error: error.message,
                    });
                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: "料金情報の取得に失敗しました。しばらく時間をおいてから再度お試しください。",
                        },
                      ],
                    });
                    continue;
                  }
                }

                // "枠"コマンド: 現在の枠情報を表示
                if (trimmedMessage === "枠") {
                  try {
                    userStatus = await getUserModelStatus(userId);
                    const remainingQuota = 300 - userStatus.quota;

                    const resetDate = new Date(userStatus.resetAt);
                    const now = new Date();
                    const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
                    const timeUntilReset = threeDaysInMs - (now - resetDate);
                    const hoursUntilReset = Math.floor(
                      timeUntilReset / (1000 * 60 * 60)
                    );
                    const minutesUntilReset = Math.floor(
                      (timeUntilReset % (1000 * 60 * 60)) / (1000 * 60)
                    );

                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: `📊 メッセージ枠情報 📊\n\n現在の残り枠: ${remainingQuota}件\nリセットまで: 約${hoursUntilReset}時間${minutesUntilReset}分\n\n枠がなくなった場合は、追加購入が可能です。`,
                        },
                      ],
                    });
                    continue;
                  } catch (error) {
                    logger.error("Failed to show quota info:", {
                      error: error.message,
                    });
                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: "枠情報の取得に失敗しました。しばらく時間をおいてから再度お試しください。",
                        },
                      ],
                    });
                    continue;
                  }
                }

                // メッセージ送信制限をチェック
                const limitCheck = await checkAndUpdateMessageLimit(userId);
                if (!limitCheck.allowed) {
                  // 枠超過時の決済リンク送信
                  try {
                    const {
                      createCheckoutSession,
                    } = require("../services/stripe");

                    // 重複セッション作成の防止（簡易実装：既存のアクティブセッションは考慮しない）
                    const session = await createCheckoutSession(
                      userId,
                      "quota_extension"
                    );

                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: `申し訳ございません。3日間で300通のメッセージ制限に達しました。\n\n追加で300件のメッセージ枠を購入いただけます。\n以下のリンクから決済を完了してください：\n${session.url}`,
                        },
                      ],
                    });
                  } catch (error) {
                    logger.error("Failed to create checkout session:", {
                      error: error.message,
                    });
                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: "申し訳ございません。3日間で300通のメッセージ制限に達しました。決済リンクの生成に失敗しました。しばらく時間をおいてから再度お試しください。",
                        },
                      ],
                    });
                  }
                  continue;
                }

                // ユーザーのモデルサブスクリプション状態を確認
                userStatus = await getUserModelStatus(userId);
                if (userStatus.hasPremium) {
                  modelType = "premium";
                  logger.info("User has premium model access", { userId });
                }

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

              // userMessageと履歴で同じものを送信してしまうのを防ぐため
              // 配列の先頭は削除する
              conversationHistory.pop();

              // Gemini APIから応答を取得（モデルタイプを指定）
              const { getChatResponse } = require("../services/gemini");
              const aiResponse = await getChatResponse(
                userMessage,
                conversationHistory,
                modelType
              );

              logger.info("AI response generated", {
                responseLength: aiResponse.length,
                dbAvailable: dbAvailable,
                modelType: modelType,
              });

              // 残り枠警告メッセージの追加
              let quotaWarning = "";
              const remainingQuota = userStatus ? 300 - userStatus.quota : 300;
              if (userStatus && userStatus.quota < 50) {
                if (userStatus.quota < 10) {
                  // 緊急警告（10件未満）
                  quotaWarning = `\n\n ---⚠️ 残り枠: ${remainingQuota}件\n枠がなくなる前に追加購入をご検討ください。`;
                } else {
                  // 通常警告（50件未満）
                  quotaWarning = `\n\n---📢 残り枠: ${remainingQuota}件`;
                }
              }

              // LINEメッセージの最大文字数は5000文字
              const MAX_LINE_MESSAGE_LENGTH = 5000;
              let finalResponse = aiResponse + quotaWarning;

              if (aiResponse.length > MAX_LINE_MESSAGE_LENGTH) {
                logger.warn("Response too long, truncating", {
                  originalLength: aiResponse.length,
                  maxLength: MAX_LINE_MESSAGE_LENGTH,
                });

                // 文の途中で切れないように、最後の句点・改行で切る
                const truncateLength = MAX_LINE_MESSAGE_LENGTH - 30;
                let truncated = aiResponse.substring(0, truncateLength);

                // 最後の句点または改行を探す
                const lastPeriod = Math.max(
                  truncated.lastIndexOf("。"),
                  truncated.lastIndexOf("\n"),
                  truncated.lastIndexOf("！"),
                  truncated.lastIndexOf("？")
                );

                if (lastPeriod > truncateLength * 0.8) {
                  // 80%以上の位置に句点があれば、そこで切る
                  truncated = truncated.substring(0, lastPeriod + 1);
                }

                finalResponse =
                  truncated + "\n\n ---（文字数制限のため省略されました）";
              }

              // AI応答を保存（DBが利用可能な場合のみ）
              if (dbAvailable) {
                try {
                  const { saveMessage } = require("../services/database");
                  await saveMessage(userId, "assistant", finalResponse);
                } catch (dbError) {
                  logger.error("Failed to save AI response to DB:", dbError);
                }
              }

              const replyMessage = {
                type: "text",
                text: finalResponse,
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
