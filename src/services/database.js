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

    // メッセージ制限をチェック
    const messageLimit = parseInt(process.env.MESSAGE_LIMIT_3DAYS || "300", 10);
    if (user.message_count_3days >= messageLimit) {
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

/**
 * ユーザーのメッセージ枠を追加する（決済完了後）
 * @param {string} userId - LINE ユーザーID
 * @param {number} amount - 追加する枠数
 * @returns {Promise<{success: boolean, newQuota: number}>}
 */
async function addMessageQuota(userId, amount) {
  const conn = await getConnection();

  try {
    // トランザクション開始
    await conn.beginTransaction();

    // ユーザー情報を取得
    const [rows] = await conn.execute(
      "SELECT id, message_count_3days FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      throw new Error("User not found");
    }

    const user = rows[0];
    const newQuota = user.message_count_3days + amount;

    // 枠を追加
    await conn.execute(
      "UPDATE users SET message_count_3days = message_count_3days + ? WHERE line_user_id = ?",
      [amount, userId]
    );

    // トランザクションをコミット
    await conn.commit();

    logger.info(
      `Message quota added for user: ${userId}, amount: ${amount}, new quota: ${newQuota}`
    );
    return { success: true, newQuota };
  } catch (error) {
    // エラー時はロールバック
    await conn.rollback();
    logger.error("Database error in addMessageQuota:", error);
    throw error;
  }
}

/**
 * ユーザーのプレミアムモデルアクセスを有効化する
 * @param {string} userId - LINE ユーザーID
 * @returns {Promise<{success: boolean}>}
 */
async function activatePremiumModel(userId) {
  try {
    const conn = await getConnection();

    // ユーザー情報を取得
    const [rows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      throw new Error("User not found");
    }

    // プレミアムモデルアクセスを有効化
    await conn.execute(
      "UPDATE users SET has_premium_model = TRUE, premium_activated_at = NOW() WHERE line_user_id = ?",
      [userId]
    );

    logger.info(`Premium model activated for user: ${userId}`);
    return { success: true };
  } catch (error) {
    logger.error("Database error in activatePremiumModel:", error);
    throw error;
  }
}

/**
 * ユーザーのモデルサブスクリプション状態を取得する
 * @param {string} userId - LINE ユーザーID
 * @returns {Promise<{hasPremium: boolean, activatedAt: Date|null, quota: number, resetAt: Date, subscriptionStatus: string|null, customerId: string|null}>}
 */
async function getUserModelStatus(userId) {
  try {
    const conn = await getConnection();

    const [rows] = await conn.execute(
      "SELECT has_premium_model, premium_activated_at, message_count_3days, count_reset_at, subscription_status, subscription_current_period_end, stripe_customer_id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      throw new Error("User not found");
    }

    const user = rows[0];

    // サブスクリプションステータスがactiveの場合のみプレミアムアクセスを許可
    const hasPremium =
      (user.has_premium_model === 1 || user.has_premium_model === true) &&
      user.subscription_status === "active";

    return {
      hasPremium: hasPremium,
      activatedAt: user.premium_activated_at,
      quota: user.message_count_3days,
      resetAt: user.count_reset_at,
      subscriptionStatus: user.subscription_status,
      subscriptionPeriodEnd: user.subscription_current_period_end,
      customerId: user.stripe_customer_id,
    };
  } catch (error) {
    logger.error("Database error in getUserModelStatus:", error);
    throw error;
  }
}

/**
 * トランザクションを保存する
 * @param {string} sessionId - Stripe セッション ID
 * @param {string} userId - LINE ユーザーID
 * @param {string} productType - 商品タイプ ('quota_extension' または 'model_upgrade')
 * @param {number} amount - 金額
 * @param {string} status - ステータス ('pending', 'completed', 'failed', 'cancelled')
 * @returns {Promise<{success: boolean, transactionId: number}>}
 */
async function saveTransaction(
  sessionId,
  userId,
  productType,
  amount,
  status = "pending"
) {
  try {
    const conn = await getConnection();

    // ユーザーのDB IDを取得
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error("User not found");
    }

    const userDbId = userRows[0].id;

    // トランザクションを保存
    const [result] = await conn.execute(
      "INSERT INTO transactions (stripe_session_id, user_id, product_type, amount, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
      [sessionId, userDbId, productType, amount, status]
    );

    logger.info(
      `Transaction saved: sessionId=${sessionId}, userId=${userId}, productType=${productType}, amount=${amount}, status=${status}`
    );
    return { success: true, transactionId: result.insertId };
  } catch (error) {
    logger.error("Database error in saveTransaction:", error);
    throw error;
  }
}

