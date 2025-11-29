const logger = require("../utils/logger");
const stripeService = require("../services/stripe");
const databaseService = require("../services/database");

/**
 * Stripe Webhook Handler
 * Stripe からの webhook イベントを受信し、処理する
 *
 * 要件: 3.1, 3.2, 3.4
 */
async function stripeWebhookHandler(event, context) {
  logger.info("Stripe webhook called", {
    requestId: context.requestId,
    hasBody: !!event.body,
    hasSignature: !!(
      event.headers["stripe-signature"] || event.headers["Stripe-Signature"]
    ),
  });

  try {
    // リクエストボディの取得
    if (!event.body) {
      logger.error("No request body");
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No request body" }),
      };
    }

    // ボディの処理（Base64デコードが必要な場合）
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    // 署名ヘッダーの取得
    const signature =
      event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

    if (!signature) {
      logger.error("No Stripe signature header");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No signature header" }),
      };
    }

    // Webhook シークレットの取得
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error("STRIPE_WEBHOOK_SECRET environment variable is not set");
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Webhook secret not configured" }),
      };
    }

    // 署名検証
    let stripeEvent;
    try {
      stripeEvent = stripeService.verifyWebhookSignature(
        body,
        signature,
        webhookSecret
      );
      logger.info("Webhook signature verified", {
        eventType: stripeEvent.type,
        eventId: stripeEvent.id,
      });
    } catch (error) {
      logger.error("Webhook signature verification failed", {
        error: error.message,
      });
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid signature" }),
      };
    }

    // イベント処理
    try {
      await stripeService.handleWebhookEvent(stripeEvent, databaseService);

      logger.info("Webhook event processed successfully", {
        eventType: stripeEvent.type,
        eventId: stripeEvent.id,
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ received: true }),
      };
    } catch (error) {
      logger.error("Error processing webhook event", {
        error: error.message,
        stack: error.stack,
        eventType: stripeEvent.type,
        eventId: stripeEvent.id,
      });

      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal server error" }),
      };
    }
  } catch (error) {
    logger.error("Stripe webhook error", {
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

module.exports.handler = stripeWebhookHandler;
