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
        "INSERT INTO users (line_user_id, created_at, updated_at) VALUES (?, NOW(), NOW())",
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
};
