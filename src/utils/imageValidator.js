/**
 * 画像検証ユーティリティ
 * 画像のサイズと形式を検証します
 */

/**
 * バイナリデータから MIME タイプを検出
 * @param {Buffer} buffer - 画像データ
 * @returns {string} MIME タイプ
 */
function detectMimeType(buffer) {
  // マジックナンバーで判定
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return "unknown";
}

/**
 * 画像データを検証
 * @param {Buffer} imageBuffer - 画像データ
 * @returns {{valid: boolean, error?: string, mimeType?: string}}
 */
function validateImage(imageBuffer) {
  // サイズチェック (10MB制限)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (imageBuffer.length > MAX_SIZE) {
    return { valid: false, error: "画像サイズが大きすぎます（最大10MB）" };
  }

  // MIME タイプを検出
  const mimeType = detectMimeType(imageBuffer);
  const supportedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  if (!supportedTypes.includes(mimeType)) {
    return { valid: false, error: "サポートされていない画像形式です" };
  }

  return { valid: true, mimeType };
}

module.exports = {
  validateImage,
  detectMimeType,
};
