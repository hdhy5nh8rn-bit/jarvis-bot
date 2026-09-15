const MODEL = "@cf/zai-org/glm-4.7-flash";

const USER_ID = "egor";

const MAX_HISTORY = 10;
const MAX_FACTS = 30;
const MAX_SEARCH_RESULTS = 5;


// ============================================================
// ОСНОВНОЙ WORKER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {

      // --------------------------------------------------------
      // Главная страница
      // --------------------------------------------------------

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(getHTML(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          }
        });
      }


      // --------------------------------------------------------
      // PING
      // --------------------------------------------------------

      if (request.method === "GET" && url.pathname === "/ping") {
        return json({
          ok: true,
          service: "J.A.R.V.I.S.",
          message: "Интерфейс и Worker работают.",
          time: new Date().toISOString()
        });
      }


      // --------------------------------------------------------
      // HEALTH
      // --------------------------------------------------------

      if (request.method === "GET" && url.pathname === "/health") {

        const checks = {
          worker: true,
          database: false,
          ai: false
        };

        let databaseError = null;
        let aiError = null;

        // Проверяем D1
        try {
          await env.DB
            .prepare("SELECT 1 AS ok")
            .first();

          checks.database = true;
        } catch (error) {
          databaseError = error?.message || String(error);
        }

        // Проверяем Workers AI
        try {
          const result = await env.AI.run(MODEL, {
            messages: [
              {
                role: "user",
                content: "Ответь одним словом: готов"
              }
            ],
            max_tokens: 10
          });

          const answer = extractAIText(result);

          if (answer) {
            checks.ai = true;
          } else {
            aiError = "AI вернул ответ без текста.";
          }

        } catch (error) {
          aiError = error?.message || String(error);
        }

        return json({
          ok: checks.worker && checks.database && checks.ai,
          checks,
          databaseError,
          aiError,
          model: MODEL,
          time: new Date().toISOString()
        });
      }


      // --------------------------------------------------------
      // CHAT
      // --------------------------------------------------------

      if (request.method === "POST" && url.pathname === "/chat") {

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "Неверный JSON-запрос."
          }, 400);
        }

        const message = String(body?.message || "").trim();

        if (!message) {
          return json({
            ok: false,
            error: "Сообщение пустое."
          }, 400);
        }

        try {

          // ====================================================
          // КОМАНДЫ ПАМЯТИ
          // ====================================================

          // Запомнить
          if (isRememberCommand(message)) {

            const fact = extractRememberFact(message);

            if (!fact) {
              return json({
                ok: true,
                answer: "Скажи, что именно мне нужно запомнить."
              });
            }

            const normalized = normalizeFact(fact);

            await saveFact(env, USER_ID, "preference", normalized);

            return json({
              ok: true,
              answer: "Запомнил. Буду иметь в виду."
            });
          }


          // Что я люблю / что ты знаешь
          if (isRecallCommand(message)) {

            const facts = await getFacts(env, USER_ID);

            if (!facts.length) {
              return json({
                ok: true,
                answer: "Пока у меня нет сохранённых фактов о тебе."
              });
            }

            const list = facts
              .map((item, index) => `${index + 1}. ${item.fact}`)
              .join("\n");

            return json({
              ok: true,
              answer: "Вот что я помню:\n" + list
            });
          }


          // Забудь
          if (isForgetCommand(message)) {

            const fact = extractForgetFact(message);

            if (!fact) {
              return json({
                ok: true,
                answer: "Уточни, что именно мне забыть."
              });
            }

            const deleted = await deleteFact(
              env,
              USER_ID,
              fact
            );

            return json({
              ok: true,
              answer: deleted
                ? "Хорошо. Я это забыл."
                : "Я не нашёл такого факта в памяти."
            });
          }


          // Очистить предпочтения
          if (isClearPreferencesCommand(message)) {

            await env.DB
              .prepare(
                "DELETE FROM facts WHERE user_id = ? AND category = 'preference'"
              )
              .bind(USER_ID)
              .run();

            return json({
              ok: true,
              answer: "Хорошо. Сохранённые предпочтения очищены."
            });
          }


          // Полностью очистить память
          if (isClearMemoryCommand(message)) {

            await env.DB
              .prepare(
                "DELETE FROM facts WHERE user_id = ?"
              )
              .bind(USER_ID)
              .run();

            await env.DB
              .prepare(
                "DELETE FROM memory WHERE user_id = ?"
              )
              .bind(USER_ID)
              .run();

            return json({
              ok: true,
              answer: "Память полностью очищена."
            });
          }


          // ====================================================
          // КОНТЕКСТ
          // ====================================================

          const facts = await getFacts(env, USER_ID);

          const history = await getHistory(
            env,
            USER_ID,
            MAX_HISTORY
          );


          // ====================================================
          // ПОИСК В ИНТЕРНЕТЕ
          // ====================================================

          let webResults = [];

          if (shouldSearch(message)) {
            try {
              webResults = await searchDuckDuckGo(
                message,
                MAX_SEARCH_RESULTS
              );
            } catch (error) {
              console.log(
                "Search error:",
                error?.message || String(error)
              );

              webResults = [];
            }
          }


          // ====================================================
          // СОЗДАЁМ СИСТЕМНЫЙ ПРОМПТ
          // ====================================================

          const systemPrompt = buildSystemPrompt(
            facts,
            history,
            webResults
          );


          // ====================================================
          // СОБИРАЕМ MESSAGES
          // ====================================================

          const messages = [
            {
              role: "system",
              content: systemPrompt
            }
          ];


          for (const item of history) {

            if (
              item.role === "user" ||
              item.role === "assistant"
            ) {
              messages.push({
                role: item.role,
                content: item.content
              });
            }
          }


          messages.push({
            role: "user",
            content: message
          });


          // ====================================================
          // СОХРАНЯЕМ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ
          // ====================================================

          await saveMemory(
            env,
            USER_ID,
            "user",
            message
          );


          // ====================================================
          // AI
          // ====================================================

          const answer = await askAI(
            env,
            messages
          );


          // ====================================================
          // СОХРАНЯЕМ ОТВЕТ
          // ====================================================

          await saveMemory(
            env,
            USER_ID,
            "assistant",
            answer
          );


          // ====================================================
          // ОТВЕТ
          // ====================================================

          return json({
            ok: true,
            answer,
            sources: webResults.map(item => ({
              title: item.title,
              url: item.url
            }))
          });

        } catch (error) {

          console.log(
            "CHAT ERROR:",
            error?.stack || error?.message || String(error)
          );

          return json({
            ok: false,
            error:
              error?.message ||
              "Внутренняя ошибка J.A.R.V.I.S."
          }, 500);
        }
      }


      // --------------------------------------------------------
      // 404
      // --------------------------------------------------------

      return json({
        ok: false,
        error: "Маршрут не найден."
      }, 404);


    } catch (error) {

      console.log(
        "WORKER ERROR:",
        error?.stack || error?.message || String(error)
      );

      return json({
        ok: false,
        error:
          error?.message ||
          "Критическая ошибка Worker."
      }, 500);
    }
  }
};


