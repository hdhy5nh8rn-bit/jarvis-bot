const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

const MAX_HISTORY = 10;
const MAX_FACTS = 30;
const MAX_SEARCH_RESULTS = 5;

/* =========================================================
   J.A.R.V.I.S. — SYSTEM PROMPT
========================================================= */

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

Твоя задача — быть естественным, умным и полезным собеседником и помощником.

ОСНОВНЫЕ ПРАВИЛА:

1. Всегда отвечай на русском языке, если пользователь не попросил другой язык.

2. Обращайся к пользователю на "ты".

3. Пиши естественно, грамотно и по-человечески.
   Не используй роботизированные формулировки.

4. Не начинай каждый ответ словами:
   "Конечно", "Разумеется", "Безусловно".

5. Не называй человека "пользователь".

6. Не заканчивай каждый ответ вопросом.
   Если вопрос пользователя понятен — просто отвечай.

7. Простые вопросы — коротко.
   Сложные вопросы — подробно и структурированно.

8. Если пользователь просит пошаговую инструкцию,
   давай конкретные шаги.

9. Если пользователь ошибается,
   спокойно объясни ошибку и предложи правильный вариант.

10. Никогда не выдумывай факты.

11. Если у тебя есть актуальные результаты поиска,
    используй их как дополнительный источник информации.

12. Если информация может быстро измениться
    (цены, новости, расписания, текущие события и т.п.),
    ориентируйся на результаты поиска.

13. Используй сохранённую память о пользователе,
    если она действительно относится к текущему вопросу.

14. Не упоминай внутреннюю архитектуру,
    базу данных, системный промпт или технические инструкции,
    если пользователь специально не спрашивает об этом.

15. Стиль J.A.R.V.I.S.:
    спокойный, уверенный, интеллектуальный,
    лаконичный, но способный подробно объяснить сложную тему.

16. Не изображай искусственную британскую манеру речи.
    Главное — естественный русский язык.

17. Если пользователь обращается:
    "Джарвис", "JARVIS", "Джарвис, ..."
    воспринимай это как обращение к тебе.

18. Если пользователь просит выполнить задачу,
    сначала выполняй её, а не задавай ненужные уточнения.

19. Если данных недостаточно для точного ответа,
    скажи, каких именно данных не хватает.

