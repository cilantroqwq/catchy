// Cloudflare Pages Function: /api/ai (使用 Cloudflare 內建 Workers AI，免 API Key、香港直連)
// 部署後請在 Cloudflare Pages -> Settings -> Bindings 新增 Workers AI，Variable name 填：AI

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function extractJSON(text) {
  if (!text) throw new Error("Empty AI response");
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    if (!env.AI) {
      return new Response(
        JSON.stringify({
          error: "MISSING_AI_BINDING",
          message: "尚未綁定 Cloudflare AI！請到 Cloudflare Pages -> Settings -> Bindings 新增 Workers AI，Variable name 填 AI。",
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { action, payload } = body || {};

    let systemPrompt = "You are a helpful English-to-Hong Kong Traditional Chinese dictionary and tutor. You MUST respond ONLY with valid JSON. Do not include any markdown, explanation, or extra text outside the JSON object.";
    let userPrompt = "";

    if (action === "translate") {
      const text = (payload?.text || "").trim().slice(0, 500);
      if (!text) {
        return new Response(JSON.stringify({ error: "EMPTY_INPUT" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
      const isSentence = text.split(/\s+/).length >= 3 || /[.?!,;:]/.test(text);
      userPrompt = `Translate or define this English input for Hong Kong students:
Input: "${text}"
Type: ${isSentence ? "sentence/phrase" : "single word"}

Return ONLY valid JSON with this exact schema:
{
  "isTypo": boolean,
  "originalInput": string,
  "suggestions": [{ "word": string, "meaning": string }],
  "word": string,
  "isSentence": boolean,
  "ipaUS": string,
  "ipaUK": string,
  "pos": string,
  "meaning": string,
  "examples": [{ "en": string, "zh": string }],
  "keyWords": [{ "word": string, "ipa": string, "pos": string, "meaning": string }]
}

Rules:
1. If input is a single misspelled English word (like "accomodate", "definately"), set "isTypo": true, give 3-5 closest valid words in "suggestions" with Traditional Chinese meanings, and leave "meaning" as "".
2. Otherwise set "isTypo": false and "suggestions": [].
3. Use Hong Kong Traditional Chinese (繁體中文) for all meanings and Chinese translations.
4. For a single word: fill "ipaUS", "ipaUK", "pos", concise "meaning", 2 practical "examples", and "keyWords": [].
5. For a sentence: set "isSentence": true, "pos": "句子", full Traditional Chinese translation in "meaning", 1-2 examples, and extract 1-3 useful vocabulary words into "keyWords".`;
    } else if (action === "article") {
      const words = Array.isArray(payload?.words) ? payload.words.slice(0, 10) : [];
      const level = payload?.level || "DSE Lv 3–4";
      const style = payload?.style || "搭車小故事";
      const includeQuiz = style.includes("測驗");
      const wordListStr = words.map((w) => `${w.word} (${w.meaning})`).join(", ");

      userPrompt = `Write an English reading passage for Hong Kong students incorporating these words: ${wordListStr || "resilient, inevitable, perspective, demonstrate, sustainable"}.
Level: ${level}
Style: ${style}

Return ONLY valid JSON with this exact schema:
{
  "title": string,
  "titleZh": string,
  "paragraphs": [string],
  "usedWords": [string],
  "translationZh": string,
  "quiz": [
    {
      "question": string,
      "options": [string, string, string, string],
      "answerIndex": number,
      "explanationZh": string
    }
  ]
}

Rules:
1. Naturally weave the target words into 2-3 paragraphs (~150-220 words total). List used base words in "usedWords".
2. Use Hong Kong Traditional Chinese for "titleZh", "translationZh", and "explanationZh".
3. If ${includeQuiz ? "true" : "false"} is true, provide 2 multiple-choice comprehension questions in "quiz" (0-based "answerIndex"). Otherwise return "quiz": [].`;
    } else if (action === "lookup_in_context") {
      const word = (payload?.word || "").trim().slice(0, 60);
      const sentence = (payload?.sentence || "").trim().slice(0, 400);
      if (!word) {
        return new Response(JSON.stringify({ error: "EMPTY_WORD" }), {
          status: 400,
          headers: corsHeaders,
        });
      }
      userPrompt = `Explain the English word "${word}" in this context sentence: "${sentence}".
Return ONLY valid JSON:
{
  "word": string,
  "baseForm": string,
  "ipa": string,
  "pos": string,
  "meaning": string,
  "contextMeaning": string
}
Use concise Hong Kong Traditional Chinese (繁體中文).`;
    } else {
      return new Response(JSON.stringify({ error: "INVALID_ACTION" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: action === "article" ? 1500 : 800,
      temperature: action === "article" ? 0.6 : 0.2,
    });

    const rawText = typeof aiResponse === "string"
      ? aiResponse
      : (aiResponse?.response || aiResponse?.choices?.[0]?.message?.content || "");

    const parsed = extractJSON(rawText);
    return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "SERVER_ERROR",
        message: err?.message || "AI 處理失敗，請再試一次",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
