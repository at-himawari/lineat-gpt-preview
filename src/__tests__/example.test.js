// サンプルテスト - テスト環境が正しく動作することを確認

describe("テスト環境の確認", () => {
  test("Jestが正しく動作する", () => {
    expect(1 + 1).toBe(2);
  });

  test("環境変数が設定されている", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.STRIPE_SECRET_KEY).toBeDefined();
    expect(process.env.MESSAGE_LIMIT_1DAY_PREMIUM).toBe("100");
    expect(process.env.MESSAGE_LIMIT_1DAY).toBe("30");
  });
});
