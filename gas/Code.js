/**
 * 中国語写真作文 バックエンドスクリプト (Google Apps Script)
 *
 * 【変更点】
 * ・全処理を DeepSeek API（OpenAI互換）に統一
 * ・画像解析も deepseek-flash（マルチモーダル）で実施
 *    → OpenAI互換の content: [{type:"text"},{type:"image_url"}] 形式で送信
 * ・データ保存はフロントエンド（localStorage/IndexedDB）で実施
 *
 * 【スクリプトプロパティ】
 *   DEEPSEEK_API_KEY : sk-xxxxxxxxxxxxxxxx
 *
 * 【モデル設定】
 *   VISION_MODEL / TEXT_MODEL を用途別に切替可能（必要なら差し替え）
 */

var CONFIG = {
  API_URL: "https://api.deepseek.com/chat/completions",
  TEXT_MODEL: "deepseek-chat",     // 添削用（必要なら deepseek-flash に変更）
  VISION_MODEL: "deepseek-flash",  // 画像解析用（マルチモーダル）
  TIMEOUT_MS: 120000
};

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  return createJsonResponse({
    status: "success",
    message: "中国語写真作文 API サーバー (DeepSeek統合版) は正常に稼働しています。",
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "リクエストデータが空です。" }, 400);
    }

    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;

    var scriptProps = PropertiesService.getScriptProperties();
    var apiKey = String(
      requestData.apiKey ||
      requestData.deepseekApiKey ||
      scriptProps.getProperty("DEEPSEEK_API_KEY") ||
      ""
    ).trim();

    if (!apiKey && action !== "ping" && action !== "get_app_info") {
      return createJsonResponse({
        status: "error",
        message: "DeepSeek APIキーが設定されていません。"
      }, 500);
    }

    switch (action) {
      case "test_connection":
        return handleTestConnection(apiKey);
      case "analyze_image":
        return handleAnalyzeImage(requestData, apiKey);
      case "check_essay":
        return handleCheckEssay(requestData, apiKey);
      case "list_drive_images":
      case "load_drive_image":
      case "get_app_info":
        return createJsonResponse({ status: "success", data: { files: [] } });
      default:
        return createJsonResponse({ status: "error", message: "未対応のアクションです: " + action }, 400);
    }

  } catch (error) {
    Logger.log("Error in doPost: " + error.toString());
    return createJsonResponse({ status: "error", message: "サーバーエラーが発生しました: " + error.message }, 500);
  }
}

/* =========================================================
 *  接続テスト
 * ========================================================= */
function handleTestConnection(apiKey) {
  try {
    var res = callDeepSeek(apiKey, {
      model: CONFIG.VISION_MODEL,
      messages: [
        { role: "user", content: '次のJSONのみを返してください: {"status":"ok"}' }
      ],
      jsonMode: true,
      temperature: 0.1
    });
    return createJsonResponse({
      status: "success",
      message: "GASおよびDeepSeek APIの接続が正常に確認できました！",
      sample: res.slice(0, 60)
    });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "DeepSeek APIの疎通確認に失敗しました: " + err.message
    }, 500);
  }
}

/* =========================================================
 *  画像解析（DeepSeek マルチモーダル）
 * ========================================================= */
