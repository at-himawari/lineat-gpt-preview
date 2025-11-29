const Stripe = require("stripe");
const logger = require("../utils/logger");

// Stripe クライアントの初期化
let stripeClient = null;

function getStripeClient() {
  if (!stripeClient) {
    // 環境変数の検証
    if (!process.env.STRIPE_SECRET_KEY) {
      logger.error("STRIPE_SECRET_KEY environment variable is not set");
      throw new Error("Stripe configuration is missing: STRIPE_SECRET_KEY");
    }

    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });

    logger.info("Stripe client initialized");
  }

  return stripeClient;
}

// 環境変数の検証
function validateEnvironmentVariables() {
  const requiredVars = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_QUOTA_PRICE_ID",
    "STRIPE_PREMIUM_PRICE_ID",
    "STRIPE_SUCCESS_URL",
    "STRIPE_CANCEL_URL",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error("Missing required Stripe environment variables", {
      missing: missingVars,
    });
    return false;
  }

  logger.info("All required Stripe environment variables are present");
  return true;
}

// 指数バックオフで再試行
async function retryWithExponentialBackoff(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isRetryableError =
        error.type === "StripeConnectionError" ||
        error.type === "StripeAPIError" ||
        error.statusCode === 429;

      if (isLastAttempt || !isRetryableError) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      logger.warn(
        `Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        {
          error: error.message,
        }
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Checkout セッションを作成
async function createCheckoutSession(userId, productType, metadata = {}) {
  try {
    const stripe = getStripeClient();

    // 商品タイプの検証
    if (!["quota_extension", "model_upgrade"].includes(productType)) {
      throw new Error(`Invalid product type: ${productType}`);
    }

    // 商品タイプに基づく価格IDの選択
    const priceId =
      productType === "quota_extension"
        ? process.env.STRIPE_QUOTA_PRICE_ID
        : process.env.STRIPE_PREMIUM_PRICE_ID;

    if (!priceId) {
      throw new Error(
        `Price ID not configured for product type: ${productType}`
      );
    }

    // セッションメタデータの構築
    const sessionMetadata = {
      userId,
      productType,
      ...metadata,
    };

    // 商品タイプに応じてモードを選択
    // quota_extension: 1回限りの支払い
    // model_upgrade: サブスクリプション（毎月課金）
    const mode = productType === "quota_extension" ? "payment" : "subscription";

    // 再試行ロジック付きでCheckout セッションを作成
    const session = await retryWithExponentialBackoff(async () => {
      return await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: mode,
        success_url: process.env.STRIPE_SUCCESS_URL,
        cancel_url: process.env.STRIPE_CANCEL_URL,
        metadata: sessionMetadata,
        client_reference_id: userId,
      });
    });

    logger.info("Checkout session created", {
      sessionId: session.id,
      userId,
      productType,
      mode,
    });

    return session;
  } catch (error) {
    logger.error("Error creating checkout session", {
      error: error.message,
      errorType: error.type,
      statusCode: error.statusCode,
      userId,
      productType,
    });

    // ユーザーフレンドリーなエラーメッセージを返す
    if (error.type === "StripeAuthenticationError") {
      throw new Error(
        "決済システムの認証エラーが発生しました。管理者にお問い合わせください。"
      );
    } else if (error.statusCode === 429) {
      throw new Error(
        "現在、決済システムが混雑しています。しばらく時間をおいてから再度お試しください。"
      );
    } else {
      throw new Error(
        "決済処理中にエラーが発生しました。しばらく時間をおいてから再度お試しください。"
      );
    }
  }
}

// Webhook 署名を検証
function verifyWebhookSignature(payload, signature, secret) {
  try {
    const stripe = getStripeClient();

    if (!secret) {
      throw new Error("Webhook secret is not configured");
    }

    // Stripe の署名検証を使用
    const event = stripe.webhooks.constructEvent(payload, signature, secret);

    logger.info("Webhook signature verified successfully", {
      eventType: event.type,
      eventId: event.id,
    });

    return event;
  } catch (error) {
    logger.error("Webhook signature verification failed", {
      error: error.message,
    });
    throw error;
  }
}

// Webhook イベントを処理
async function handleWebhookEvent(event, databaseService) {
  try {
    logger.info("Processing webhook event", {
      eventType: event.type,
      eventId: event.id,
    });

    // イベントタイプに基づく処理分岐
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(
          event.data.object,
          databaseService
        );
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object, databaseService);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object, databaseService);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object, databaseService);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object, databaseService);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object, databaseService);
        break;

      default:
        logger.info("Unhandled event type", { eventType: event.type });
        break;
    }

    return { success: true };
  } catch (error) {
    logger.error("Error handling webhook event", {
      error: error.message,
      eventType: event.type,
      eventId: event.id,
    });
    throw error;
  }
}

// checkout.session.completed イベントを処理
async function handleCheckoutSessionCompleted(session, databaseService) {
  try {
    // メタデータからユーザーIDと商品タイプを抽出
    const userId = session.metadata?.userId || session.client_reference_id;
    const productType = session.metadata?.productType;

    if (!userId) {
      throw new Error("User ID not found in session metadata");
    }

    if (!productType) {
      throw new Error("Product type not found in session metadata");
    }

    // 商品タイプの検証
    if (!["quota_extension", "model_upgrade"].includes(productType)) {
      throw new Error(`Unknown product type: ${productType}`);
    }

    logger.info("Processing checkout session completed", {
      sessionId: session.id,
      userId,
      productType,
      customerId: session.customer,
      subscriptionId: session.subscription,
    });

    // アトミックに決済完了処理を実行
    // サブスクリプションの場合はcustomer_idとsubscription_idも保存
    await databaseService.processPaymentCompletion(
      session.id,
      userId,
      productType,
      session.customer,
      session.subscription
    );

    logger.info("Checkout session processing completed", {
      sessionId: session.id,
      userId,
      productType,
    });
  } catch (error) {
    logger.error("Error processing checkout session completed", {
      error: error.message,
      sessionId: session.id,
    });
    throw error;
  }
}

// customer.subscription.created イベントを処理
async function handleSubscriptionCreated(subscription, databaseService) {
  try {
    const customerId = subscription.customer;
    const subscriptionId = subscription.id;
    const status = subscription.status;
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    logger.info("Processing subscription created", {
      subscriptionId,
      customerId,
      status,
      currentPeriodEnd,
    });

    // サブスクリプション情報を更新
    await databaseService.updateSubscriptionStatus(
      customerId,
      subscriptionId,
      status,
      currentPeriodEnd
    );

    logger.info("Subscription created processing completed", {
      subscriptionId,
      customerId,
    });
  } catch (error) {
    logger.error("Error processing subscription created", {
      error: error.message,
      subscriptionId: subscription.id,
    });
    throw error;
  }
}

// customer.subscription.updated イベントを処理
async function handleSubscriptionUpdated(subscription, databaseService) {
  try {
    const customerId = subscription.customer;
    const subscriptionId = subscription.id;
    const status = subscription.status;
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    logger.info("Processing subscription updated", {
      subscriptionId,
      customerId,
      status,
      currentPeriodEnd,
    });

    // サブスクリプション情報を更新
    await databaseService.updateSubscriptionStatus(
      customerId,
      subscriptionId,
      status,
      currentPeriodEnd
    );

    logger.info("Subscription updated processing completed", {
      subscriptionId,
      customerId,
    });
  } catch (error) {
    logger.error("Error processing subscription updated", {
      error: error.message,
      subscriptionId: subscription.id,
    });
    throw error;
  }
}

// customer.subscription.deleted イベントを処理
async function handleSubscriptionDeleted(subscription, databaseService) {
  try {
    const customerId = subscription.customer;
    const subscriptionId = subscription.id;

    logger.info("Processing subscription deleted", {
      subscriptionId,
      customerId,
    });

    // サブスクリプションを無効化
    await databaseService.deactivateSubscription(customerId, subscriptionId);

    logger.info("Subscription deleted processing completed", {
      subscriptionId,
      customerId,
    });
  } catch (error) {
    logger.error("Error processing subscription deleted", {
      error: error.message,
      subscriptionId: subscription.id,
    });
    throw error;
  }
}

// invoice.payment_succeeded イベントを処理
async function handleInvoicePaymentSucceeded(invoice, databaseService) {
  try {
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    logger.info("Processing invoice payment succeeded", {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });

    // サブスクリプションがアクティブであることを確認
    if (subscriptionId) {
      await databaseService.updateSubscriptionStatus(
        customerId,
        subscriptionId,
        "active",
        null
      );
    }

    logger.info("Invoice payment succeeded processing completed", {
      invoiceId: invoice.id,
      customerId,
    });
  } catch (error) {
    logger.error("Error processing invoice payment succeeded", {
      error: error.message,
      invoiceId: invoice.id,
    });
    throw error;
  }
}

// invoice.payment_failed イベントを処理
async function handleInvoicePaymentFailed(invoice, databaseService) {
  try {
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    logger.info("Processing invoice payment failed", {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });

    // サブスクリプションステータスを past_due に更新
    if (subscriptionId) {
      await databaseService.updateSubscriptionStatus(
        customerId,
        subscriptionId,
        "past_due",
        null
      );
    }

    logger.info("Invoice payment failed processing completed", {
      invoiceId: invoice.id,
      customerId,
    });
  } catch (error) {
    logger.error("Error processing invoice payment failed", {
      error: error.message,
      invoiceId: invoice.id,
    });
    throw error;
  }
}

module.exports = {
  getStripeClient,
  validateEnvironmentVariables,
  createCheckoutSession,
  verifyWebhookSignature,
  handleWebhookEvent,
};
