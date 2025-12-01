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

          // 画像メッセージの処理
          if (messageType === "image") {
            try {
              const userId = lineEvent.source.userId;
              logger.info("Image message received", { userId });

              // データベース関連の処理
              try {
                const {
                  createOrUpdateUser,
                  getUserModelStatus,
                  saveMessage,
                } = require("../services/database");

                // ユーザーを作成/更新
                await createOrUpdateUser(userId);

                // プレミアムステータスの確認
                const userStatus = await getUserModelStatus(userId);

                if (!userStatus.hasPremium) {
                  // 非プレミアムユーザーへの案内メッセージと決済リンク送信
                  logger.info("Non-premium user attempted to send image", {
                    userId,
                  });

                  const {
                    createCheckoutSession,
                  } = require("../services/stripe");

                  // プレミアムプラン決済セッションを作成
                  const session = await createCheckoutSession(
                    userId,
                    "model_upgrade"
                  );

                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: `🖼️ 画像認識機能はプレミアムプラン限定です 🖼️\n\nプレミアムプランにアップグレードすると、画像を送信してAIに内容を説明してもらうことができます。\n\n✨ プレミアムプランの特徴：\n・画像認識機能\n・より高度なAIモデル（Gemini Pro）\n・より深い推論能力\n・より正確な回答\n\n💰\n･画像認識機能🖼️\n  料金：月額1,400円\n※毎月自動更新されます\n※いつでも解約可能\n\n以下のリンクから決済を完了してください：\n${session.url}`,
                      },
                    ],
                  });
                  continue;
                }

                // プレミアムユーザーの場合は画像処理を続行
                logger.info("Premium user sent image, processing...", {
                  userId,
                });

                // メッセージ制限チェック
                const {
                  checkAndUpdateMessageLimit,
                } = require("../services/database");

                const limitCheck = await checkAndUpdateMessageLimit(userId);
                if (!limitCheck.allowed) {
                  // 枠超過時の決済リンク送信
                  logger.info("Message limit exceeded for image", {
                    userId,
                    isPremium: limitCheck.isPremium,
                    limit: limitCheck.limit,
                  });

                  const {
                    createCheckoutSession,
                  } = require("../services/stripe");
                  const quotaExtension = parseInt(
                    process.env.MESSAGE_QUOTA_EXTENSION || "30",
                    10
                  );

                  const session = await createCheckoutSession(
                    userId,
                    "quota_extension"
                  );

                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: `申し訳ございません。1日で${limitCheck.limit}通のメッセージ制限に達しました。\n\n追加で${quotaExtension}件のメッセージ枠を購入いただけます。\n以下のリンクから決済を完了してください：\n${session.url}`,
                      },
                    ],
                  });
                  continue;
                }

                // 画像コンテンツを取得
                const { getImageContent } = require("../services/line");
                let imageContent;
                try {
                  imageContent = await getImageContent(
                    lineEvent.message.id,
                    client
                  );
                } catch (lineApiError) {
                  logger.error("LINE API error while fetching image:", {
                    error: lineApiError.message,
                    userId,
                    stack: lineApiError.stack,
                  });

                  // エラー時はメッセージ枠をロールバック（要件 4.5）
                  const {
                    rollbackMessageLimit,
                  } = require("../services/database");
                  await rollbackMessageLimit(userId);

                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: "画像の取得に失敗しました。しばらく時間をおいてから再度お試しください。",
                      },
                    ],
                  });
                  continue;
                }

                // 画像を検証
                const { validateImage } = require("../utils/imageValidator");
                const validation = validateImage(imageContent);

                if (!validation.valid) {
                  logger.warn("Image validation failed", {
                    userId,
                    error: validation.error,
                    imageSize: imageContent.length,
                  });

                  // エラー時はメッセージ枠をロールバック（要件 4.5）
                  const {
                    rollbackMessageLimit,
                  } = require("../services/database");
                  await rollbackMessageLimit(userId);

                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: validation.error,
                      },
                    ],
                  });
                  continue;
                }

                logger.info("Image validated successfully", {
                  userId,
                  mimeType: validation.mimeType,
                  size: imageContent.length,
                });

                // 会話履歴を取得（画像データを含む）
                const {
                  getConversationHistoryWithImages,
                  saveImageMessage,
                } = require("../services/database");

                const conversationHistory =
                  await getConversationHistoryWithImages(userId, 10);

                logger.info("Conversation history with images retrieved", {
                  userId,
                  historyCount: conversationHistory.length,
                });

                // 直前のメッセージがユーザーからのテキストメッセージかチェック
                // テキスト付き画像の処理（要件 2.1, 2.2, 2.4）
                let userPrompt = null;
                if (conversationHistory.length > 0) {
                  const lastMessage =
                    conversationHistory[conversationHistory.length - 1];
                  // 最後のメッセージがユーザーからのテキストメッセージで、画像データがない場合
                  if (
                    lastMessage.role === "user" &&
                    !lastMessage.image_data &&
                    lastMessage.content !== "[画像]"
                  ) {
                    userPrompt = lastMessage.content;
                    logger.info(
                      "Using recent text message as prompt for image analysis",
                      {
                        userId,
                        promptLength: userPrompt.length,
                      }
                    );
                  }
                }

                // Vision API による画像分析を実行
                const { analyzeImage } = require("../services/gemini");

                let analysis;
                try {
                  analysis = await analyzeImage(
                    imageContent,
                    conversationHistory,
                    "premium",
                    userPrompt,
                    validation.mimeType
                  );

                  logger.info("Image analysis completed", {
                    userId,
                    analysisLength: analysis.length,
                  });
                } catch (visionApiError) {
                  logger.error("Vision API error:", {
                    error: visionApiError.message,
                    userId,
                    stack: visionApiError.stack,
                  });

                  // エラー時はメッセージ枠をロールバック（要件 4.5）
                  const {
                    rollbackMessageLimit,
                  } = require("../services/database");
                  await rollbackMessageLimit(userId);

                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: "画像の分析に失敗しました。しばらく時間をおいてから再度お試しください。",
                      },
                    ],
                  });
                  continue;
                }

                // 画像データと MIME タイプを保存
                await saveImageMessage(
                  userId,
                  imageContent,
                  validation.mimeType
                );

                logger.info("Image data saved to database", {
                  userId,
                  mimeType: validation.mimeType,
                });

                // AI 応答を保存
                await saveMessage(userId, "assistant", analysis);

                logger.info("AI response saved to database", { userId });

                // ユーザーへの返信
                await client.replyMessage({
                  replyToken: lineEvent.replyToken,
                  messages: [
                    {
                      type: "text",
                      text: analysis,
                    },
                  ],
                });

                logger.info("Image analysis response sent to user", { userId });
              } catch (dbError) {
                logger.error("Database error in image processing:", {
                  error: dbError.message,
                  stack: dbError.stack,
                  userId,
                });

                // エラー時はメッセージ枠をロールバック（要件 4.5）
                try {
                  const {
                    rollbackMessageLimit,
                  } = require("../services/database");
                  await rollbackMessageLimit(userId);
                } catch (rollbackError) {
                  logger.error(
                    "Failed to rollback message limit:",
                    rollbackError
                  );
                }

                await client.replyMessage({
                  replyToken: lineEvent.replyToken,
                  messages: [
                    {
                      type: "text",
                      text: "申し訳ございません。エラーが発生しました。しばらく時間をおいてから再度お試しください。",
                    },
                  ],
                });
              }
            } catch (error) {
              logger.error("Failed to process image message:", {
                error: error.message,
                stack: error.stack,
                userId: lineEvent.source?.userId,
              });

              // エラー時はメッセージ枠をロールバック（要件 4.5）
              try {
                const userId = lineEvent.source?.userId;
                if (userId) {
                  const {
                    rollbackMessageLimit,
                  } = require("../services/database");
                  await rollbackMessageLimit(userId);
                }
              } catch (rollbackError) {
                logger.error(
                  "Failed to rollback message limit:",
                  rollbackError
                );
              }

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

                // "ヘルプ"コマンド: 利用可能なコマンド一覧を表示
                if (trimmedMessage === "ヘルプ" || trimmedMessage === "help") {
                  await client.replyMessage({
                    replyToken: lineEvent.replyToken,
                    messages: [
                      {
                        type: "text",
                        text: `📖 利用可能なコマンド 📖\n\n【料金】\n料金プランと現在の利用状況を表示\n\n【枠】\n現在のメッセージ枠情報を表示\n\n【プレミアム】\nプレミアムモデルの購入\n\n【解約】\nサブスクリプションの解約・管理\n\nその他、通常のメッセージを送信するとAIが応答します。`,
                      },
                    ],
                  });
                  continue;
                }

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
                          text: `🌟 プレミアムモデルアップグレード 🌟\n\nより高度なAIモデル（Gemini Pro）で、さらに質の高い会話をお楽しみいただけます。\n\n✨ プレミアムモデルの特徴：\n・より深い推論能力\n・より正確な回答\n・複雑な質問への対応\n\n💰 料金：月額1,400円\n※毎月自動更新されます\n※いつでも解約可能\n\n📋 解約方法：\nStripeの顧客ポータルから、いつでもサブスクリプションを解約できます。解約後も、現在の請求期間の終了まではプレミアムモデルをご利用いただけます。\n\n以下のリンクから決済を完了してください：\n${session.url}`,
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

                // "解約"コマンド: サブスクリプション解約リンクを送信
                if (trimmedMessage === "解約") {
                  try {
                    userStatus = await getUserModelStatus(userId);

                    if (!userStatus.hasPremium) {
                      await client.replyMessage({
                        replyToken: lineEvent.replyToken,
                        messages: [
                          {
                            type: "text",
                            text: "現在、プレミアムサブスクリプションをご利用いただいていません。",
                          },
                        ],
                      });
                      continue;
                    }

                    if (!userStatus.customerId) {
                      await client.replyMessage({
                        replyToken: lineEvent.replyToken,
                        messages: [
                          {
                            type: "text",
                            text: "顧客情報が見つかりませんでした。管理者にお問い合わせください。",
                          },
                        ],
                      });
                      continue;
                    }

                    // 顧客ポータルセッションを作成
                    const {
                      createCustomerPortalSession,
                    } = require("../services/stripe");
                    const portalSession = await createCustomerPortalSession(
                      userStatus.customerId,
                      "https://line.me"
                    );

                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: `🔧 サブスクリプション管理 🔧\n\n以下のリンクから、サブスクリプションの解約や支払い方法の変更ができます。\n\n⚠️ 解約後も、現在の請求期間の終了（${
                            userStatus.subscriptionPeriodEnd
                              ? new Date(
                                  userStatus.subscriptionPeriodEnd
                                ).toLocaleDateString("ja-JP")
                              : "不明"
                          }）まではプレミアムモデルをご利用いただけます。\n\n${
                            portalSession.url
                          }`,
                        },
                      ],
                    });
                    continue;
                  } catch (error) {
                    logger.error("Failed to create customer portal session:", {
                      error: error.message,
                    });
                    await client.replyMessage({
                      replyToken: lineEvent.replyToken,
                      messages: [
                        {
                          type: "text",
                          text: "顧客ポータルの生成に失敗しました。しばらく時間をおいてから再度お試しください。",
                        },
                      ],
                    });
                    continue;
                  }
                }

                // "料金"コマンド: 両方の決済オプションを表示
                if (trimmedMessage === "料金") {
                  try {
                    const messageLimit = parseInt(
                      process.env.MESSAGE_LIMIT_1DAY || "30",
                      10
                    );
                    const quotaExtension = parseInt(
                      process.env.MESSAGE_QUOTA_EXTENSION || "30",
                      10
                    );
                    userStatus = await getUserModelStatus(userId);
                    const remainingQuota = messageLimit - userStatus.quota;

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
                          text: `💰 料金プラン 💰\n\n【メッセージ枠追加】${quotaStatus}\n・300円（買い切り）\n・${quotaExtension}件のメッセージ追加\n・1日の枠に追加されます\n・枠がなくなった際に購入可能\n\n【プレミアムモデル】${premiumStatus}\n・月額1,400円（サブスクリプション）\n・より高度なAIモデル\n・毎月自動更新\n・いつでも解約可能\n・「プレミアム」と送信して購入\n\n現在の残り枠: ${remainingQuota}件`,
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
                    const messageLimit = parseInt(
                      process.env.MESSAGE_LIMIT_1DAY || "30",
                      10
                    );
                    userStatus = await getUserModelStatus(userId);
                    const remainingQuota = messageLimit - userStatus.quota;

                    const resetDate = new Date(userStatus.resetAt);
                    const now = new Date();
                    const oneDayInMs = 24 * 60 * 60 * 1000;
                    const timeUntilReset = oneDayInMs - (now - resetDate);
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
                    const quotaExtension = parseInt(
                      process.env.MESSAGE_QUOTA_EXTENSION || "30",
                      10
                    );

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
                          text: `申し訳ございません。1日で${limitCheck.limit}通のメッセージ制限に達しました。\n\n追加で${quotaExtension}件のメッセージ枠を購入いただけます。\n以下のリンクから決済を完了してください：\n${session.url}`,
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
                          text: `申し訳ございません。1日で${limitCheck.limit}通のメッセージ制限に達しました。決済リンクの生成に失敗しました。しばらく時間をおいてから再度お試しください。`,
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
              const messageLimit = parseInt(
                process.env.MESSAGE_LIMIT_1DAY || "30",
                10
              );
              const remainingQuota = userStatus
                ? messageLimit - userStatus.quota
                : messageLimit;

              if (userStatus && remainingQuota <= 10) {
                // 緊急警告（10件以下）
                quotaWarning = `\n\n --- \n⚠️ 残り枠: ${remainingQuota}件\n枠がなくなる前に追加購入をご検討ください。`;
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
                  truncated + "\n\n --- \n（文字数制限のため省略されました）";
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
