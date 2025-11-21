const mysql = require("mysql2/promise");
const logger = require("../utils/logger");

let connection = null;

async function getConnection() {
  if (!connection) {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: "utf8mb4",
      ssl: {
        rejectUnauthorized: false, // 自己署名証明書を許可
      },
    });

    logger.info("Database connection established", {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });
  }
  return connection;
}

async function createOrUpdateUser(userId) {
  try {
    const conn = await getConnection();

    const [rows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      await conn.execute(
        "INSERT INTO users (line_user_id, message_count_3days, count_reset_at, created_at, updated_at) VALUES (?, 0, NOW(), NOW(), NOW())",
        [userId]
      );
      logger.info(`New user created: ${userId}`);
    } else {
      await conn.execute(
        "UPDATE users SET updated_at = NOW() WHERE line_user_id = ?",
        [userId]
      );
    }
  } catch (error) {
    logger.error("Database error in createOrUpdateUser:", error);
    throw error;
  }
}

async function checkAndUpdateMessageLimit(userId) {
  try {
    const conn = await getConnection();

    // ユーザー情報を取得
    const [rows] = await conn.execute(
      "SELECT id, message_count_3days, count_reset_at FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      throw new Error("User not found");
    }

    const user = rows[0];
    const now = new Date();
    const resetTime = new Date(user.count_reset_at);
    const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;

    // 3日経過していればカウントをリセット
    if (now - resetTime >= threeDaysInMs) {
      await conn.execute(
        "UPDATE users SET message_count_3days = 1, count_reset_at = NOW() WHERE line_user_id = ?",
        [userId]
      );
      logger.info(`Message count reset for user: ${userId}`);
      return { allowed: true, count: 1 };
    }

    // 100通以上送信している場合は制限
    if (user.message_count_3days >= 100) {
      logger.warn(`Message limit reached for user: ${userId}`);
      return { allowed: false, count: user.message_count_3days };
    }

    // カウントを増やす
    await conn.execute(
      "UPDATE users SET message_count_3days = message_count_3days + 1 WHERE line_user_id = ?",
      [userId]
    );

    logger.info(
      `Message count updated for user: ${userId}, count: ${
        user.message_count_3days + 1
      }`
    );
    return { allowed: true, count: user.message_count_3days + 1 };
  } catch (error) {
    logger.error("Database error in checkAndUpdateMessageLimit:", error);
    throw error;
  }
}

async function saveMessage(userId, role, content) {
  try {
    const conn = await getConnection();

    // ユーザーIDを取得
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error("User not found");
    }

    const userDbId = userRows[0].id;

    await conn.execute(
      "INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, NOW())",
      [userDbId, role, content]
    );

    logger.info(`Message saved for user: ${userId}, role: ${role}`);
  } catch (error) {
    logger.error("Database error in saveMessage:", error);
    throw error;
  }
}

async function getConversationHistory(userId, limit = 10) {
  try {
    const conn = await getConnection();

    // limitを整数に変換
    const limitInt = parseInt(limit, 10);

    const [rows] = await conn.execute(
      `SELECT m.role, m.content, m.created_at
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE u.line_user_id = ?
       ORDER BY m.created_at DESC
       LIMIT ${limitInt}`,
      [userId]
    );

    logger.info(`Retrieved ${rows.length} messages for user: ${userId}`);

    // 時系列順に並び替え
    return rows.reverse();
  } catch (error) {
    logger.error("Database error in getConversationHistory:", error);
    throw error;
  }
}

module.exports = {
  createOrUpdateUser,
  saveMessage,
  getConversationHistory,
  checkAndUpdateMessageLimit,
};