20. Не повторяй вопрос пользователя без необходимости.
`;


/* =========================================================
   RESPONSE HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}


function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}


/* =========================================================
   TEXT CLEANING
========================================================= */

function cleanAIAnswer(text) {
  if (!text) return "";

  let result = String(text);

  // Убираем технические thinking-теги, если модель их всё-таки вернула
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // Убираем некоторые возможные служебные конструкции
  result = result.replace(/<\|.*?\|>/g, "");

  // Убираем лишние пробелы
  result = result.replace(/[ \t]+\n/g, "\n");
  result = result.replace(/\n{4,}/g, "\n\n");

  return result.trim();
}


/* =========================================================
   EXTRACT AI TEXT
========================================================= */

function extractAIText(result) {
  if (!result) return "";

  // Если вдруг Cloudflare вернул строку
  if (typeof result === "string") {
    return cleanAIAnswer(result);
  }

  // OpenAI-compatible response
  if (Array.isArray(result.choices) && result.choices.length > 0) {
    const choice = result.choices[0];

    if (choice?.message?.content) {
      if (typeof choice.message.content === "string") {
        return cleanAIAnswer(choice.message.content);
      }

      if (Array.isArray(choice.message.content)) {
        return cleanAIAnswer(
          choice.message.content
            .map(x => {
              if (typeof x === "string") return x;
              return x?.text || x?.content || "";
            })
            .join("")
        );
      }
    }

    if (typeof choice?.text === "string") {
      return cleanAIAnswer(choice.text);
    }
  }

  // Другие возможные форматы
  const candidates = [
    result.response,
    result.text,
    result.content,
    result.output_text,
    result.message?.content,
    result.output?.text,
    result.output?.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return cleanAIAnswer(candidate);
    }

    if (Array.isArray(candidate)) {
      const text = candidate
        .map(x => {
          if (typeof x === "string") return x;
          return x?.text || x?.content || "";
        })
        .join("");

      if (text.trim()) {
        return cleanAIAnswer(text);
      }
    }
  }

  return "";
}


/* =========================================================
   MEMORY — CONVERSATION
========================================================= */

async function saveMessage(env, role, content) {
  await env.DB.prepare(`
    INSERT INTO memory (user_id, role, content)
    VALUES (?, ?, ?)
  `)
    .bind(USER_ID, role, content)
    .run();
}


async function getHistory(env) {
  const result = await env.DB.prepare(`
    SELECT role, content
    FROM memory
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `)
    .bind(USER_ID, MAX_HISTORY)
    .all();

  const rows = result.results || [];

  return rows
    .reverse()
    .map(row => ({
      role: row.role,
      content: row.content
    }));
}


/* =========================================================
   FACT MEMORY
========================================================= */

function normalizeFact(text) {
  let fact = String(text).trim();

  fact = fact
    .replace(/^запомни\s*/i, "")
    .replace(/^запиши\s*/i, "")
    .replace(/^сохрани\s*/i, "")
    .replace(/^учти\s*/i, "")
    .trim();

  if (!fact) return "";

  // Нормализация естественной речи
  fact = fact.replace(/^я люблю\s+/i, "Ты любишь ");
  fact = fact.replace(/^я предпочитаю\s+/i, "Ты предпочитаешь ");
  fact = fact.replace(/^я не люблю\s+/i, "Ты не любишь ");
  fact = fact.replace(/^мне нравится\s+/i, "Тебе нравится ");
  fact = fact.replace(/^мне не нравится\s+/i, "Тебе не нравится ");
  fact = fact.replace(/^я хочу\s+/i, "Ты хочешь ");
  fact = fact.replace(/^я выбираю\s+/i, "Ты выбираешь ");

  // Убираем markdown-жирный текст
  fact = fact.replace(/\*\*/g, "");

  return fact.trim();
}


async function saveFact(env, fact, category = "preference") {
  const normalized = normalizeFact(fact);

  if (!normalized) return;

  // Проверяем, нет ли уже такого факта
  const existing = await env.DB.prepare(`
    SELECT id
    FROM facts
    WHERE user_id = ?
      AND fact = ?
    LIMIT 1
  `)
    .bind(USER_ID, normalized)
    .first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE facts
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind(existing.id)
      .run();

    return;
  }

  await env.DB.prepare(`
    INSERT INTO facts (user_id, category, fact)
    VALUES (?, ?, ?)
  `)
    .bind(USER_ID, category, normalized)
    .run();
}


async function getFacts(env) {
  const result = await env.DB.prepare(`
    SELECT id, category, fact
    FROM facts
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `)
    .bind(USER_ID, MAX_FACTS)
    .all();

  return result.results || [];
}


async function deleteFact(env, text) {
  const search = String(text)
    .replace(/^забудь\s*/i, "")
    .replace(/^удали\s*/i, "")
    .replace(/^из памяти\s*/i, "")
    .trim();

  if (!search) return false;

  const result = await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
      AND fact LIKE ?
  `)
    .bind(USER_ID, `%${search}%`)
    .run();

  return Number(result.meta?.changes || 0) > 0;
}


async function clearFacts(env) {
  await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();
}


