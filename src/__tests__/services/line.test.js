// LINE サービスの基本テスト

const mockGemini = {
  getChatResponse: jest.fn(),
};

const mockDatabase = {
  createOrUpdateUser: jest.fn(),
  saveMessage: jest.fn(),
  getConversationHistory: jest.fn(),
};

jest.mock("../../services/gemini", () => mockGemini);
jest.mock("../../services/database", () => mockDatabase);
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { handleMessage } = require("../../services/line");

describe("LINE Service - 基本テスト", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test_token";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: jest.fn().mockResolvedValue(""),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("通常応答ではローディング表示を出して本回答を reply する", async () => {
    const mockClient = {
      replyMessage: jest.fn().mockResolvedValue({}),
      pushMessage: jest.fn().mockResolvedValue({}),
    };

    const mockEvent = {
      source: { userId: "test_user_001" },
      message: { text: "こんにちは" },
      replyToken: "test_reply_token",
    };

    mockDatabase.createOrUpdateUser.mockResolvedValue({});
    mockDatabase.saveMessage.mockResolvedValue({});
    mockDatabase.getConversationHistory.mockResolvedValue([]);
    mockGemini.getChatResponse.mockResolvedValue("こんにちは！");

    await handleMessage(mockClient, mockEvent);

    expect(mockDatabase.createOrUpdateUser).toHaveBeenCalledWith(
      "test_user_001"
    );
    expect(mockDatabase.saveMessage).toHaveBeenCalledWith(
      "test_user_001",
      "user",
      "こんにちは"
    );
    expect(mockDatabase.getConversationHistory).toHaveBeenCalledWith(
      "test_user_001",
      4
    );
    expect(mockGemini.getChatResponse).toHaveBeenCalledWith("こんにちは", []);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_token",
        },
        body: JSON.stringify({
          chatId: "test_user_001",
          loadingSeconds: 30,
        }),
      }
    );
    expect(mockClient.replyMessage).toHaveBeenCalledWith("test_reply_token", {
      type: "text",
      text: "こんにちは！",
    });
    expect(mockClient.pushMessage).not.toHaveBeenCalled();
  });

  test("遅い応答ではローディング表示を出して本回答を reply する", async () => {
    jest.useFakeTimers();

    const mockClient = {
      replyMessage: jest.fn().mockResolvedValue({}),
      pushMessage: jest.fn().mockResolvedValue({}),
    };

    const mockEvent = {
      source: { userId: "test_user_001" },
      message: { text: "こんにちは" },
      replyToken: "test_reply_token",
    };

    mockDatabase.createOrUpdateUser.mockResolvedValue({});
    mockDatabase.saveMessage.mockResolvedValue({});
    mockDatabase.getConversationHistory.mockResolvedValue([]);
    mockGemini.getChatResponse.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve("こんにちは！"), 2600);
        })
    );

    const handlePromise = handleMessage(mockClient, mockEvent);
    await jest.advanceTimersByTimeAsync(2600);
    await handlePromise;

    const replyOrder = mockClient.replyMessage.mock.invocationCallOrder[0];
    const loadingOrder = global.fetch.mock.invocationCallOrder[0];
    expect(loadingOrder).toBeLessThan(replyOrder);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_token",
        },
        body: JSON.stringify({
          chatId: "test_user_001",
          loadingSeconds: 30,
        }),
      }
    );
    expect(mockClient.replyMessage).toHaveBeenCalledWith("test_reply_token", {
      type: "text",
      text: "こんにちは！",
    });
    expect(mockClient.pushMessage).not.toHaveBeenCalled();
  });

  test("エラー発生時にエラーメッセージを返信する", async () => {
    const mockClient = {
      replyMessage: jest.fn().mockResolvedValue({}),
      pushMessage: jest.fn().mockResolvedValue({}),
    };

    const mockEvent = {
      source: { userId: "test_user_002" },
      message: { text: "テスト" },
      replyToken: "test_reply_token",
    };

    mockDatabase.createOrUpdateUser.mockRejectedValue(new Error("DB Error"));

    await handleMessage(mockClient, mockEvent);

    expect(mockClient.replyMessage).toHaveBeenCalledWith("test_reply_token", {
      type: "text",
      text: expect.stringContaining("エラーが発生しました"),
    });
  });
});