// ============================================================
// JSON
// ============================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store"
      }
    }
  );
}


// ============================================================
// AI
// ============================================================

async function askAI(env, messages) {

  const result = await env.AI.run(
    MODEL,
    {
      messages,

      max_tokens: 700,

      temperature: 0.65
    }
  );


  const text = extractAIText(result);

  if (!text) {

    console.log(
      "RAW AI RESULT:",
      JSON.stringify(result)
    );

    throw new Error(
      "Workers AI не вернул текстовый ответ."
    );
  }


  return cleanAIAnswer(text);
}


// ============================================================
// ИЗВЛЕЧЕНИЕ ОТВЕТА AI
// ============================================================

function extractAIText(result) {

  if (!result) {
    return "";
  }


  // Формат response
  if (
    typeof result.response === "string" &&
    result.response.trim()
  ) {
    return result.response.trim();
  }


  // Формат choices
  if (
    Array.isArray(result.choices) &&
    result.choices.length
  ) {

    const choice = result.choices[0];

    if (
      choice?.message?.content &&
      typeof choice.message.content === "string"
    ) {
      return choice.message.content.trim();
    }

    if (
      typeof choice?.text === "string" &&
      choice.text.trim()
    ) {
      return choice.text.trim();
    }
  }


  // Формат text
  if (
    typeof result.text === "string" &&
    result.text.trim()
  ) {
    return result.text.trim();
  }


  return "";
}


// ============================================================
// ОЧИСТКА AI ОТВЕТА
// ============================================================

function cleanAIAnswer(text) {

  let answer = String(text).trim();

  answer = answer
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\r/g, "")
    .trim();


  return answer;
}


// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(
  facts,
  history,
  webResults
) {

  const factsText = facts.length
    ? facts
        .map(item => `- ${item.fact}`)
        .join("\n")
    : "Нет сохранённых фактов.";


  const webText = webResults.length
    ? webResults
        .map(
          (item, index) =>
            `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`
        )
        .join("\n\n")
    : "Интернет-поиск не выполнялся.";


  return `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент.

Твоя задача — разговаривать с человеком естественно, грамотно и по-человечески.

ОСНОВНЫЕ ПРАВИЛА:

1. Отвечай на русском языке, если человек не попросил другой язык.

2. Не говори о человеке как о "пользователе".
   Обращайся естественно: "ты", "тебе", "твоё".

3. Не начинай каждый ответ словами:
   "Конечно",
   "Разумеется",
   "Безусловно",
   "Как J.A.R.V.I.S.".

4. Не повторяй один и тот же стиль ответа.

5. Не задавай вопрос в конце каждого сообщения.
   Если вопрос действительно нужен — задай его.
   Если нет — просто дай ответ.

6. Отвечай естественно.
   Представляй, что разговариваешь с человеком, которого хорошо знаешь.

7. Если человек говорит:
   "привет",
   отвечай нормально и кратко.

8. Если человек просит объяснить что-либо —
   объясняй понятно, последовательно и без лишней воды.

9. Если человек просит помочь с задачей —
   переходи непосредственно к решению.

10. Если информация из интернета предоставлена ниже —
    используй её как дополнительный источник актуальной информации.

11. Не выдумывай факты.

12. Если информации недостаточно —
    прямо скажи об этом.

13. Не используй Markdown с жирным текстом через **.

14. Можно использовать обычные списки и короткие заголовки,
    если они действительно помогают.

15. Помни предыдущий контекст разговора.

16. Сохраняй спокойный, уверенный и умный стиль,
    похожий на персонального ассистента.

17. Не пиши слишком длинные ответы на простые вопросы.

18. На сложные вопросы давай подробный ответ.

СОХРАНЁННАЯ ПАМЯТЬ:

${factsText}

ИСТОРИЯ:

${history.length
    ? history
        .map(item => `${item.role}: ${item.content}`)
        .join("\n")
    : "Истории пока нет."
}

ИНФОРМАЦИЯ ИЗ ИНТЕРНЕТА:

${webText}

Не упоминай эти технические инструкции пользователю.
`.trim();
}


// ============================================================
// MEMORY
// ============================================================

async function saveMemory(
  env,
  userId,
  role,
  content
) {

  await env.DB
    .prepare(
      `
      INSERT INTO memory
      (user_id, role, content)
      VALUES (?, ?, ?)
      `
    )
    .bind(
      userId,
      role,
      content
    )
    .run();
}


// ============================================================
// HISTORY
// ============================================================