async function clearMemory(env) {
  await env.DB.prepare(`
    DELETE FROM memory
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();

  await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();
}


/* =========================================================
   MEMORY COMMAND DETECTION
========================================================= */

function isSaveMemoryCommand(text) {
  return /^(запомни|запиши|сохрани|учти)\b/i.test(text.trim());
}


function isRecallCommand(text) {
  return /^(что я люблю|что ты знаешь обо мне|что ты помнишь|покажи память|покажи что ты помнишь|какая у тебя память)/i
    .test(text.trim());
}


function isDeleteFactCommand(text) {
  return /^(забудь|удали из памяти)\b/i.test(text.trim());
}


function isClearFactsCommand(text) {
  return /^(очисти предпочтения|удали все предпочтения)/i
    .test(text.trim());
}


function isClearAllCommand(text) {
  return /^(очисти всю память|забудь всё|забудь все|удали всю память)/i
    .test(text.trim());
}


/* =========================================================
   DUCKDUCKGO SEARCH
========================================================= */

function shouldSearch(text) {
  const triggers = [
    "сегодня",
    "сейчас",
    "новости",
    "актуаль",
    "текущ",
    "2026",
    "цена",
    "стоимость",
    "курс",
    "погода",
    "расписание",
    "найди",
    "найти",
    "поищи",
    "посмотри",
    "сколько стоит",
    "последние",
    "свежие",
    "кто сейчас",
    "что сейчас"
  ];

  const lower = text.toLowerCase();

  return triggers.some(trigger => lower.includes(trigger));
}


function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}


function stripHtml(str) {
  return decodeHtml(
    String(str)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}


async function searchWeb(query) {
  try {
    const url =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
      }
    });

    if (!response.ok) {
      return [];
    }

    const htmlText = await response.text();

    const results = [];

    const regex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match = regex.exec(htmlText)) !== null &&
      results.length < MAX_SEARCH_RESULTS
    ) {
      const link = match[1];
      const title = stripHtml(match[2]);

      if (!title || !link) continue;

      let finalLink = link;

      try {
        const parsed = new URL(link);

        if (parsed.hostname.includes("duckduckgo.com")) {
          const uddg = parsed.searchParams.get("uddg");

          if (uddg) {
            finalLink = decodeURIComponent(uddg);
          }
        }
      } catch (_) {}

      results.push({
        title,
        url: finalLink
      });
    }

    return results;
  } catch (error) {
    console.log("SEARCH ERROR:", error);
    return [];
  }
}


/* =========================================================
   AI
========================================================= */

async function askAI(env, messages) {
  const result = await env.AI.run(
    MODEL,
    {
      messages,

      max_completion_tokens: 1024,

      temperature: 0.65,

      reasoning_effort: "low",

      chat_template_kwargs: {
        enable_thinking: false
      }
    }
  );

  // Логируем полный ответ для диагностики
  console.log(
    "AI RESULT:",
    JSON.stringify(result)
  );

  const answer = extractAIText(result);

  if (!answer) {
    throw new Error(
      "Workers AI вернул ответ без текстового содержимого."
    );
  }

  return answer;
}


/* =========================================================
   BUILD MEMORY CONTEXT
========================================================= */

async function buildMemoryContext(env) {
  const facts = await getFacts(env);

  if (!facts.length) {
    return "";
  }

  return `
СОХРАНЁННАЯ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:

${facts
  .map((fact, index) =>
    `${index + 1}. ${fact.fact}`
  )
  .join("\n")}

Используй эту информацию только тогда,
когда она действительно относится к разговору.
`;
}


/* =========================================================
   CHAT
========================================================= */

async function handleChat(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (_) {
    return json(
      {
        ok: false,
        error: "Некорректный JSON."
      },
      400
    );
  }

  const userMessage =
    String(body.message || "").trim();

  if (!userMessage) {
    return json(
      {
        ok: false,
        error: "Сообщение пустое."
      },
      400
    );
  }


  /* =========================
     CLEAR ALL MEMORY
  ========================= */

  if (isClearAllCommand(userMessage)) {
    await clearMemory(env);

    return json({
      ok: true,
      answer:
        "Готово. Я очистил всю сохранённую память о тебе."
    });
  }


  /* =========================
     CLEAR PREFERENCES
  ========================= */

  if (isClearFactsCommand(userMessage)) {
    await clearFacts(env);

    return json({
      ok: true,
      answer:
        "Готово. Сохранённые предпочтения удалены."
    });
  }


  /* =========================
     SAVE FACT
  ========================= */

  if (isSaveMemoryCommand(userMessage)) {
    const fact = normalizeFact(userMessage);

    if (!fact) {
      return json({
        ok: true,
        answer:
          "Хорошо. Скажи, что именно мне нужно запомнить."
      });
    }

    await saveFact(env, fact);

    return json({
      ok: true,
      answer:
        `Запомнил: ${fact}`
    });
  }


  /* =========================
     RECALL MEMORY
  ========================= */

  if (isRecallCommand(userMessage)) {
    const facts = await getFacts(env);

    if (!facts.length) {
      return json({
        ok: true,
        answer:
          "Пока в моей памяти ничего нет."
      });
    }

    const answer =
      "Вот что я помню о тебе:\n\n" +
      facts
        .map((fact, index) =>
          `${index + 1}. ${fact.fact}`
        )
        .join("\n");

    return json({
      ok: true,
      answer
    });
  }


  /* =========================
     DELETE FACT
  ========================= */

  if (isDeleteFactCommand(userMessage)) {
    const deleted =
      await deleteFact(env, userMessage);

    return json({
      ok: true,
      answer: deleted
        ? "Готово. Я удалил соответствующую информацию из памяти."
        : "Я не нашёл в памяти информацию, которую нужно удалить."
    });
  }


  /* =========================
     SAVE USER MESSAGE
  ========================= */

  await saveMessage(
    env,
    "user",
    userMessage
  );


  /* =========================
     HISTORY
  ========================= */

  const history =
    await getHistory(env);


  /* =========================
     MEMORY
  ========================= */

  const memoryContext =
    await buildMemoryContext(env);


  /* =========================
     WEB SEARCH
  ========================= */

  let searchResults = [];

  if (shouldSearch(userMessage)) {
    searchResults =
      await searchWeb(userMessage);
  }


  /* =========================
     SEARCH CONTEXT
  ========================= */

  let searchContext = "";

  if (searchResults.length) {
    searchContext = `
АКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА В ИНТЕРНЕТЕ:

${searchResults
  .map(
    (item, index) =>
      `${index + 1}. ${item.title}
URL: ${item.url}`
  )
  .join("\n\n")}

Используй эти результаты как дополнительный источник.
Не выдумывай сведения, которых нет в результатах.
`;
  }


  /* =========================
     AI MESSAGES
  ========================= */

  const messages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n\n" +
        memoryContext +
        "\n\n" +
        searchContext
    },

    ...history
  ];


  /* =========================
     AI RESPONSE
  ========================= */

  let answer;

  try {
    answer =
      await askAI(env, messages);
  } catch (error) {
    console.log(
      "AI ERROR:",
      error?.stack || error
    );

    return json(
      {
        ok: false,
        error:
          "Ошибка Workers AI: " +
          (error?.message || String(error))
      },
      500
    );
  }


  /* =========================
     SAVE ASSISTANT RESPONSE
  ========================= */

  await saveMessage(
    env,
    "assistant",
    answer
  );


  /* =========================
     RESPONSE
  ========================= */

  return json({
    ok: true,
    answer,
    sources: searchResults
  });
}


/* =========================================================
   HEALTH CHECK
========================================================= */

async function handleHealth(env) {
  let databaseOk = false;
  let aiOk = false;

  let databaseError = null;
  let aiError = null;

  let aiRaw = null;
  let aiAnswer = null;


  /* =========================
     DATABASE TEST
  ========================= */

  try {
    await env.DB.prepare(
      "SELECT 1 AS ok"
    ).first();

    databaseOk = true;
  } catch (error) {
    databaseError =
      error?.message || String(error);
  }


  /* =========================
     AI TEST
  ========================= */

  try {
    const result = await env.AI.run(
      MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              "Ты тестовый модуль J.A.R.V.I.S. Отвечай одним словом."
          },
          {
            role: "user",
            content:
              "Ответь одним словом: готов"
          }
        ],

        max_completion_tokens: 128,

        temperature: 0,

        reasoning_effort: "low",

        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    );

    aiRaw = result;

    aiAnswer =
      extractAIText(result);

    if (!aiAnswer) {
      throw new Error(
        "AI вернул ответ без текста."
      );
    }

    aiOk = true;
  } catch (error) {
    aiError =
      error?.message || String(error);
  }


  return json({
    ok:
      databaseOk &&
      aiOk,

    checks: {
      worker: true,
      database: databaseOk,
      ai: aiOk
    },

    databaseError,

    aiError,

    aiAnswer,

    aiRaw,

    model: MODEL,

    time:
      new Date().toISOString()
  });
}


/* =========================================================
   MAIN HTML
========================================================= */

function getHTML() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
/>

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;

  min-height: 100%;

  background:
    radial-gradient(
      circle at top,
      #18202c 0%,
      #080b10 45%,
      #030405 100%
    );

  color: #f2f5f8;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "Segoe UI",
    sans-serif;
}

body {
  min-height: 100vh;

  display: flex;
  justify-content: center;
}

.app {
  width: 100%;
  max-width: 720px;

  min-height: 100vh;

  display: flex;
  flex-direction: column;

  padding:
    env(safe-area-inset-top)
    14px
    env(safe-area-inset-bottom);
}

.header {
  padding: 20px 8px 14px;

  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
}

.status {
  font-size: 11px;
  color: #7df5b5;
  letter-spacing: 1px;
}

.chat {
  flex: 1;

  overflow-y: auto;

  padding:
    8px 2px 130px;
}

.message {
  max-width: 88%;

  margin: 10px 0;

  padding: 13px 15px;

  border-radius: 18px;

  line-height: 1.48;

  white-space: pre-wrap;

  word-break: break-word;
}

.assistant {
  margin-right: auto;

  background: rgba(255,255,255,0.08);

  border: 1px solid rgba(255,255,255,0.07);
}

.user {
  margin-left: auto;

  background: rgba(70,130,255,0.22);

  border: 1px solid rgba(100,160,255,0.18);
}

.sources {
  margin-top: 8px;

  font-size: 12px;
}

.sources a {
  display: block;

  margin: 6px 0;

  color: #7db7ff;

  text-decoration: none;
}

.bottom {
  position: fixed;

  left: 0;
  right: 0;
  bottom: 0;

  padding:
    10px
    max(10px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(10px, env(safe-area-inset-left));

  background:
    linear-gradient(
      to top,
      #030405 70%,
      transparent
    );
}

.composer {
  max-width: 720px;

  margin: auto;

  display: flex;

  gap: 8px;

  background: rgba(20,24,31,0.94);

  border:
    1px solid rgba(255,255,255,0.08);

  border-radius: 22px;

  padding: 8px;
}

textarea {
  flex: 1;

  min-height: 44px;
  max-height: 130px;

  resize: none;

  border: 0;
  outline: 0;

  background: transparent;

  color: white;

  font-size: 16px;

  padding: 10px;
}

button {
  width: 46px;
  height: 46px;

  border: 0;

  border-radius: 16px;

  background: #ffffff;

  color: #000000;

  font-size: 19px;

  font-weight: 700;
}

button:disabled {
  opacity: 0.45;
}

.debug {
  text-align: center;

  font-size: 9px;

  color: #555;

  margin-top: 4px;
}

</style>
</head>

<body>

<div class="app">

  <div class="header">

    <div class="brand">
      J.A.R.V.I.S.
    </div>

    <div
      id="status"
      class="status"
    >
      READY
    </div>

  </div>


  <div
    id="chat"
    class="chat"
  >

    <div class="message assistant">
      Привет. Я на связи.
    </div>

  </div>


  <div class="bottom">

    <form
      id="form"
      class="composer"
    >

      <textarea
        id="input"
        placeholder="Напиши Джарвису..."
        autocomplete="off"
        rows="1"
      ></textarea>

      <button
        id="send"
        type="submit"
      >
        ↑
      </button>

    </form>

    <div
      id="debug"
      class="debug"
    >
      READY
    </div>

  </div>

</div>


<script>

const form =
  document.getElementById("form");

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const chat =
  document.getElementById("chat");

const status =
  document.getElementById("status");

const debug =
  document.getElementById("debug");


function setStatus(value) {
  status.textContent = value;
  debug.textContent = value;
}


function addMessage(text, role) {

  const div =
    document.createElement("div");

  div.className =
    "message " + role;

  div.textContent = text;

  chat.appendChild(div);

  chat.scrollTop =
    chat.scrollHeight;

  return div;
}


function addSources(sources) {

  if (!sources || !sources.length) {
    return;
  }

  const box =
    document.createElement("div");

  box.className =
    "sources";

  sources.forEach(source => {

    const a =
      document.createElement("a");

    a.href =
      source.url;

    a.target =
      "_blank";

    a.rel =
      "noopener noreferrer";

    a.textContent =
      "↗ " + source.title;

    box.appendChild(a);

  });

  chat.appendChild(box);

  chat.scrollTop =
    chat.scrollHeight;
}


input.addEventListener(
  "input",
  () => {

    input.style.height = "auto";

    input.style.height =
      Math.min(
        input.scrollHeight,
        130
      ) + "px";

  }
);


input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      form.requestSubmit();

    }

  }
);


form.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const text =
      input.value.trim();

    if (!text) {
      return;
    }


    addMessage(
      text,
      "user"
    );


    input.value = "";

    input.style.height =
      "auto";

    send.disabled = true;

    setStatus("THINKING");


    try {

      setStatus("FETCH");


      const response =
        await fetch(
          "/chat",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            cache: "no-store",

            body: JSON.stringify({
              message: text
            })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "Ошибка сервера"
        );

      }


      if (!data.ok) {

        throw new Error(
          data.error ||
          "Неизвестная ошибка"
        );

      }


      addMessage(
        data.answer,
        "assistant"
      );


      addSources(
        data.sources
      );


      setStatus("READY");


    } catch (error) {

      console.error(error);

      addMessage(
        "Ошибка: " +
        error.message,
        "assistant"
      );

      setStatus("ERROR");

    } finally {

      send.disabled =
        false;

      input.focus();

    }

  }
);

</script>

</body>
</html>`;
}


/* =========================================================
   FETCH
========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);


    /* =========================
       HOME
    ========================= */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return html(
        getHTML()
      );
    }


    /* =========================
       PING
    ========================= */

    if (
      request.method === "GET" &&
      url.pathname === "/ping"
    ) {
      return json({
        ok: true,
        message: "J.A.R.V.I.S. online",
        time:
          new Date().toISOString()
      });
    }


    /* =========================
       HEALTH
    ========================= */

    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return handleHealth(env);
    }


    /* =========================
       CHAT
    ========================= */

    if (
      request.method === "POST" &&
      url.pathname === "/chat"
    ) {
      return handleChat(
        request,
        env
      );
    }


    /* =========================
       404
    ========================= */

    return json(
      {
        ok: false,
        error: "Not found"
      },
      404
    );

  }

};
