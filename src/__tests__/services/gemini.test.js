// Gemini サービスのテスト

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Gemini APIのモック
const mockGenerateContentStream = jest.fn();
const mockModels = {
  generateContentStream: mockGenerateContentStream,
};

jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: mockModels,
  })),
}));

const { getChatResponse } = require("../../services/gemini");

describe("Gemini Service - getChatResponse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.GEMINI_API_KEY = "test_api_key";
    process.env.GEMINI_BASIC_MODEL = "gemini-2.0-flash-exp";
    process.env.GEMINI_PREMIUM_MODEL = "gemini-2.0-flash-thinking-exp-01-21";
    process.env.GEMINI_RESPONSE_CHAR_LIMIT = "800";
    process.env.GEMINI_MAX_TOKENS = "8000";
    process.env.GEMINI_TEMPERATURE = "1";
    process.env.GEMINI_TIMEOUT_MS = "6500";
  });

  test("基本モデルで応答を生成する", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "こんにちは！" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    const result = await getChatResponse("こんにちは", [], "basic");

    expect(result).toBe("こんにちは！");
    expect(mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.0-flash-exp",
        contents: expect.any(Array),
        config: expect.not.objectContaining({
          tools: expect.anything(),
        }),
      })
    );
  });

  test("プレミアムモデルで応答を生成する", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "プレミアム応答" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    const result = await getChatResponse("テスト", [], "premium");

    expect(result).toBe("プレミアム応答");
    expect(mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.0-flash-thinking-exp-01-21",
      })
    );
  });

  test("会話履歴を含めて応答を生成する", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "元気です！" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    const conversationHistory = [
      { role: "user", content: "こんにちは" },
      { role: "assistant", content: "こんにちは！" },
    ];

    const result = await getChatResponse("元気？", conversationHistory);

    expect(result).toBe("元気です！");
    expect(mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            parts: [{ text: "こんにちは" }],
          }),
          expect.objectContaining({
            parts: [{ text: "こんにちは！" }],
          }),
          expect.objectContaining({
            parts: [{ text: "元気？" }],
          }),
        ]),
      })
    );
  });

  test("最新情報が必要そうな文面では検索ツールを有効化する", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "今日の天気です。" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    await getChatResponse("今日の天気を調べて", []);

    expect(mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [{ googleSearch: {} }],
        }),
      })
    );
  });

  test("複数チャンクのストリーミング応答を結合する", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "こんに" };
        yield { text: "ちは！" };
        yield { text: "元気ですか？" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    const result = await getChatResponse("こんにちは");

    expect(result).toBe("こんにちは！元気ですか？");
  });

  test("空の応答の場合エラーをスローする", async () => {
    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        yield { text: "" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    await expect(getChatResponse("テスト")).rejects.toThrow(
      "Gemini APIから応答がありませんでした"
    );
  });

  test("API エラー時にエラーをスローする", async () => {
    mockGenerateContentStream.mockRejectedValue(new Error("API Error"));

    await expect(getChatResponse("テスト")).rejects.toThrow();
  });

  test("タイムアウト時は短文フォールバックを返す", async () => {
    process.env.GEMINI_TIMEOUT_MS = "10";

    const mockResponse = {
      [Symbol.asyncIterator]: async function* () {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { text: "遅い応答" };
      },
    };

    mockGenerateContentStream.mockResolvedValue(mockResponse);

    const result = await getChatResponse("要件を整理して");

    expect(result).toContain("要点を先に返します");
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});