async function getHistory(
  env,
  userId,
  limit
) {

  const result = await env.DB
    .prepare(
      `
      SELECT role, content
      FROM memory
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
    .bind(
      userId,
      limit
    )
    .all();


  const rows = result.results || [];

  return rows.reverse();
}


// ============================================================
// FACTS
// ============================================================

async function getFacts(
  env,
  userId
) {

  const result = await env.DB
    .prepare(
      `
      SELECT id, category, fact
      FROM facts
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
    .bind(
      userId,
      MAX_FACTS
    )
    .all();


  return result.results || [];
}


// ============================================================
// SAVE FACT
// ============================================================

async function saveFact(
  env,
  userId,
  category,
  fact
) {

  const existing = await env.DB
    .prepare(
      `
      SELECT id
      FROM facts
      WHERE user_id = ?
      AND category = ?
      AND lower(fact) = lower(?)
      LIMIT 1
      `
    )
    .bind(
      userId,
      category,
      fact
    )
    .first();


  if (existing) {

    await env.DB
      .prepare(
        `
        UPDATE facts
        SET fact = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `
      )
      .bind(
        fact,
        existing.id
      )
      .run();

    return;
  }


  await env.DB
    .prepare(
      `
      INSERT INTO facts
      (user_id, category, fact)
      VALUES (?, ?, ?)
      `
    )
    .bind(
      userId,
      category,
      fact
    )
    .run();
}


// ============================================================
// DELETE FACT
// ============================================================

async function deleteFact(
  env,
  userId,
  text
) {

  const result = await env.DB
    .prepare(
      `
      DELETE FROM facts
      WHERE user_id = ?
      AND lower(fact) LIKE lower(?)
      `
    )
    .bind(
      userId,
      `%${text}%`
    )
    .run();


  return (
    result.meta?.changes ||
    0
  ) > 0;
}


// ============================================================
// НОРМАЛИЗАЦИЯ ФАКТА
// ============================================================

function normalizeFact(text) {

  let fact = String(text)
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();


  // Я люблю чай
  fact = fact.replace(
    /^я\s+люблю\s+/i,
    "Ты любишь "
  );


  // Я предпочитаю чай
  fact = fact.replace(
    /^я\s+предпочитаю\s+/i,
    "Ты предпочитаешь "
  );


  // Я не люблю чай
  fact = fact.replace(
    /^я\s+не\s+люблю\s+/i,
    "Ты не любишь "
  );


  // Мне нравится чай
  fact = fact.replace(
    /^мне\s+нравится\s+/i,
    "Тебе нравится "
  );


  // Мне не нравится чай
  fact = fact.replace(
    /^мне\s+не\s+нравится\s+/i,
    "Тебе не нравится "
  );


  // Я хочу
  fact = fact.replace(
    /^я\s+хочу\s+/i,
    "Ты хочешь "
  );


  // Я предпочитаю
  fact = fact.replace(
    /^я\s+выбираю\s+/i,
    "Ты выбираешь "
  );


  // Если ничего не преобразовалось
  if (/^я\s+/i.test(fact)) {
    fact = fact.replace(
      /^я\s+/i,
      "Ты "
    );
  }


  return fact;
}


// ============================================================
// MEMORY COMMANDS
// ============================================================

function isRememberCommand(message) {

  return /^(джарвис[,\s]*)?(запомни|запиши|сохрани|учти)\b/i
    .test(message.trim());
}


function extractRememberFact(message) {

  return message
    .trim()
    .replace(
      /^(джарвис[,\s]*)?(запомни|запиши|сохрани|учти)\s*/i,
      ""
    )
    .trim();
}


function isRecallCommand(message) {

  return (
    /что я люблю/i.test(message) ||
    /что ты знаешь обо мне/i.test(message) ||
    /что ты обо мне помнишь/i.test(message) ||
    /что ты помнишь/i.test(message) ||
    /что у тебя в памяти/i.test(message) ||
    /покажи память/i.test(message)
  );
}


function isForgetCommand(message) {

  return /^(джарвис[,\s]*)?(забудь|удали из памяти)\b/i
    .test(message.trim());
}


function extractForgetFact(message) {

  return message
    .trim()
    .replace(
      /^(джарвис[,\s]*)?(забудь|удали из памяти)\s*/i,
      ""
    )
    .trim();
}


function isClearPreferencesCommand(message) {

  return (
    /очисти предпочтения/i.test(message) ||
    /удали все предпочтения/i.test(message)
  );
}


function isClearMemoryCommand(message) {

  return (
    /очисти всю память/i.test(message) ||
    /забудь всё/i.test(message) ||
    /удали всю память/i.test(message)
  );
}


// ============================================================
// ПОИСК
// ============================================================

function shouldSearch(message) {

  const text = message.toLowerCase();


  const triggers = [
    "сегодня",
    "сейчас",
    "последние новости",
    "новости",
    "актуальный",
    "актуальная",
    "актуальные",
    "текущий",
    "текущая",
    "текущие",
    "2026",
    "цена",
    "стоимость",
    "курс",
    "погода",
    "расписание",
    "найди в интернете",
    "поищи в интернете",
    "найди",
    "поищи"
  ];


  return triggers.some(
    trigger => text.includes(trigger)
  );
}


// ============================================================
// DUCKDUCKGO
// ============================================================

async function searchDuckDuckGo(
  query,
  limit = 5
) {

  const searchUrl =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);


  const response = await fetch(
    searchUrl,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 JARVIS/1.0"
      }
    }
  );


  if (!response.ok) {
    throw new Error(
      `DuckDuckGo HTTP ${response.status}`
    );
  }


  const html = await response.text();


  const results = [];


  const blocks =
    html.split(
      /result__body/
    );


  for (
    let i = 1;
    i < blocks.length &&
    results.length < limit;
    i++
  ) {

    const block = blocks[i];


    const linkMatch =
      block.match(
        /class="result__a"[^>]*href="([^"]+)"/
      );


    if (!linkMatch) {
      continue;
    }


    const url =
      decodeHtml(
        linkMatch[1]
      );


    const titleMatch =
      block.match(
        /class="result__a"[^>]*>(.*?)<\/a>/
      );


    const snippetMatch =
      block.match(
        /class="result__snippet"[^>]*>(.*?)<\/a?>/
      );


    const title =
      stripHtml(
        titleMatch
          ? titleMatch[1]
          : "Результат"
      );


    const snippet =
      stripHtml(
        snippetMatch
          ? snippetMatch[1]
          : ""
      );


    if (!url) {
      continue;
    }


    results.push({
      title,
      url,
      snippet
    });
  }


  return results;
}


