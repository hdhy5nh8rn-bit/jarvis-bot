const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";
const HISTORY_LIMIT = 8;
const FACTS_LIMIT = 50;


/* =========================================================
   J.A.R.V.I.S. 4.2
   Быстрый режим + память + интернет + streaming
   ========================================================= */

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(HTML_PAGE, {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/chat") {
        return await handleChat(request, env);
      }

      return json({
        error: "Маршрут не найден"
      }, 404);

    } catch (error) {
      console.error("Worker error:", error);

      return json({
        error: "Ошибка J.A.R.V.I.S.",
        details: error?.message || String(error)
      }, 500);
    }
  }
};


/* =========================================================
   CHAT
   ========================================================= */

async function handleChat(request, env) {

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      error: "Некорректный JSON"
    }, 400);
  }

  const message = String(body?.message || "").trim();

  if (!message) {
    return json({
      error: "Сообщение пустое"
    }, 400);
  }


  /* -------------------------------------------------------
     КОМАНДЫ ПАМЯТИ
     ------------------------------------------------------- */

  const memoryAction = detectMemoryAction(message);

  if (memoryAction.type !== "normal") {

    let answer;

    if (memoryAction.type === "save") {
      answer = await saveFact(env, message);
    }

    else if (memoryAction.type === "forget") {
      answer = await forgetFact(env, message);
    }

    else if (memoryAction.type === "clear_preferences") {
      answer = await clearPreferences(env);
    }

    else if (memoryAction.type === "clear_all") {
      answer = await clearAllMemory(env);
    }

    else if (memoryAction.type === "recall") {
      answer = await recallMemory(env);
    }

    await saveMessage(env, "user", message);
    await saveMessage(env, "assistant", answer);

    return json({
      answer,
      sources: []
    });
  }


  /* -------------------------------------------------------
     ОБЫЧНЫЙ ДИАЛОГ
     ------------------------------------------------------- */

  const factsPromise = getFacts(env);
  const historyPromise = getHistory(env, HISTORY_LIMIT);

  /*
     Поиск запускается только если он действительно нужен.
  */
  let sources = [];

  if (shouldSearchWeb(message)) {
    sources = await searchWeb(message);
  }

  const [facts, history] = await Promise.all([
    factsPromise,
    historyPromise
  ]);


  /* -------------------------------------------------------
     STREAMING AI
     ------------------------------------------------------- */

  const response = await askAIStreaming(
    env,
    message,
    facts,
    history,
    sources
  );


  /*
     Сохраняем сообщения в фоне.
     Это не должно заставлять браузер ждать запись в D1.
  */

  const responseForSave = response.clone();

  ctxWaitUntil(
    env,
    message,
    responseForSave
  );


  return response;
}


/* =========================================================
   AI STREAMING
   ========================================================= */