function handleAnalyzeImage(data, apiKey) {
  var base64Data = data.imageBase64;
  var mimeType = data.mimeType || "image/jpeg";

  if (!base64Data) {
    return createJsonResponse({ status: "error", message: "画像データが見つかりません。" }, 400);
  }

  // data URI の正規化
  var cleanBase64 = base64Data;
  if (cleanBase64.indexOf("data:") === 0) {
    var mimeMatch = cleanBase64.match(/^data:([^;]+);base64,/);
    if (mimeMatch) mimeType = mimeMatch[1];
    cleanBase64 = cleanBase64.replace(/^data:[^;]+;base64,/, "");
  }
  cleanBase64 = cleanBase64.replace(/\s/g, "");

  var dataUrl = "data:" + mimeType + ";base64," + cleanBase64;

  var prompt = [
    "あなたは日本人向けの優秀な中国語学習教師です。",
    "提供された画像（写真またはイラスト）を細かく観察し、以下の指示に従って学習用データをJSON形式で出力してください。",
    "【出力仕様】",
    "1. 画像内の主な物体、人物、動作、感情、場所、色、状況などを表す中国語単語を8〜12個抽出してください。",
    "2. 日本人学習者が覚えやすいよう、簡体字、正確な声調記号付きピンイン、品詞、日本語訳、およびその単語を使った短い実践例文（ピンイン・日本語訳付き）を含めてください。",
    "3. 画像の全体的なシーンを描写する「初級レベル（HSK1-2相当の短文・平易な文）」と「中級レベル（HSK3-4相当のまとまった表現・複文）」の模範作文を作成してください。",
    "4. 必ず以下のJSONスキーマ通りの有効なJSON文字列のみを出力してください（マークダウンの```json等のコードブロックは不要。純粋なJSONオブジェクトのみ）。",
    "【JSONスキーマ】",
    "{",
    '  "scene_description_ja": "画像の概要（日本語での1行説明）",',
    '  "words": [',
    "    {",
    '      "word": "中国語単語（簡体字）",',
    '      "pinyin": "ピンイン（声調記号付き 例: píngguǒ）",',
    '      "pos": "品詞（名詞/動詞/形容詞など）",',
    '      "meaning": "日本語の意味",',
    '      "example_cn": "この単語を使った短い例文",',
    '      "example_pinyin": "例文のピンイン",',
    '      "example_ja": "例文の日本語訳"',
    "    }",
    "  ],",
    '  "model_essays": {',
    '    "beginner": {',
    '      "level_title": "初級（短い文で描写）",',
    '      "essay_cn": "初級の中国語模範作文",',
    '      "essay_pinyin": "ピンイン",',
    '      "essay_ja": "日本語訳",',
    '      "key_points": ["初級文法のポイント1", "ポイント2"]',
    "    },",
    '    "intermediate": {',
    '      "level_title": "中級（より豊かな表現で描写）",',
    '      "essay_cn": "中級の中国語模範作文",',
    '      "essay_pinyin": "ピンイン",',
    '      "essay_ja": "日本語訳",',
    '      "key_points": ["使われた構文や接続詞の解説1", "解説2"]',
    "    }",
    "  }",
    "}"
  ].join("\n");

  // OpenAI互換のマルチモーダル content
  var messages = [
    {
      role: "system",
      content: "あなたは画像を正確に観察し、必ず有効なJSONオブジェクトのみを出力する中国語教師アシスタントです。"
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }
  ];

  var rawResponse = callDeepSeek(apiKey, {
    model: CONFIG.VISION_MODEL,
    messages: messages,
    jsonMode: true,
    temperature: 0.2
  });

  var parsedResult;
  try {
    parsedResult = parseJsonResponse(rawResponse);
  } catch (e) {
    return createJsonResponse({
      status: "error",
      message: "AIの解析結果をJSONとして解析できませんでした: " + e.message,
      raw: rawResponse
    }, 500);
  }

  return createJsonResponse({
    status: "success",
    data: {
      analysis: parsedResult,
      drive: { saved: false }
    }
  });
}

/* =========================================================
 *  作文添削（テキスト）
 * ========================================================= */
