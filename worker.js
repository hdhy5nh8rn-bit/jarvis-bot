const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

/* =========================
   J.A.R.V.I.S. — Worker 4.1
   ========================= */

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // Главная страница
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(HTML_PAGE, {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      // Чат
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


/* =========================
   ОСНОВНОЙ ЧАТ
   ========================= */

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

  // Определяем команду памяти
  const memoryAction = detectMemoryAction(message);

  let answer = "";
  let sources = [];

  /* =========================
     КОМАНДЫ ПАМЯТИ
     ========================= */

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

  /* =========================
     ОБЫЧНЫЙ ДИАЛОГ
     ========================= */

  else {
    // Загружаем память
    const facts = await getFacts(env);
    const history = await getHistory(env, 20);

    // Решаем, нужен ли интернет
    const needSearch = shouldSearchWeb(message);

    if (needSearch) {
      sources = await searchWeb(message);
    }

    answer = await askAI(
      env,
      message,
      facts,
      history,
      sources
    );
  }

  // Сохраняем диалог
  await saveMessage(env, "user", message);
  await saveMessage(env, "assistant", answer);

  return json({
    answer,
    sources
  });
}


/* =========================
   AI
   ========================= */

async function askAI(env, message, facts, history, sources) {

  const memoryText =
    facts.length > 0
      ? facts.map(f => `- ${naturalizeFact(f.fact)}`).join("\n")
      : "Пока ничего важного о тебе не сохранено.";

  const historyText =
    history.length > 0
      ? history.map(m => `${m.role}: ${m.content}`).join("\n")
      : "Истории диалога пока нет.";

  const webText =
    sources.length > 0
      ? sources.map((s, i) =>
          `${i + 1}. ${s.title}\n${s.snippet}\nИсточник: ${s.url}`
        ).join("\n\n")
      : "Поиск в интернете не выполнялся или результаты не найдены.";

  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

Твоя задача:
- быть умным и естественным собеседником;
- помогать думать, планировать, учиться и работать;
- отвечать кратко, когда вопрос простой;
- давать подробное объяснение, когда оно действительно необходимо;
- учитывать сохранённую информацию о Егоре;
- не говорить о базе данных, SQL, D1, Workers, API или внутреннем устройстве системы;
- никогда не называть Егора "пользователем";
- обращаться к нему естественно: "ты", "тебе", "твой";
- не выдумывать факты;
- если информация из интернета нужна, использовать предоставленные результаты поиска;
- если результаты поиска отсутствуют, честно сказать, что свежая информация сейчас недоступна;
- не утверждать, что что-либо сохранено в памяти, если это не было реально сохранено;
- не использовать Markdown с двойными звёздочками.

Стиль:
спокойный, уверенный, грамотный, немного технологичный, как персональный ассистент из научно-фантастического фильма, но без чрезмерного пафоса.

Сохранённая информация о Егоре:
${memoryText}

Последняя история разговора:
${historyText}

Результаты поиска в интернете:
${webText}
`;

  const prompt = `${systemPrompt}

Сообщение Егора:
${message}

Ответь непосредственно Егору.
`;

  const result = await env.AI.run(MODEL, {
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
    temperature: 0.4,
    max_tokens: 1200
  });

  let answer =
    result?.response ||
    result?.result?.response ||
    result?.choices?.[0]?.message?.content ||
    result?.result?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("Workers AI не вернул текст ответа");
  }

  return cleanAnswer(answer);
}


/* =========================
   ПАМЯТЬ — ОПРЕДЕЛЕНИЕ
   ========================= */

function detectMemoryAction(text) {
  const t = text.toLowerCase().trim();

  // Очистить всю память
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

  // Очистить предпочтения
  if (
    /удали все мои предпочтения/.test(t) ||
    /забудь все мои предпочтения/.test(t) ||
    /очисти мои предпочтения/.test(t)
  ) {
    return {
      type: "clear_preferences"
    };
  }

  // Показать память
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

  // Забыть конкретную информацию
  if (
    /забудь/.test(t) ||
    /удали из памяти/.test(t) ||
    /не помни/.test(t)
  ) {
    return {
      type: "forget"
    };
  }

  // Сохранить информацию
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


/* =========================
   СОХРАНЕНИЕ ФАКТА
   ========================= */

async function saveFact(env, message) {

  let fact = message
    .replace(/^.*?(запомни|сохрани|не забывай|держи в памяти)\s*/i, "")
    .trim();

  fact = fact.replace(/^,?\s*(что|чтобы)\s*/i, "").trim();

  if (!fact) {
    return "Конечно. Скажи, что именно мне нужно запомнить.";
  }

  fact = normalizeFact(fact);

  const category = detectCategory(fact);

  // Получаем существующие факты
  const existing = await env.DB.prepare(
    `
    SELECT id, fact
    FROM facts
    WHERE user_id = ?
    ORDER BY id DESC
    `
  )
    .bind(USER_ID)
    .all();

  const rows = existing.results || [];

  // Проверяем дубликат
  const normalizedNew = normalizeForCompare(fact);

  const duplicate = rows.find(row =>
    normalizeForCompare(row.fact) === normalizedNew
  );

  if (duplicate) {
    return `Да, я это уже помню: ${naturalizeFact(duplicate.fact)}`;
  }

  // Пытаемся найти близкий факт в той же категории
  const related = rows.find(row => {
    if (detectCategory(row.fact) !== category) return false;

    const oldWords = normalizeForCompare(row.fact)
      .split(" ")
      .filter(w => w.length > 3);

    const newWords = normalizedNew
      .split(" ")
      .filter(w => w.length > 3);

    const common = newWords.filter(w => oldWords.includes(w));

    return common.length >= 2;
  });

  if (related) {
    await env.DB.prepare(
      `
      UPDATE facts
      SET fact = ?, category = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      `
    )
      .bind(
        fact,
        category,
        related.id,
        USER_ID
      )
      .run();

    return `Запомнил. Теперь я буду учитывать: ${naturalizeFact(fact)}`;
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

  return `Запомнил. ${naturalizeFact(fact)}`;
}


/* =========================
   НОРМАЛИЗАЦИЯ ФАКТА
   ========================= */

function normalizeFact(text) {

  let result = text.trim();

  // Убираем лишнюю пунктуацию
  result = result.replace(/\s+/g, " ");
  result = result.replace(/[.!?]+$/g, "");

  // Приводим некоторые варианты к естественной форме
  result = result.replace(/^я\s+я\s+/i, "я ");

  return result;
}


/* =========================
   ЕСТЕСТВЕННАЯ ФОРМА
   ========================= */

function naturalizeFact(fact) {

  let text = String(fact || "").trim();

  text = text.replace(/\*\*/g, "");

  if (/^я\s+/i.test(text)) {
    text = text.replace(/^я\s+/i, "Ты ");
  }

  else if (/^мне\s+/i.test(text)) {
    text = text.replace(/^мне\s+/i, "Тебе ");
  }

  else {
    text = "Ты " + text;
  }

  text = text.charAt(0).toUpperCase() + text.slice(1);

  if (!/[.!?]$/.test(text)) {
    text += ".";
  }

  return text;
}


/* =========================
   КАТЕГОРИЯ
   ========================= */

function detectCategory(text) {

  const t = text.toLowerCase();

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
    /работаю|работа|проект|задача|бизнес|клиент/
      .test(t)
  ) {
    return "work";
  }

  if (
    /проект|разрабатываю|создаю|делаю|бот|jarvis|джарвис/
      .test(t)
  ) {
    return "project";
  }

  return "general";
}


/* =========================
   ЗАБЫТЬ ФАКТ
   ========================= */

async function forgetFact(env, message) {

  let query = message
    .replace(/^.*?(забудь|удали из памяти|не помни)\s*/i, "")
    .trim();

  query = query.replace(/^,?\s*(что|про|обо мне)\s*/i, "").trim();

  if (!query) {
    return "Скажи, какую именно информацию мне забыть.";
  }

  const rows = await getFacts(env);

  const q = normalizeForCompare(query);

  const matches = rows.filter(row => {

    const fact = normalizeForCompare(row.fact);

    return (
      fact.includes(q) ||
      q.includes(fact) ||
      similarWords(fact, q)
    );
  });

  if (matches.length === 0) {
    return "Я не нашёл такой информации в памяти.";
  }

  for (const row of matches) {
    await env.DB.prepare(
      `
      DELETE FROM facts
      WHERE id = ? AND user_id = ?
      `
    )
      .bind(row.id, USER_ID)
      .run();
  }

  if (matches.length === 1) {
    return `Хорошо. Я забыл: ${naturalizeFact(matches[0].fact)}`;
  }

  return `Хорошо. Я удалил ${matches.length} связанных записей из памяти.`;
}


/* =========================
   ПОКАЗАТЬ ПАМЯТЬ
   ========================= */

async function recallMemory(env) {

  const facts = await getFacts(env);

  if (facts.length === 0) {
    return "Пока я ничего важного о тебе не запомнил.";
  }

  const lines = facts.map(
    (f, index) =>
      `${index + 1}. ${naturalizeFact(f.fact)}`
  );

  return `Вот что я помню о тебе:\n\n${lines.join("\n")}`;
}


/* =========================
   ОЧИСТКА ПРЕДПОЧТЕНИЙ
   ========================= */

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


/* =========================
   ОЧИСТКА ВСЕЙ ПАМЯТИ
   ========================= */

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


/* =========================
   ПОЛУЧЕНИЕ ФАКТОВ
   ========================= */

async function getFacts(env) {

  const result = await env.DB.prepare(
    `
    SELECT id, category, fact, created_at, updated_at
    FROM facts
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 100
    `
  )
    .bind(USER_ID)
    .all();

  return result.results || [];
}


/* =========================
   ИСТОРИЯ
   ========================= */

async function getHistory(env, limit = 20) {

  const result = await env.DB.prepare(
    `
    SELECT role, content, created_at
    FROM memory
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `
  )
    .bind(USER_ID, limit)
    .all();

  const rows = result.results || [];

  return rows.reverse();
}


/* =========================
   СОХРАНЕНИЕ СООБЩЕНИЯ
   ========================= */

async function saveMessage(env, role, content) {

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


/* =========================
   ПОИСК В ИНТЕРНЕТЕ
   ========================= */

function shouldSearchWeb(message) {

  const t = message.toLowerCase();

  const searchWords = [
    "сейчас",
    "сегодня",
    "сегодняшний",
    "вчера",
    "завтра",
    "последний",
    "последние",
    "новости",
    "новое",
    "актуаль",
    "свеж",
    "сколько стоит",
    "цена",
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

  return searchWords.some(word => t.includes(word));
}


/* =========================
   DUCKDUCKGO
   ========================= */

async function searchWeb(query) {

  try {

    const searchUrl =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JARVIS/4.1)"
      }
    });

    if (!response.ok) {
      console.error(
        "DuckDuckGo HTTP error:",
        response.status
      );

      return [];
    }

    const html = await response.text();

    const results = [];

    /*
      Основной формат DuckDuckGo:
      <a rel="nofollow" class="result__a" href="...">
    */

    const resultBlocks =
      html.match(
        /<div[^>]*class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi
      ) || [];

    for (const block of resultBlocks) {

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

      if (!titleMatch || !linkMatch) {
        continue;
      }

      const title =
        stripHtml(titleMatch[1]);

      const rawUrl =
        decodeHtmlEntities(linkMatch[1]);

      const url =
        extractRealUrl(rawUrl);

      const snippet =
        snippetMatch
          ? stripHtml(snippetMatch[1])
          : "";

      if (!url || !title) {
        continue;
      }

      results.push({
        title,
        url,
        snippet
      });

      if (results.length >= 5) {
        break;
      }
    }

    return results;

  } catch (error) {

    console.error(
      "Web search error:",
      error
    );

    return [];
  }
}


/* =========================
   ССЫЛКА DDG
   ========================= */

function extractRealUrl(url) {

  try {

    if (
      url.startsWith("https://duckduckgo.com/l/?") ||
      url.startsWith("http://duckduckgo.com/l/?")
    ) {

      const parsed = new URL(url);

      const target =
        parsed.searchParams.get("uddg");

      if (target) {
        return decodeURIComponent(target);
      }
    }

    return url;

  } catch {
    return url;
  }
}


/* =========================
   HTML → TEXT
   ========================= */

function stripHtml(text) {

  return decodeHtmlEntities(
    String(text)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}


/* =========================
   HTML ENTITIES
   ========================= */

function decodeHtmlEntities(text) {

  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}


/* =========================
   СРАВНЕНИЕ ФАКТОВ
   ========================= */

function normalizeForCompare(text) {

  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()[\]{}"'«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function similarWords(a, b) {

  const wordsA =
    normalizeForCompare(a)
      .split(" ")
      .filter(w => w.length > 3);

  const wordsB =
    normalizeForCompare(b)
      .split(" ")
      .filter(w => w.length > 3);

  if (!wordsA.length || !wordsB.length) {
    return false;
  }

  const common =
    wordsB.filter(word =>
      wordsA.includes(word)
    );

  return common.length >= Math.min(2, wordsB.length);
}


/* =========================
   ОЧИСТКА ОТ MARKDOWN
   ========================= */

function cleanAnswer(text) {

  return String(text)
    .replace(/\*\*/g, "")
    .replace(/^\s*assistant:\s*/i, "")
    .trim();
}


/* =========================
   JSON RESPONSE
   ========================= */

function json(data, status = 200) {

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


/* =========================
   WEB UI
   ========================= */

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
    <div class="title">J.A.R.V.I.S.</div>
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

    if (event.key === "Enter") {
      sendMessage();
    }

  }
);


function addMessage(
  text,
  type,
  sources = []
) {

  const message =
    document.createElement("div");

  message.className =
    "message " + type;

  message.textContent = text;

  if (
    type === "jarvis" &&
    sources &&
    sources.length
  ) {

    const sourceBox =
      document.createElement("div");

    sourceBox.className =
      "sources";

    sourceBox.innerHTML =
      "<div>Источники:</div>";

    sources.forEach(function(source) {

      const link =
        document.createElement("a");

      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      link.textContent =
        source.title;

      sourceBox.appendChild(
        document.createElement("br")
      );

      sourceBox.appendChild(link);

    });

    message.appendChild(
      sourceBox
    );
  }

  chat.appendChild(message);

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: "smooth"
  });
}


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

  try {

    const response =
      await fetch(
        new URL(
          "/chat",
          window.location.origin
        ),
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            message
          })
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "Сервер вернул не JSON. HTTP " +
        response.status +
        ": " +
        raw.slice(0, 300)
      );
    }

    if (!response.ok) {

      throw new Error(
        data.error ||
        data.details ||
        "HTTP " + response.status
      );

    }

    addMessage(
      data.answer ||
      "J.A.R.V.I.S. не получил ответа.",
      "jarvis",
      data.sources || []
    );

  } catch (error) {

    addMessage(
      "Ошибка: " +
      (error.message ||
        "не удалось связаться с J.A.R.V.I.S."),
      "jarvis error"
    );

    console.error(error);

  } finally {

    button.disabled = false;
    input.focus();

  }
}

</script>

</body>
</html>
`;