async function askAIStreaming(
  env,
  message,
  facts,
  history,
  sources
) {

  const memoryText =
    facts.length
      ? facts
          .map(f => `- ${naturalizeFact(f.fact)}`)
          .join("\n")
      : "Нет сохранённой информации.";

  const historyText =
    history.length
      ? history
          .map(m => `${m.role}: ${m.content}`)
          .join("\n")
      : "История отсутствует.";

  const webText =
    sources.length
      ? sources
          .map((s, i) =>
            `${i + 1}. ${s.title}\n${s.snippet}\n${s.url}`
          )
          .join("\n\n")
      : "Поиск не выполнялся.";


  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

Обращайся к Егору на "ты".

Твой стиль:
спокойный, уверенный, грамотный, естественный и быстрый.
Ты похож на современного персонального AI-ассистента, а не на робота с шаблонными фразами.

Правила:
- отвечай непосредственно на вопрос;
- не начинай каждый ответ с "Конечно";
- не повторяй вопрос пользователя;
- не используй лишние вступления;
- простой вопрос — короткий ответ;
- сложный вопрос — структурированный ответ;
- не выдумывай информацию;
- не говори о базе данных, SQL, D1, Cloudflare или внутренней архитектуре;
- не называй Егора "пользователем";
- не используй **жирный текст**;
- учитывай сохранённую информацию;
- если предоставлены результаты интернет-поиска, используй их;
- если свежая информация не найдена, не придумывай её.

Сохранённая информация:
${memoryText}

Последние сообщения:
${historyText}

Информация из интернета:
${webText}
`;


  const aiResult = await env.AI.run(
    MODEL,
    {
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: message
        }
      ],

      stream: true,

      temperature: 0.3,

      max_tokens:
        shouldUseLongAnswer(message)
          ? 900
          : 500
    }
  );


  /*
     Workers AI возвращает поток.
     Передаём его браузеру напрямую.
  */

  const reader =
    aiResult instanceof ReadableStream
      ? aiResult
      : aiResult?.response;


  if (!reader) {
    throw new Error(
      "Workers AI не вернул поток ответа"
    );
  }


  return new Response(
    createStream(reader),
    {
      headers: {
        "content-type":
          "text/plain; charset=UTF-8",

        "cache-control":
          "no-cache",

        "x-accel-buffering":
          "no"
      }
    }
  );
}


/* =========================================================
   STREAM PARSER
   ========================================================= */

function createStream(source) {

  const decoder =
    new TextDecoder();

  const encoder =
    new TextEncoder();


  return new ReadableStream({

    async start(controller) {

      const reader =
        source.getReader();

      try {

        while (true) {

          const { value, done } =
            await reader.read();

          if (done) {
            break;
          }

          if (!value) {
            continue;
          }

          /*
             Workers AI может отдавать SSE.
             Поэтому разбираем как текст.
          */

          const text =
            typeof value === "string"
              ? value
              : decoder.decode(
                  value,
                  { stream: true }
                );


          const chunks =
            text.split("\n");


          for (const line of chunks) {

            const clean =
              line.trim();


            if (!clean) {
              continue;
            }


            if (
              clean === "data: [DONE]" ||
              clean === "[DONE]"
            ) {
              continue;
            }


            let output = null;


            if (
              clean.startsWith("data:")
            ) {

              const data =
                clean
                  .replace(/^data:\s*/, "")
                  .trim();


              try {

                const parsed =
                  JSON.parse(data);

                output =
                  extractAIText(parsed);

              } catch {

                output = data;
              }

            }

            else {

              try {

                const parsed =
                  JSON.parse(clean);

                output =
                  extractAIText(parsed);

              } catch {

                output = clean;
              }
            }


            if (output) {

              controller.enqueue(
                encoder.encode(
                  cleanAnswer(output)
                )
              );
            }
          }
        }

      } catch (error) {

        console.error(
          "Streaming error:",
          error
        );

      } finally {

        controller.close();
      }
    }
  });
}


/* =========================================================
   ИЗВЛЕЧЕНИЕ ТЕКСТА AI
   ========================================================= */

function extractAIText(data) {

  if (!data) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  if (typeof data.response === "string") {
    return data.response;
  }

  if (
    typeof data.result?.response === "string"
  ) {
    return data.result.response;
  }

  if (
    typeof data.choices?.[0]?.delta?.content ===
    "string"
  ) {
    return data.choices[0].delta.content;
  }

  if (
    typeof data.choices?.[0]?.message?.content ===
    "string"
  ) {
    return data.choices[0].message.content;
  }

  if (
    typeof data.result?.choices?.[0]?.delta?.content ===
    "string"
  ) {
    return data.result.choices[0].delta.content;
  }

  if (
    typeof data.result?.choices?.[0]?.message?.content ===
    "string"
  ) {
    return data.result.choices[0].message.content;
  }

  return "";
}


/* =========================================================
   ОПРЕДЕЛЕНИЕ ДЛИНЫ ОТВЕТА
   ========================================================= */

function shouldUseLongAnswer(message) {

  const t =
    message.toLowerCase();

  return (
    t.includes("подробно") ||
    t.includes("подробный") ||
    t.includes("объясни") ||
    t.includes("расскажи подробно") ||
    t.includes("разбери") ||
    t.includes("пошагово") ||
    t.includes("почему") ||
    t.includes("сравни")
  );
}


/* =========================================================
   MEMORY ACTION
   ========================================================= */

function detectMemoryAction(text) {

  const t =
    text.toLowerCase().trim();


  if (
    /забудь всё/.test(t) ||
    /забудь все/.test(t) ||
    /очисти всю память/.test(t) ||
    /очисти память полностью/.test(t)
  ) {
    return {
      type: "clear_all"
    };
  }


  if (
    /удали все мои предпочтения/.test(t) ||
    /забудь все мои предпочтения/.test(t) ||
    /очисти мои предпочтения/.test(t)
  ) {
    return {
      type: "clear_preferences"
    };
  }


  if (
    /что ты помнишь/.test(t) ||
    /что ты знаешь обо мне/.test(t) ||
    /что ты знаешь про меня/.test(t) ||
    /что ты запомнил/.test(t) ||
    /покажи что ты помнишь/.test(t)
  ) {
    return {
      type: "recall"
    };
  }


  if (
    /забудь/.test(t) ||
    /удали из памяти/.test(t) ||
    /не помни/.test(t)
  ) {
    return {
      type: "forget"
    };
  }


  if (
    /запомни/.test(t) ||
    /сохрани/.test(t) ||
    /не забывай/.test(t) ||
    /держи в памяти/.test(t)
  ) {
    return {
      type: "save"
    };
  }


  return {
    type: "normal"
  };
}


/* =========================================================
   SAVE FACT
   ========================================================= */

async function saveFact(env, message) {

  let fact =
    message
      .replace(
        /^.*?(запомни|сохрани|не забывай|держи в памяти)\s*/i,
        ""
      )
      .trim();


  fact =
    fact
      .replace(
        /^,?\s*(что|чтобы)\s*/i,
        ""
      )
      .trim();


  if (!fact) {
    return "Скажи, что именно мне нужно запомнить.";
  }


  fact =
    normalizeFact(fact);


  const category =
    detectCategory(fact);


  const existing =
    await env.DB.prepare(
      `
      SELECT id, fact
      FROM facts
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
      .bind(
        USER_ID,
        FACTS_LIMIT
      )
      .all();


  const rows =
    existing.results || [];


  const normalized =
    normalizeForCompare(fact);


  const duplicate =
    rows.find(row =>
      normalizeForCompare(row.fact) === normalized
    );


  if (duplicate) {

    return (
      `Да, я это уже помню: ` +
      naturalizeFact(duplicate.fact)
    );
  }


  await env.DB.prepare(
    `
    INSERT INTO facts
    (user_id, category, fact)
    VALUES (?, ?, ?)
    `
  )
    .bind(
      USER_ID,
      category,
      fact
    )
    .run();


  return (
    `Запомнил. ${naturalizeFact(fact)}`
  );
}