/**
 * トランザクションを更新する
 * @param {string} sessionId - Stripe セッション ID
 * @param {string} status - 新しいステータス
 * @param {Date} completedAt - 完了日時（オプション）
 * @returns {Promise<{success: boolean}>}
 */
async function updateTransaction(sessionId, status, completedAt = null) {
  try {
    const conn = await getConnection();

    if (completedAt) {
      await conn.execute(
        "UPDATE transactions SET status = ?, completed_at = ? WHERE stripe_session_id = ?",
        [status, completedAt, sessionId]
      );
    } else {
      await conn.execute(
        "UPDATE transactions SET status = ? WHERE stripe_session_id = ?",
        [status, sessionId]
      );
    }

    logger.info(
      `Transaction updated: sessionId=${sessionId}, status=${status}`
    );
    return { success: true };
  } catch (error) {
    logger.error("Database error in updateTransaction:", error);
    throw error;
  }
}

/**
 * ユーザーのトランザクション履歴を取得する
 * @param {string} userId - LINE ユーザーID
 * @returns {Promise<Array>} トランザクション履歴（降順）
 */
async function getTransactionHistory(userId) {
  try {
    const conn = await getConnection();

    // ユーザーのDB IDを取得
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error("User not found");
    }

    const userDbId = userRows[0].id;

    // トランザクション履歴を取得（作成日時の降順）
    const [rows] = await conn.execute(
      "SELECT stripe_session_id, product_type, amount, currency, status, created_at, completed_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC",
      [userDbId]
    );

    logger.info(`Retrieved ${rows.length} transactions for user: ${userId}`);
    return rows;
  } catch (error) {
    logger.error("Database error in getTransactionHistory:", error);
    throw error;
  }
}

/**
 * 決済完了処理をアトミックに実行する（トランザクション更新と枠/プレミアム更新）
 * @param {string} sessionId - Stripe セッション ID
 * @param {string} userId - LINE ユーザーID
 * @param {string} productType - 商品タイプ ('quota_extension' または 'model_upgrade')
 * @param {string} customerId - Stripe カスタマー ID（オプション）
 * @param {string} subscriptionId - Stripe サブスクリプション ID（オプション）
 * @returns {Promise<{success: boolean}>}
 */
async function processPaymentCompletion(
  sessionId,
  userId,
  productType,
  customerId = null,
  subscriptionId = null
) {
  const conn = await getConnection();

  try {
    // トランザクション開始
    await conn.beginTransaction();

    // ユーザーのDB IDを取得
    const [userRows] = await conn.execute(
      "SELECT id FROM users WHERE line_user_id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      await conn.rollback();
      throw new Error("User not found");
    }

    const userDbId = userRows[0].id;

    // トランザクションレコードを更新
    if (customerId && subscriptionId) {
      await conn.execute(
        "UPDATE transactions SET status = 'completed', completed_at = NOW(), stripe_customer_id = ?, stripe_subscription_id = ? WHERE stripe_session_id = ?",
        [customerId, subscriptionId, sessionId]
      );
    } else {
      await conn.execute(
        "UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE stripe_session_id = ?",
        [sessionId]
      );
    }

    // 商品タイプに応じて処理を分岐
    if (productType === "quota_extension") {
      // 枠を追加
      const quotaExtension = parseInt(
        process.env.MESSAGE_QUOTA_EXTENSION || "300",
        10
      );
      await conn.execute(
        "UPDATE users SET message_count_3days = message_count_3days + ? WHERE line_user_id = ?",
        [quotaExtension, userId]
      );
      logger.info(`Quota extended for user: ${userId}`);
    } else if (productType === "model_upgrade") {
      // サブスクリプション情報を保存（ステータスは後続のwebhookで更新される）
      if (customerId && subscriptionId) {
        await conn.execute(
          "UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, premium_activated_at = NOW() WHERE line_user_id = ?",
          [customerId, subscriptionId, userId]
        );
        logger.info(
          `Subscription info saved for user: ${userId}, will be activated by subscription webhook`
        );
      } else {
        logger.warn(
          `Missing customerId or subscriptionId for model_upgrade: userId=${userId}`
        );
        await conn.execute(
          "UPDATE users SET premium_activated_at = NOW() WHERE line_user_id = ?",
          [userId]
        );
      }
    } else {
      await conn.rollback();
      throw new Error(`Unknown product type: ${productType}`);
    }

    // トランザクションをコミット
    await conn.commit();

    logger.info(
      `Payment completion processed atomically: sessionId=${sessionId}, userId=${userId}, productType=${productType}`
    );
    return { success: true };
  } catch (error) {
    // エラー時はロールバック
    await conn.rollback();
    logger.error("Database error in processPaymentCompletion:", error);
    throw error;
  }
}