// ============================================================
// HTML HELPERS
// ============================================================

function stripHtml(text) {

  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}


function decodeHtml(text) {

  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}


// ============================================================
// HTML ИНТЕРФЕЙС
// ============================================================

function getHTML() {

  return `<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
>

<meta
  name="theme-color"
  content="#080b12"
>

<title>J.A.R.V.I.S.</title>


<style>

* {
  box-sizing: border-box;
}


html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}


body {

  background:
    radial-gradient(
      circle at top,
      #182235 0%,
      #0b0f17 45%,
      #05070b 100%
    );

  color: #ffffff;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  overflow: hidden;
}


.app {

  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
}


.header {

  flex-shrink: 0;

  padding:
    calc(env(safe-area-inset-top) + 18px)
    18px
    14px;

  text-align: center;

  border-bottom:
    1px solid rgba(255,255,255,.08);

  background:
    rgba(5,8,14,.75);
}


.logo {

  font-size: 22px;
  font-weight: 700;
  letter-spacing: 4px;

  color: #dce8ff;
}


.status {

  margin-top: 5px;

  font-size: 12px;

  color: #7f91ad;
}


.messages {

  flex: 1;

  overflow-y: auto;

  padding: 18px;

  -webkit-overflow-scrolling: touch;
}


.message {

  max-width: 88%;

  margin-bottom: 14px;

  padding: 12px 15px;

  border-radius: 17px;

  white-space: pre-wrap;

  word-break: break-word;

  line-height: 1.45;

  font-size: 16px;
}


.user {

  margin-left: auto;

  background:
    #24324a;

  border-bottom-right-radius: 5px;
}


.assistant {

  margin-right: auto;

  background:
    rgba(255,255,255,.08);

  border:
    1px solid rgba(255,255,255,.06);

  border-bottom-left-radius: 5px;
}


.error {

  margin-right: auto;

  background:
    rgba(130,30,40,.4);

  border:
    1px solid rgba(255,100,110,.2);
}


.sources {

  margin-top: 10px;

  font-size: 12px;
}


.sources a {

  color: #8fb7ff;

  display: block;

  margin-top: 5px;

  text-decoration: none;
}


.bottom {

  flex-shrink: 0;

  padding:
    10px
    12px
    calc(env(safe-area-inset-bottom) + 12px);

  background:
    rgba(5,8,14,.92);

  border-top:
    1px solid rgba(255,255,255,.08);
}


form {

  display: flex;

  gap: 8px;

  align-items: flex-end;
}


textarea {

  flex: 1;

  resize: none;

  min-height: 46px;

  max-height: 130px;

  padding:
    12px
    14px;

  border: 0;

  outline: none;

  border-radius: 16px;

  background:
    #171e2b;

  color: #ffffff;

  font-size: 16px;

  font-family: inherit;
}


textarea::placeholder {

  color: #68758a;
}


button {

  width: 46px;
  height: 46px;

  flex-shrink: 0;

  border: 0;

  border-radius: 50%;

  background:
    #dce8ff;

  color: #10141c;

  font-size: 22px;

  font-weight: 700;

  cursor: pointer;

  display: flex;

  align-items: center;

  justify-content: center;
}


button:disabled {

  opacity: .5;

  cursor: default;
}


.debug {

  position: fixed;

  top: 8px;

  right: 8px;

  z-index: 100;

  padding: 5px 8px;

  border-radius: 7px;

  font-size: 10px;

  color: #8ca2c0;

  background: rgba(0,0,0,.35);
}

</style>

</head>


<body>


<div class="app">


  <div class="header">

    <div class="logo">
      J.A.R.V.I.S.
    </div>

    <div
      class="status"
      id="status"
    >
      На связи
    </div>

  </div>


  <main
    class="messages"
    id="messages"
  >

    <div class="message assistant">
      Привет. Я на связи.
    </div>

  </main>


  <div class="bottom">

    <form id="chatForm">

      <textarea
        id="input"
        placeholder="Напиши сообщение..."
        autocomplete="off"
        rows="1"
      ></textarea>


      <button
        id="send"
        type="submit"
        aria-label="Отправить"
      >
        ↑
      </button>

    </form>

  </div>

</div>


<div
  class="debug"
  id="debug"
>
  JARVIS
</div>


<script>

(function () {

  "use strict";


  // ==========================================================
  // ЭЛЕМЕНТЫ
  // ==========================================================

  const form =
    document.getElementById("chatForm");

  const input =
    document.getElementById("input");

  const send =
    document.getElementById("send");

  const messages =
    document.getElementById("messages");

  const status =
    document.getElementById("status");

  const debug =
    document.getElementById("debug");


  // ==========================================================
  // ПРОВЕРКА ЗАГРУЗКИ JS
  // ==========================================================

  debug.textContent = "✓ READY";


  // ==========================================================
  // ДОБАВЛЕНИЕ СООБЩЕНИЯ
  // ==========================================================

  function addMessage(
    text,
    type,
    sources
  ) {

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "message " + type;

    wrapper.textContent =
      text;


    if (
      Array.isArray(sources) &&
      sources.length
    ) {

      const sourceBox =
        document.createElement("div");

      sourceBox.className =
        "sources";


      sources.forEach(function (source) {

        const link =
          document.createElement("a");

        link.href =
          source.url;

        link.target =
          "_blank";

        link.rel =
          "noopener noreferrer";

        link.textContent =
          "↗ " + source.title;


        sourceBox.appendChild(link);

      });


      wrapper.appendChild(
        sourceBox
      );
    }


    messages.appendChild(
      wrapper
    );


    messages.scrollTop =
      messages.scrollHeight;
  }


  // ==========================================================
  // ОТПРАВКА
  // ==========================================================

  async function sendMessage() {

    const message =
      input.value.trim();


    if (!message) {
      return;
    }


    // Очень важный тест:
    // если появляется это сообщение,
    // JavaScript и кнопка работают.

    debug.textContent =
      "✓ CLICK";


    addMessage(
      message,
      "user"
    );


    input.value = "";

    input.style.height =
      "46px";


    send.disabled =
      true;

    input.disabled =
      true;


    status.textContent =
      "Думаю…";


    try {

      const endpoint =
        new URL(
          "/chat",
          window.location.origin
        ).toString();


      debug.textContent =
        "✓ FETCH";


      const response =
        await fetch(
          endpoint,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Accept":
                "application/json"
            },

            cache: "no-store",

            body: JSON.stringify({
              message: message
            })
          }
        );


      const raw =
        await response.text();


      let data;


      try {

        data =
          JSON.parse(raw);

      } catch {

        throw new Error(
          "Worker вернул не JSON. HTTP " +
          response.status +
          ". Ответ: " +
          raw.slice(0, 300)
        );
      }


      if (!response.ok) {

        throw new Error(
          data.error ||
          "HTTP ошибка " +
          response.status
        );
      }


      if (!data.ok) {

        throw new Error(
          data.error ||
          "J.A.R.V.I.S. не смог обработать запрос."
        );
      }


      addMessage(
        data.answer ||
        "Я получил запрос, но ответ оказался пустым.",
        "assistant",
        data.sources || []
      );


      debug.textContent =
        "✓ OK";

      status.textContent =
        "На связи";


    } catch (error) {

      console.error(
        "JARVIS ERROR:",
        error
      );


      addMessage(
        "Ошибка: " +
        (error.message ||
        "Не удалось отправить сообщение."),
        "error"
      );


      debug.textContent =
        "✕ ERROR";

      status.textContent =
        "Ошибка соединения";

    } finally {

      send.disabled =
        false;

      input.disabled =
        false;

      input.focus();
    }
  }


  // ==========================================================
  // FORM
  // ==========================================================

  form.addEventListener(
    "submit",
    function (event) {

      event.preventDefault();

      sendMessage();

    }
  );


  // ==========================================================
  // ENTER
  // ==========================================================

  input.addEventListener(
    "keydown",
    function (event) {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        form.requestSubmit();
      }
    }
  );


  // ==========================================================
  // АВТОВЫСОТА TEXTAREA
  // ==========================================================

  input.addEventListener(
    "input",
    function () {

      input.style.height =
        "46px";

      input.style.height =
        Math.min(
          input.scrollHeight,
          130
        ) + "px";
    }
  );


})();

</script>


</body>

</html>`;
}