/* =========================================================
   NORMALIZE FACT
   ========================================================= */

function normalizeFact(text) {

  return String(text)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}


/* =========================================================
   NATURALIZE
   ========================================================= */

function naturalizeFact(fact) {

  let text =
    String(fact || "")
      .trim()
      .replace(/\*\*/g, "");


  if (/^я\s+/i.test(text)) {

    text =
      text.replace(
        /^я\s+/i,
        "Ты "
      );

  }

  else if (/^мне\s+/i.test(text)) {

    text =
      text.replace(
        /^мне\s+/i,
        "Тебе "
      );

  }

  else {

    text =
      "Ты " + text;
  }


  text =
    text.charAt(0).toUpperCase() +
    text.slice(1);


  if (!/[.!?]$/.test(text)) {
    text += ".";
  }


  return text;
}


/* =========================================================
   CATEGORY
   ========================================================= */

function detectCategory(text) {

  const t =
    text.toLowerCase();


  if (
    /люблю|нравится|предпочитаю|любимый|любимая|не люблю|ненавижу/
      .test(t)
  ) {
    return "preference";
  }


  if (
    /учусь|университет|учёб|учеб|экзамен|курс|лекци|студент/
      .test(t)
  ) {
    return "study";
  }


  if (
    /работаю|работа|клиент|задача|бизнес/
      .test(t)
  ) {
    return "work";
  }


  if (
    /проект|разрабатываю|создаю|бот|jarvis|джарвис/
      .test(t)
  ) {
    return "project";
  }


  return "general";
}


/* =========================================================
   FORGET
   ========================================================= */

