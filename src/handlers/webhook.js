const { Client, middleware } = require("@line/bot-sdk");
const { handleMessage } = require("../services/line");
const logger = require("../utils/logger");
const crypto = require("crypto");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

// LINE署名検証
function validateSignature(body, signature, secret) {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function webhookHandler(event, context) {
  try {
    const body = event.body;
    const signature =
      event.headers["x-line-signature"] || event.headers["X-Line-Signature"];

    // LINE署名検証
    if (!validateSignature(body, signature, config.channelSecret)) {
      logger.error("Invalid signature");
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid signature" }),
      };
    }

    const parsedBody = JSON.parse(body);

    // イベント処理
    const promises = parsedBody.events.map(async (lineEvent) => {
      if (lineEvent.type === "message" && lineEvent.message.type === "text") {
        return handleMessage(client, lineEvent);
      }
    });

    await Promise.all(promises);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "OK" }),
    };
  } catch (error) {
    logger.error("Webhook error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

module.exports.handler = webhookHandler;