function handleCheckEssay(data, apiKey) {
  var userEssay = data.userEssay;
  var imageContext = data.imageContext || "";

  if (!userEssay || !userEssay.trim()) {
    return createJsonResponse({ status: "error", message: "作文内容が入力されていません。" }, 400);
  }

  var prompt = [
    "あなたは日本人学習者向けの親切で的確な中国語教師です。",
    "ユーザーが画像を見ながら書いた中国語作文を添削し、アドバイスを提供してください。",
    "【画像コンテキスト・抽出単語情報】",
    imageContext,
    "【ユーザーの作文】",
    userEssay,
    "【添削の観点】",
    "1. 語順、量詞、前置詞（介詞）、アスペクト助詞（了・着・过）などの文法エラーを指摘・修正",
    "2. 日本語の直訳っぽい不自然な表現を、中国人が日常で使う自然な表現（地道な中国語）にブラッシュアップ",
    "3. 良い点も褒めて学習モチベーションを高める丁寧な日本語解説",
    "4. 必ず以下のJSON形式で出力してください（コードブロックなしの純粋なJSON）。",
    "【JSONスキーマ】",
    "{",
    '  "score": 85,',
    '  "score_comment": "全体の評価・励ましの一言（日本語）",',
    '  "corrected_essay": "添削後の完成中国語文",',
    '  "corrected_pinyin": "添削後文のピンイン（声調記号付き）",',
    '  "corrected_ja": "添削後文の日本語訳",',
    '  "corrections": [',
    "    {",
    '      "original": "間違いまたは不自然な箇所の元の表現",',
    '      "corrected": "修正後の表現",',
    '      "pinyin": "修正後のピンイン",',
    '      "reason": "なぜ修正したかの日本語解説（文法規則やニュアンスの違い）"',
    "    }",
    "  ],",
    '  "better_expressions": [',
    "    {",
    '      "expression": "さらにネイティブらしくなる表現・成語・構文",',
    '      "pinyin": "ピンイン",',
    '      "meaning": "意味と使い所の解説"',
    "    }",
    "  ],",
    '  "grammar_tips": ["日本人学習者が特に注意すべき文法ポイント1", "ポイント2"]',
    "}"
  ].join("\n");

  var rawResponse = callDeepSeek(apiKey, {
    model: CONFIG.TEXT_MODEL,
    messages: [
      {
        role: "system",
        content: "あなたは優秀で丁寧な中国語学習アシスタントです。必ず有効なJSONオブジェクトのみを出力してください。"
      },
      { role: "user", content: prompt }
    ],
    jsonMode: true,
    temperature: 0.3
  });

  var parsedResult;
  try {
    parsedResult = parseJsonResponse(rawResponse);
  } catch (e) {
    return createJsonResponse({
      status: "error",
      message: "添削結果のJSONパースに失敗しました: " + e.message,
      raw: rawResponse
    }, 500);
  }

  return createJsonResponse({
    status: "success",
    data: parsedResult
  });
}

/* =========================================================
 *  DeepSeek API 呼び出し（OpenAI互換 Chat Completions）
 *  - テキスト／画像（image_url）どちらも同一関数で処理
 * ========================================================= */
function callDeepSeek(apiKey, opts) {
  var cleanApiKey = String(apiKey || "").trim();
  if (!cleanApiKey) throw new Error("DeepSeek APIキーが空です。");

  var payload = {
    model: opts.model || CONFIG.TEXT_MODEL,
    messages: opts.messages,
    temperature: (opts.temperature != null) ? opts.temperature : 0.2,
    stream: false
  };

  if (opts.jsonMode !== false) {
    payload.response_format = { type: "json_object" };
  }
  if (opts.maxTokens) payload.max_tokens = opts.maxTokens;

  var fetchOptions = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + cleanApiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(CONFIG.API_URL, fetchOptions);
  var statusCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (statusCode !== 200) {
    throw new Error("DeepSeek API [HTTP " + statusCode + "]: " + responseText);
  }

  var resJson = JSON.parse(responseText);
  if (!resJson.choices || !resJson.choices[0] || !resJson.choices[0].message) {
    throw new Error("DeepSeek APIの応答形式が不正です: " + responseText);
  }

  return resJson.choices[0].message.content;
}

/* =========================================================
 *  ユーティリティ
 * ========================================================= */
function parseJsonResponse(rawText) {
  var cleaned = String(rawText || "").trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");
  var firstOpen = cleaned.indexOf("{");
  var lastClose = cleaned.lastIndexOf("}");
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    cleaned = cleaned.substring(firstOpen, lastClose + 1);
  }
  return JSON.parse(cleaned);
}

function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}