/**
 * サブスクリプションステータスを更新する
 * @param {string} customerId - Stripe カスタマー ID
 * @param {string} subscriptionId - Stripe サブスクリプション ID
 * @param {string} status - サブスクリプションステータス
 * @param {Date} currentPeriodEnd - 現在の期間終了日（オプション）
 * @returns {Promise<{success: boolean}>}
 */
async function updateSubscriptionStatus(
  customerId,
  subscriptionId,
  status,
  currentPeriodEnd = null
) {
  try {
    const conn = await getConnection();

    logger.info("updateSubscriptionStatus called", {
      customerId,
      subscriptionId,
      status,
      currentPeriodEnd,
    });

    // ユーザー情報を取得（customer_idまたはsubscription_idで検索）
    const [rows] = await conn.execute(
      "SELECT id, line_user_id, stripe_customer_id, stripe_subscription_id FROM users WHERE stripe_customer_id = ? OR stripe_subscription_id = ?",
      [customerId, subscriptionId]
    );

    logger.info("User search result", {
      foundUsers: rows.length,
      users: rows,
    });

    if (rows.length === 0) {
      logger.warn(
        `User not found for customer ID: ${customerId}, subscription ID: ${subscriptionId}`
      );
      return { success: false, reason: "user_not_found" };
    }

    const userId = rows[0].id;
    const hasPremiumValue = status === "active" ? 1 : 0;

    // サブスクリプションステータスを更新
    if (currentPeriodEnd) {
      const [updateResult] = await conn.execute(
        "UPDATE users SET subscription_status = ?, subscription_current_period_end = ?, has_premium_model = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?",
        [
          status,
          currentPeriodEnd,
          hasPremiumValue,
          customerId,
          subscriptionId,
          userId,
        ]
      );
      logger.info("Update with period end executed", {
        affectedRows: updateResult.affectedRows,
        changedRows: updateResult.changedRows,
      });
    } else {
      const [updateResult] = await conn.execute(
        "UPDATE users SET subscription_status = ?, has_premium_model = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?",
        [status, hasPremiumValue, customerId, subscriptionId, userId]
      );
      logger.info("Update without period end executed", {
        affectedRows: updateResult.affectedRows,
        changedRows: updateResult.changedRows,
      });
    }

    // 更新後のユーザー情報を確認
    const [verifyRows] = await conn.execute(
      "SELECT line_user_id, has_premium_model, subscription_status, stripe_customer_id, stripe_subscription_id FROM users WHERE id = ?",
      [userId]
    );

    logger.info(
      `Subscription status updated: customerId=${customerId}, subscriptionId=${subscriptionId}, status=${status}`,
      {
        updatedUser: verifyRows[0],
      }
    );
    return { success: true, updatedUser: verifyRows[0] };
  } catch (error) {
    logger.error("Database error in updateSubscriptionStatus:", error);
    throw error;
  }
}

/**
 * サブスクリプションを無効化する
 * @param {string} customerId - Stripe カスタマー ID
 * @param {string} subscriptionId - Stripe サブスクリプション ID
 * @returns {Promise<{success: boolean}>}
 */
async function deactivateSubscription(customerId, subscriptionId) {
  try {
    const conn = await getConnection();

    // プレミアムモデルアクセスを無効化（customer_idまたはsubscription_idで検索）
    await conn.execute(
      "UPDATE users SET has_premium_model = FALSE, subscription_status = 'canceled' WHERE stripe_customer_id = ? OR stripe_subscription_id = ?",
      [customerId, subscriptionId]
    );

    logger.info(
      `Subscription deactivated: customerId=${customerId}, subscriptionId=${subscriptionId}`
    );
    return { success: true };
  } catch (error) {
    logger.error("Database error in deactivateSubscription:", error);
    throw error;
  }
}

module.exports = {
  createOrUpdateUser,
  saveMessage,
  getConversationHistory,
  checkAndUpdateMessageLimit,
  addMessageQuota,
  activatePremiumModel,
  getUserModelStatus,
  saveTransaction,
  updateTransaction,
  getTransactionHistory,
  processPaymentCompletion,
  updateSubscriptionStatus,
  deactivateSubscription,
};
