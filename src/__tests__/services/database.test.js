// データベースサービスのカウントロジックテスト
const fc = require("fast-check");

// モックデータベース接続
const mockConnection = {
  execute: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

// データベースサービスをモック
jest.mock("mysql2/promise", () => ({
  createConnection: jest.fn(() => Promise.resolve(mockConnection)),
}));

// ロガーをモック
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const database = require("../../services/database");

describe("メッセージカウントの基本動作テスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("プレミアムユーザーの初回メッセージでカウント初期化", () => {
    test("初回メッセージ送信時にカウントが1に初期化される", async () => {
      const userId = "test_user_premium_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25時間前

      // ユーザー情報を返す（1日以上経過）
      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 50,
            count_reset_at: resetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      // カウントリセットのUPDATE
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
      expect(result.isPremium).toBe(true);
      expect(result.limit).toBe(100);

      // リセットクエリが実行されたことを確認
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET message_count_3days = 1"),
        [userId]
      );
    });

    test("非プレミアムユーザーの初回メッセージでカウントが1に初期化される", async () => {
      const userId = "test_user_non_premium_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 20,
            count_reset_at: resetTime,
            has_premium_model: false,
            subscription_status: null,
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
      expect(result.isPremium).toBe(false);
      expect(result.limit).toBe(30);
    });
  });

  describe("メッセージ送信ごとのカウント増加", () => {
    test("プレミアムユーザーのメッセージカウントが1増加する", async () => {
      const userId = "test_user_premium_002";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 50,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(51);
      expect(result.isPremium).toBe(true);

      // カウント増加クエリが実行されたことを確認
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining(
          "message_count_3days = message_count_3days + 1"
        ),
        [userId]
      );
    });

    test("非プレミアムユーザーのメッセージカウントが1増加する", async () => {
      const userId = "test_user_non_premium_002";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 15,
            count_reset_at: now,
            has_premium_model: false,
            subscription_status: null,
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(16);
      expect(result.isPremium).toBe(false);
    });
  });

  describe("プレミアムユーザーの100件制限チェック", () => {
    test("99件使用済みの場合、メッセージが許可される", async () => {
      const userId = "test_user_premium_003";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 99,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(100);
      expect(result.limit).toBe(100);
    });

    test("100件到達時、メッセージが拒否される", async () => {
      const userId = "test_user_premium_004";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 100,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(100);
      expect(result.limit).toBe(100);

      // カウント増加クエリが実行されないことを確認
      expect(mockConnection.execute).toHaveBeenCalledTimes(1);
    });

    test("100件超過時、メッセージが拒否される", async () => {
      const userId = "test_user_premium_005";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 150,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(150);
    });
  });

  describe("非プレミアムユーザーの30件制限チェック", () => {
    test("29件使用済みの場合、メッセージが許可される", async () => {
      const userId = "test_user_non_premium_003";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 29,
            count_reset_at: now,
            has_premium_model: false,
            subscription_status: null,
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(30);
      expect(result.limit).toBe(30);
    });

    test("30件到達時、メッセージが拒否される", async () => {
      const userId = "test_user_non_premium_004";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 30,
            count_reset_at: now,
            has_premium_model: false,
            subscription_status: null,
          },
        ],
      ]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(30);
      expect(result.limit).toBe(30);
    });

    test("30件超過時、メッセージが拒否される", async () => {
      const userId = "test_user_non_premium_005";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 35,
            count_reset_at: now,
            has_premium_model: false,
            subscription_status: null,
          },
        ],
      ]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(35);
    });
  });

  describe("エッジケース", () => {
    test("カウントが0の場合、正しく増加する", async () => {
      const userId = "test_user_edge_001";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 0,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
    });

    test("ユーザーが見つからない場合、エラーをスローする", async () => {
      const userId = "non_existent_user";

      mockConnection.execute.mockResolvedValueOnce([[]]);

      await expect(database.checkAndUpdateMessageLimit(userId)).rejects.toThrow(
        "User not found"
      );
    });

    test("サブスクリプションがinactive状態のユーザーは非プレミアム扱い", async () => {
      const userId = "test_user_inactive_sub";
      const now = new Date();

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 25,
            count_reset_at: now,
            has_premium_model: true,
            subscription_status: "inactive",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.isPremium).toBe(false);
      expect(result.limit).toBe(30);
    });
  });
});
