// データベースサービスのカウントリセットロジックテスト

const mockConnection = {
  execute: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock("mysql2/promise", () => ({
  createConnection: jest.fn(() => Promise.resolve(mockConnection)),
}));

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const database = require("../../services/database");

describe("カウントリセットロジックのテスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1日経過後の自動リセット", () => {
    test("ちょうど24時間経過後にリセットされる", async () => {
      const userId = "test_user_reset_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // ちょうど24時間前

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 80,
            count_reset_at: resetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1); // リセットされて1
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("message_count_3days = 1"),
        [userId]
      );
    });

    test("25時間経過後にリセットされる", async () => {
      const userId = "test_user_reset_002";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 95,
            count_reset_at: resetTime,
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

    test("48時間経過後にリセットされる", async () => {
      const userId = "test_user_reset_003";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 100,
            count_reset_at: resetTime,
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

    test("23時間59分経過では リセットされない", async () => {
      const userId = "test_user_no_reset_001";
      const now = new Date();
      const resetTime = new Date(
        now.getTime() - (24 * 60 * 60 * 1000 - 60 * 1000)
      ); // 23時間59分前

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

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(51); // リセットされず、カウント増加
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("message_count_3days + 1"),
        [userId]
      );
    });
  });

  describe("リセット時刻の正確性", () => {
    test("リセット時にcount_reset_atが更新される", async () => {
      const userId = "test_user_reset_time_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 70,
            count_reset_at: resetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await database.checkAndUpdateMessageLimit(userId);

      // count_reset_atがNOW()で更新されることを確認
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("count_reset_at = NOW()"),
        [userId]
      );
    });
  });

  describe("リセット後の初回メッセージ処理", () => {
    test("リセット後の初回メッセージでカウントが1になる", async () => {
      const userId = "test_user_reset_first_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 100, // 前回は上限まで使用
            count_reset_at: resetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
      expect(result.isPremium).toBe(true);
      expect(result.limit).toBe(100);
    });

    test("非プレミアムユーザーもリセット後は正しく動作する", async () => {
      const userId = "test_user_reset_first_002";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 26 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 30, // 前回は上限まで使用
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

  describe("エッジケース", () => {
    test("カウントが0でもリセット時刻が過ぎていればリセットされる", async () => {
      const userId = "test_user_edge_reset_001";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 0,
            count_reset_at: resetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.checkAndUpdateMessageLimit(userId);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining("message_count_3days = 1"),
        [userId]
      );
    });

    test("非常に古いリセット時刻（1週間前）でもリセットされる", async () => {
      const userId = "test_user_edge_reset_002";
      const now = new Date();
      const resetTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1週間前

      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 85,
            count_reset_at: resetTime,
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
  });
});