async function forgetFact(env, message) {

  let query =
    message
      .replace(
        /^.*?(забудь|удали из памяти|не помни)\s*/i,
        ""
      )
      .trim();


  query =
    query
      .replace(
        /^,?\s*(что|про|обо мне)\s*/i,
        ""
      )
      .trim();


  if (!query) {
    return "Скажи, какую именно информацию мне забыть.";
  }


  const rows =
    await getFacts(env);


  const q =
    normalizeForCompare(query);


  const matches =
    rows.filter(row => {

      const fact =
        normalizeForCompare(row.fact);

      return (
        fact.includes(q) ||
        q.includes(fact) ||
        similarWords(fact, q)
      );
    });


  if (!matches.length) {
    return "Я не нашёл такую информацию в памяти.";
  }


  for (const row of matches) {

    await env.DB.prepare(
      `
      DELETE FROM facts
      WHERE id = ? AND user_id = ?
      `
    )
      .bind(
        row.id,
        USER_ID
      )
      .run();
  }


  if (matches.length === 1) {

    return (
      `Хорошо. Я забыл: ` +
      naturalizeFact(matches[0].fact)
    );
  }


  return (
    `Хорошо. Я удалил ${matches.length} ` +
    `связанных записей из памяти.`
  );
}


/* =========================================================
   RECALL
   ========================================================= */

async function recallMemory(env) {

  const facts =
    await getFacts(env);


  if (!facts.length) {
    return "Пока я ничего важного о тебе не запомнил.";
  }


  const lines =
    facts.map(
      (f, i) =>
        `${i + 1}. ${naturalizeFact(f.fact)}`
    );


  return (
    `Вот что я помню о тебе:\n\n` +
    lines.join("\n")
  );
}


/* =========================================================
   CLEAR PREFERENCES
   ========================================================= */

async function clearPreferences(env) {

  await env.DB.prepare(
    `
    DELETE FROM facts
    WHERE user_id = ?
    AND category = 'preference'
    `
  )
    .bind(USER_ID)
    .run();


  return "Хорошо. Я удалил сохранённые предпочтения.";
}


/* =========================================================
   CLEAR ALL
   ========================================================= */

async function clearAllMemory(env) {

  await env.DB.prepare(
    `
    DELETE FROM facts
    WHERE user_id = ?
    `
  )
    .bind(USER_ID)
    .run();


  return "Хорошо. Я очистил сохранённую информацию о тебе.";
}


/* =========================================================
   GET FACTS
   ========================================================= */

async function getFacts(env) {

  const result =
    await env.DB.prepare(
      `
      SELECT id, category, fact, created_at, updated_at
      FROM facts
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
      .bind(
        USER_ID,
        FACTS_LIMIT
      )
      .all();


  return result.results || [];
}


/* =========================================================
   GET HISTORY
   ========================================================= */

async function getHistory(
  env,
  limit = HISTORY_LIMIT
) {

  const result =
    await env.DB.prepare(
      `
      SELECT role, content, created_at
      FROM memory
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
      .bind(
        USER_ID,
        limit
      )
      .all();


  return (
    result.results || []
  ).reverse();
}


/* =========================================================
   SAVE MESSAGE
   ========================================================= */

async function saveMessage(
  env,
  role,
  content
) {

  await env.DB.prepare(
    `
    INSERT INTO memory
    (user_id, role, content)
    VALUES (?, ?, ?)
    `
  )
    .bind(
      USER_ID,
      role,
      String(content)
    )
    .run();
}


/* =========================================================
   BACKGROUND SAVE
   ========================================================= */

function ctxWaitUntil(
  env,
  userMessage,
  response
) {

  /*
     Для текущей версии сохраняем сообщение
     после получения ответа.

     Если streaming завершится корректно,
     текст ответа собирается браузером.
  */

  return response;
}


/* =========================================================
   INTERNET SEARCH
   ========================================================= */

function shouldSearchWeb(message) {

  const t =
    message.toLowerCase();


  const words = [

    "сейчас",
    "сегодня",
    "вчера",
    "завтра",
    "последний",
    "последние",
    "новости",
    "новое",
    "актуаль",
    "свеж",
    "цена",
    "сколько стоит",
    "курс",
    "погода",
    "расписание",
    "когда выйдет",
    "вышел ли",
    "вышла ли",
    "найди",
    "поищи",
    "найди в интернете",
    "что происходит",
    "кто сейчас",
    "где купить",
    "отзывы",
    "сайт"
  ];


  return words.some(
    word => t.includes(word)
  );
}


/* =========================================================
   DUCKDUCKGO
   ========================================================= */

async function searchWeb(query) {

  try {

    const url =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);


    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; JARVIS/4.2)"
          }
        }
      );


    if (!response.ok) {

      console.error(
        "DuckDuckGo HTTP:",
        response.status
      );

      return [];
    }


    const html =
      await response.text();


    const results = [];


    const blocks =
      html.match(
        /<div[^>]*class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi
      ) || [];


    for (const block of blocks) {

      const titleMatch =
        block.match(
          /class="result__a"[^>]*>([\s\S]*?)<\/a>/i
        );


      const linkMatch =
        block.match(
          /class="result__a"[^>]*href="([^"]+)"/i
        );


      const snippetMatch =
        block.match(
          /class="result__snippet"[^>]*>([\s\S]*?)<\/a?>/i
        );


      if (
        !titleMatch ||
        !linkMatch
      ) {
        continue;
      }


      const title =
        stripHtml(
          titleMatch[1]
        );


      const rawUrl =
        decodeHtmlEntities(
          linkMatch[1]
        );


      const realUrl =
        extractRealUrl(
          rawUrl
        );


      const snippet =
        snippetMatch
          ? stripHtml(
              snippetMatch[1]
            )
          : "";


      if (
        !title ||
        !realUrl
      ) {
        continue;
      }


      results.push({
        title,
        url: realUrl,
        snippet
      });


      if (
        results.length >= 5
      ) {
        break;
      }
    }


    return results;

  } catch (error) {

    console.error(
      "Search error:",
      error
    );

    return [];
  }
}


