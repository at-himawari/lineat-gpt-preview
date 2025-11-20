const logger = require("../utils/logger");

/**
 * DuckDuckGo Instant Answer APIを使用してWeb検索を実行（完全無料）
 * @param {string} query - 検索クエリ
 * @param {number} count - 取得する結果数（デフォルト: 5）
 * @returns {Promise<Array>} 検索結果の配列
 */
async function searchWeb(query, count = 5) {
  try {
    // DuckDuckGo Instant Answer API（完全無料、APIキー不要）
    const endpoint = "https://api.duckduckgo.com/";
    const params = new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
    });

    const response = await fetch(`${endpoint}?${params}`, {
      headers: {
        "User-Agent": "LINE-Bot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    // Abstract（要約情報）
    if (data.Abstract) {
      results.push({
        title: data.Heading || "概要",
        url: data.AbstractURL || "",
        snippet: data.Abstract,
      });
    }

    // Related Topics（関連トピック）
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, count - results.length)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(" - ")[0] || "関連情報",
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }

    // 結果が少ない場合、SerpApiの無料プランも試す
    if (results.length === 0 && process.env.SERPAPI_API_KEY) {
      return await searchWithSerpApi(query, count);
    }

    logger.info("Search completed", {
      query,
      resultCount: results.length,
      source: "DuckDuckGo",
    });

    return results.slice(0, count);
  } catch (error) {
    logger.error("Search error:", {
      message: error.message,
      query,
    });
    return [];
  }
}

/**
 * SerpApi（無料プラン: 月100回）を使用した検索
 * @param {string} query - 検索クエリ
 * @param {number} count - 取得する結果数
 * @returns {Promise<Array>} 検索結果の配列
 */
async function searchWithSerpApi(query, count = 5) {
  try {
    const endpoint = "https://serpapi.com/search";
    const params = new URLSearchParams({
      q: query,
      api_key: process.env.SERPAPI_API_KEY,
      engine: "google",
      num: count.toString(),
      hl: "ja",
      gl: "jp",
    });

    const response = await fetch(`${endpoint}?${params}`);

    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    if (data.organic_results && Array.isArray(data.organic_results)) {
      for (const result of data.organic_results.slice(0, count)) {
        results.push({
          title: result.title || "",
          url: result.link || "",
          snippet: result.snippet || "",
        });
      }
    }

    logger.info("Search completed", {
      query,
      resultCount: results.length,
      source: "SerpApi",
    });

    return results;
  } catch (error) {
    logger.error("SerpApi search error:", {
      message: error.message,
      query,
    });
    return [];
  }
}

/**
 * 検索結果をテキスト形式にフォーマット
 * @param {Array} results - 検索結果
 * @returns {string} フォーマットされたテキスト
 */
function formatSearchResults(results) {
  if (!results || results.length === 0) {
    return "";
  }

  return results
    .map((result, index) => {
      return `[${index + 1}] ${result.title}\n${result.snippet}\nURL: ${
        result.url
      }`;
    })
    .join("\n\n");
}

module.exports = {
  searchWeb,
  formatSearchResults,
};
