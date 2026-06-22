// LINE Webhook Handlerの基本テスト

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockDatabase = {
  createOrUpdateUser: jest.fn(),
  saveMessage: jest.fn(),
  getConversationHistory: jest.fn(),
  checkAndUpdateMessageLimit: jest.fn(),
  getUserModelStatus: jest.fn(),
};

const mockGemini = {
  getChatResponse: jest.fn(),
};

jest.mock("../../services/database", () => mockDatabase);
jest.mock("../../services/gemini", () => mockGemini);

// LINE SDKのモック
const mockReplyMessage = jest.fn();
const mockPushMessage = jest.fn();
const mockMessagingApiClient = jest.fn().mockImplementation(() => ({
  replyMessage: mockReplyMessage,
  pushMessage: mockPushMessage,
}));

jest.mock("@line/bot-sdk", () => ({
  messagingApi: {
    MessagingApiClient: mockMessagingApiClient,
  },
}));

const { handler } = require("../../handlers/webhook");

describe("LINE Webhook Handler - 基本テスト", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test_token";
    process.env.LINE_CHANNEL_SECRET = "test_secret";
    process.env.SKIP_SIGNATURE_VALIDATION = "true"; // テスト用に署名検証をスキップ
    process.env.MESSAGE_LIMIT_1DAY = "30";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: jest.fn().mockResolvedValue(""),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockContext = {
    requestId: "test-request-id",
  };

  describe("環境変数チェック", () => {
    test("LINE認証情報が欠けている場合、500エラーを返す", async () => {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: "Missing LINE credentials",
      });
    });
  });

  describe("リクエスト検証", () => {
    test("リクエストボディがない場合、400エラーを返す", async () => {
      const mockEvent = {
        body: null,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ error: "No request body" });
    });

    test("空のイベント配列の場合、200を返す", async () => {
      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe("Base64エンコーディング", () => {
    test("Base64エンコードされたボディを正しくデコードする", async () => {
      const bodyString = JSON.stringify({ events: [] });
      const mockEvent = {
        body: Buffer.from(bodyString).toString("base64"),
        isBase64Encoded: true,
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
    });
  });

  describe("レスポンス形式", () => {
    test("成功時のレスポンスに正しいヘッダーが含まれる", async () => {
      const mockEvent = {
        body: JSON.stringify({ events: [] }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.headers).toEqual({ "Content-Type": "application/json" });
    });
  });

  describe("テキストメッセージ処理", () => {
    test("通常メッセージではローディング表示を出して本回答を reply する", async () => {
      mockDatabase.createOrUpdateUser.mockResolvedValue({});
      mockDatabase.checkAndUpdateMessageLimit.mockResolvedValue({
        allowed: true,
        count: 21,
        isPremium: true,
        limit: 30,
      });
      mockDatabase.saveMessage.mockResolvedValue({});
      mockDatabase.getConversationHistory.mockResolvedValue([
        { role: "user", content: "過去の会話" },
        { role: "assistant", content: "前回の応答" },
        { role: "user", content: "こんにちは" },
      ]);
      mockGemini.getChatResponse.mockResolvedValue("応答本文");

      const mockEvent = {
        body: JSON.stringify({
          events: [
            {
              type: "message",
              replyToken: "fast-reply-token",
              source: { type: "user", userId: "user-123" },
              message: { type: "text", text: "こんにちは" },
            },
          ],
        }),
        headers: {},
      };

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockDatabase.getUserModelStatus).not.toHaveBeenCalled();
      expect(mockGemini.getChatResponse).toHaveBeenCalledWith(
        "こんにちは",
        [
          { role: "user", content: "過去の会話" },
          { role: "assistant", content: "前回の応答" },
        ],
        "premium"
      );
      expect(mockReplyMessage).toHaveBeenCalledWith({
        replyToken: "fast-reply-token",
        messages: [
          {
            type: "text",
            text: "応答本文\n\n --- \n⚠️ 残り枠: 9件",
          },
        ],
      });
      expect(mockDatabase.getConversationHistory).toHaveBeenCalledWith(
        "user-123",
        4
      );
      expect(mockPushMessage).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.line.me/v2/bot/chat/loading/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_token",
          },
          body: JSON.stringify({
            chatId: "user-123",
            loadingSeconds: 30,
          }),
        }
      );
    });

    test("AI応答が遅い場合は中間返信を送らずローディング表示を出す", async () => {
      jest.useFakeTimers();

      mockDatabase.createOrUpdateUser.mockResolvedValue({});
      mockDatabase.checkAndUpdateMessageLimit.mockResolvedValue({
        allowed: true,
        count: 1,
        isPremium: false,
        limit: 30,
      });
      mockDatabase.saveMessage.mockResolvedValue({});
      mockDatabase.getConversationHistory.mockResolvedValue([
        { role: "user", content: "こんにちは" },
      ]);
      mockGemini.getChatResponse.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve("遅い応答本文"), 2600);
          })
      );

      const mockEvent = {
        body: JSON.stringify({
          events: [
            {
              type: "message",
              replyToken: "reply-token",
              source: { type: "user", userId: "user-123" },
              message: { type: "text", text: "こんにちは" },
            },
          ],
        }),
        headers: {},
      };

      const resultPromise = handler(mockEvent, mockContext);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.line.me/v2/bot/chat/loading/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test_token",
          },
          body: JSON.stringify({
            chatId: "user-123",
            loadingSeconds: 30,
          }),
        }
      );
      expect(mockReplyMessage).toHaveBeenCalledTimes(1);
      expect(mockReplyMessage).toHaveBeenCalledWith({
        replyToken: "reply-token",
        messages: [{ type: "text", text: "遅い応答本文" }],
      });
      expect(mockPushMessage).not.toHaveBeenCalled();
    });

  });
});
