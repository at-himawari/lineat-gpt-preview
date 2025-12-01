// データベースサービスの枠拡張処理テスト

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

describe("枠拡張時のカウント処理テスト", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // デフォルトの環境変数設定
    process.env.MESSAGE_QUOTA_EXTENSION = "300";
  });

  describe("決済完了後の枠追加", () => {
    test("枠拡張により使用カウントが減少する", async () => {
      const userId = "test_user_quota_001";
      const quotaExtension = 300;

      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 80 }],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.addMessageQuota(userId, quotaExtension);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(380); // 80 + 300

      // 使用カウントを減らすクエリが実行されたことを確認
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining(
          "message_count_3days = message_count_3days - ?"
        ),
        [quotaExtension, userId]
      );
    });

    test("枠が0の状態で拡張を購入できる", async () => {
      const userId = "test_user_quota_002";
      const quotaExtension = 300;

      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 0 }],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.addMessageQuota(userId, quotaExtension);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(300);
    });

    test("上限到達後に枠拡張を購入できる", async () => {
      const userId = "test_user_quota_003";
      const quotaExtension = 300;

      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 100 }],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.addMessageQuota(userId, quotaExtension);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(400);
    });
  });

  describe("複数購入時の累積処理", () => {
    test("1回目の購入後、2回目の購入で累積される", async () => {
      const userId = "test_user_multi_001";
      const quotaExtension = 300;

      // 1回目の購入
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 50 }],
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result1 = await database.addMessageQuota(userId, quotaExtension);
      expect(result1.newQuota).toBe(350);

      jest.clearAllMocks();

      // 2回目の購入（1回目の購入後の状態から）
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: -250 }], // 50 - 300 = -250（負の値 = 残り枠が多い）
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result2 = await database.addMessageQuota(userId, quotaExtension);
      expect(result2.newQuota).toBe(50); // -250 + 300 = 50
    });

    test("3回連続で購入しても正しく累積される", async () => {
      const userId = "test_user_multi_002";
      const quotaExtension = 300;

      // 1回目
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 90 }],
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const result1 = await database.addMessageQuota(userId, quotaExtension);
      expect(result1.newQuota).toBe(390);

      jest.clearAllMocks();

      // 2回目
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: -210 }],
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const result2 = await database.addMessageQuota(userId, quotaExtension);
      expect(result2.newQuota).toBe(90);

      jest.clearAllMocks();

      // 3回目
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: -510 }],
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const result3 = await database.addMessageQuota(userId, quotaExtension);
      expect(result3.newQuota).toBe(-210);
    });
  });

  describe("決済完了処理のアトミック性", () => {
    test("quota_extension決済完了時、トランザクションと枠が同時に更新される", async () => {
      const sessionId = "cs_test_session_001";
      const userId = "test_user_atomic_001";
      const productType = "quota_extension";

      mockConnection.execute.mockResolvedValueOnce([[{ id: 1 }]]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.processPaymentCompletion(
        sessionId,
        userId,
        productType
      );

      expect(result.success).toBe(true);
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.rollback).not.toHaveBeenCalled();
    });

    test("エラー発生時、トランザクションがロールバックされる", async () => {
      const sessionId = "cs_test_session_002";
      const userId = "test_user_atomic_002";
      const productType = "quota_extension";

      mockConnection.execute.mockResolvedValueOnce([[{ id: 1 }]]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      // 枠更新でエラー
      mockConnection.execute.mockRejectedValueOnce(new Error("Database error"));

      await expect(
        database.processPaymentCompletion(sessionId, userId, productType)
      ).rejects.toThrow("Database error");

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    test("ユーザーが見つからない場合、ロールバックされる", async () => {
      const sessionId = "cs_test_session_003";
      const userId = "non_existent_user";
      const productType = "quota_extension";

      mockConnection.execute.mockResolvedValueOnce([[]]);

      await expect(
        database.processPaymentCompletion(sessionId, userId, productType)
      ).rejects.toThrow("User not found");

      expect(mockConnection.rollback).toHaveBeenCalled();
    });
  });

  describe("リセット時刻の不変性", () => {
    test("枠拡張購入後もcount_reset_atは変更されない", async () => {
      const userId = "test_user_reset_invariant_001";
      const now = new Date();
      const originalResetTime = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5時間前

      // 枠拡張前のチェック
      mockConnection.execute.mockResolvedValueOnce([
        [
          {
            id: 1,
            message_count_3days: 95,
            count_reset_at: originalResetTime,
            has_premium_model: true,
            subscription_status: "active",
          },
        ],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const beforeResult = await database.checkAndUpdateMessageLimit(userId);
      expect(beforeResult.count).toBe(96);

      jest.clearAllMocks();

      // 枠拡張を購入
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 96 }],
      ]);
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await database.addMessageQuota(userId, 300);

      // addMessageQuotaではcount_reset_atを更新しないことを確認
      const updateCalls = mockConnection.execute.mock.calls;
      const resetAtUpdated = updateCalls.some((call) =>
        call[0].includes("count_reset_at")
      );
      expect(resetAtUpdated).toBe(false);
    });
  });

  describe("使用カウントの調整", () => {
    test("50件使用済みで拡張購入後、残り枠が正しく計算される", async () => {
      const userId = "test_user_adjust_001";
      const quotaExtension = 300;

      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 50 }],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.addMessageQuota(userId, quotaExtension);

      // 50使用済み + 300追加 = 350残り（カウントは-250になる）
      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(350);
    });

    test("99件使用済みで拡張購入後、残り枠が正しく計算される", async () => {
      const userId = "test_user_adjust_002";
      const quotaExtension = 300;

      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 1, message_count_3days: 99 }],
      ]);

      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await database.addMessageQuota(userId, quotaExtension);

      expect(result.success).toBe(true);
      expect(result.newQuota).toBe(399);
    });
  });
});