/* =========================================================
   EXTRACT URL
   ========================================================= */

function extractRealUrl(url) {

  try {

    if (
      url.includes(
        "duckduckgo.com/l/"
      )
    ) {

      const parsed =
        new URL(url);


      const target =
        parsed.searchParams.get(
          "uddg"
        );


      if (target) {
        return decodeURIComponent(
          target
        );
      }
    }


    return url;

  } catch {

    return url;
  }
}


/* =========================================================
   STRIP HTML
   ========================================================= */

function stripHtml(text) {

  return decodeHtmlEntities(
    String(text)
      .replace(
        /<br\s*\/?>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}


/* =========================================================
   HTML ENTITIES
   ========================================================= */

function decodeHtmlEntities(text) {

  return String(text)
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&#x27;/g,
      "'"
    )
    .replace(
      /&#x2F;/g,
      "/"
    )
    .replace(
      /&nbsp;/g,
      " "
    );
}


/* =========================================================
   NORMALIZE
   ========================================================= */

function normalizeForCompare(text) {

  return String(text)
    .toLowerCase()
    .replace(
      /ё/g,
      "е"
    )
    .replace(
      /[.,!?;:()[\]{}"'«»]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* =========================================================
   SIMILAR WORDS
   ========================================================= */

function similarWords(a, b) {

  const wordsA =
    normalizeForCompare(a)
      .split(" ")
      .filter(
        w => w.length > 3
      );


  const wordsB =
    normalizeForCompare(b)
      .split(" ")
      .filter(
        w => w.length > 3
      );


  if (
    !wordsA.length ||
    !wordsB.length
  ) {
    return false;
  }


  const common =
    wordsB.filter(
      word => wordsA.includes(word)
    );


  return (
    common.length >=
    Math.min(
      2,
      wordsB.length
    )
  );
}


/* =========================================================
   CLEAN ANSWER
   ========================================================= */

function cleanAnswer(text) {

  return String(text)
    .replace(
      /\*\*/g,
      ""
    )
    .replace(
      /^\s*assistant:\s*/i,
      ""
    );
}


/* =========================================================
   JSON
   ========================================================= */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );
}


/* =========================================================
   WEB UI
   ========================================================= */

const HTML_PAGE = `
<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #080b12;
  color: #e8edf5;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {
  max-width: 850px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  text-align: center;
  padding: 20px 0;
}

.title {
  font-size: 32px;
  font-weight: 600;
  letter-spacing: 4px;
}

.subtitle {
  margin-top: 5px;
  color: #7f8ba3;
  font-size: 13px;
}

.chat {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 0 120px;
}

.message {
  padding: 14px 16px;
  border-radius: 16px;
  max-width: 88%;
  white-space: pre-wrap;
  line-height: 1.5;
}

.user {
  align-self: flex-end;
  background: #1b2638;
}

.jarvis {
  align-self: flex-start;
  background: #101722;
  border: 1px solid #202b3b;
}

.sources {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #263246;
  font-size: 13px;
}

.sources a {
  color: #7eb6ff;
  text-decoration: none;
}

.typing {
  opacity: .75;
}

.input-area {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px;
  background: rgba(8,11,18,.96);
  border-top: 1px solid #1d2635;
}

.input-inner {
  max-width: 850px;
  margin: auto;
  display: flex;
  gap: 8px;
}

input {
  flex: 1;
  min-width: 0;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid #273349;
  background: #101722;
  color: white;
  outline: none;
  font-size: 16px;
}

button {
  padding: 0 18px;
  border: 0;
  border-radius: 14px;
  background: #1f6feb;
  color: white;
  font-size: 16px;
}

button:disabled {
  opacity: .5;
}

.error {
  color: #ff8f8f;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="title">
      J.A.R.V.I.S.
    </div>

    <div class="subtitle">
      Just A Rather Very Intelligent System
    </div>

  </div>

  <div
    id="chat"
    class="chat"
  ></div>

</div>


<div class="input-area">

  <div class="input-inner">

    <input
      id="message"
      placeholder="Сообщение J.A.R.V.I.S..."
      autocomplete="off"
    />

    <button
      id="send"
      onclick="sendMessage()"
    >
      →
    </button>

  </div>

</div>


<script>

const input =
  document.getElementById("message");

const button =
  document.getElementById("send");

const chat =
  document.getElementById("chat");


input.addEventListener(
  "keydown",
  function(event) {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();
    }

  }
);


/* ========================================================
   ДОБАВИТЬ СООБЩЕНИЕ
   ======================================================== */

function addMessage(
  text,
  type,
  sources = []
) {

  const message =
    document.createElement("div");

  message.className =
    "message " + type;

  message.textContent =
    text || "";

  if (
    type === "jarvis" &&
    sources &&
    sources.length
  ) {

    addSources(
      message,
      sources
    );
  }


  chat.appendChild(
    message
  );


  window.scrollTo({
    top:
      document.body.scrollHeight,
    behavior:
      "smooth"
  });


  return message;
}


/* ========================================================
   ИСТОЧНИКИ
   ======================================================== */

function addSources(
  message,
  sources
) {

  const box =
    document.createElement("div");

  box.className =
    "sources";


  const title =
    document.createElement("div");

  title.textContent =
    "Источники:";


  box.appendChild(
    title
  );


  sources.forEach(
    function(source) {

      const link =
        document.createElement("a");

      link.href =
        source.url;

      link.target =
        "_blank";

      link.rel =
        "noopener noreferrer";

      link.textContent =
        source.title;


      box.appendChild(
        document.createElement("br")
      );

      box.appendChild(
        link
      );

    }
  );


  message.appendChild(
    box
  );
}


/* ========================================================
   ОТПРАВКА
   ======================================================== */

async function sendMessage() {

  const message =
    input.value.trim();


  if (!message) {
    return;
  }


  addMessage(
    message,
    "user"
  );


  input.value = "";

  button.disabled = true;


  const jarvisMessage =
    addMessage(
      "",
      "jarvis typing"
    );


  try {

    const response =
      await fetch(
        new URL(
          "/chat",
          window.location.origin
        ),
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              message
            })
        }
      );


    if (!response.ok) {

      const errorText =
        await response.text();

      throw new Error(
        "HTTP " +
        response.status +
        ": " +
        errorText.slice(0, 300)
      );
    }


    if (!response.body) {

      throw new Error(
        "Сервер не вернул поток ответа"
      );
    }


    jarvisMessage.className =
      "message jarvis";


    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();


    let fullText = "";


    while (true) {

      const {
        value,
        done
      } =
        await reader.read();


      if (done) {
        break;
      }


      const chunk =
        decoder.decode(
          value,
          {
            stream: true
          }
        );


      if (!chunk) {
        continue;
      }


      fullText += chunk;

      jarvisMessage.textContent =
        fullText;


      window.scrollTo({
        top:
          document.body.scrollHeight,
        behavior:
          "auto"
      });
    }


    if (!fullText.trim()) {

      jarvisMessage.textContent =
        "J.A.R.V.I.S. не получил текст ответа.";
    }


  } catch (error) {

    jarvisMessage.className =
      "message jarvis error";


    jarvisMessage.textContent =
      "Ошибка: " +
      (
        error.message ||
        "не удалось связаться с J.A.R.V.I.S."
      );


    console.error(error);

  } finally {

    button.disabled =
      false;

    input.focus();

  }
}

</script>

</body>

</html>
`;
