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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("メッセージ処理の基本フローが動作する", async () => {
    const mockClient = {
      replyMessage: jest.fn().mockResolvedValue({}),
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
      10
    );
    expect(mockGemini.getChatResponse).toHaveBeenCalled();
    expect(mockClient.replyMessage).toHaveBeenCalledWith("test_reply_token", {
      type: "text",
      text: "こんにちは！",
    });
  });

  test("エラー発生時にエラーメッセージを返信する", async () => {
    const mockClient = {
      replyMessage: jest.fn().mockResolvedValue({}),
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
