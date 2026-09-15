const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

const MAX_HISTORY = 12;
const MAX_FACTS = 30;
const MAX_SEARCH_RESULTS = 5;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================
      // WEB INTERFACE
      // =========================

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(HTML, {
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
          },
        });
      }

      // =========================
      // CHAT API
      // =========================

      if (request.method === "POST" && url.pathname === "/chat") {
        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "Некорректный JSON.",
          }, 400);
        }

        const message = String(body?.message || "").trim();

        if (!message) {
          return json({
            ok: false,
            error: "Сообщение пустое.",
          }, 400);
        }

        const result = await handleMessage(message, env);

        return json({
          ok: true,
          answer: result.answer,
          sources: result.sources || [],
        });
      }

      return new Response("Not Found", { status: 404 });

    } catch (error) {
      console.error("GLOBAL ERROR:", error);

      return json({
        ok: false,
        error: "Внутренняя ошибка J.A.R.V.I.S.",
        details: error?.message || String(error),
      }, 500);
    }
  },
};


// ============================================================
// MAIN MESSAGE HANDLER
// ============================================================

async function handleMessage(message, env) {

  // ----------------------------------------------------------
  // 1. MEMORY COMMANDS
  // ----------------------------------------------------------

  const saveFact = extractSaveFact(message);

  if (saveFact) {
    const fact = normalizeFact(saveFact);

    await saveFactToDB(env, fact);

    return {
      answer: "Запомнил. Буду иметь в виду.",
      sources: [],
    };
  }

  if (isClearAllMemory(message)) {
    await env.DB
      .prepare("DELETE FROM facts WHERE user_id = ?")
      .bind(USER_ID)
      .run();

    await env.DB
      .prepare("DELETE FROM memory WHERE user_id = ?")
      .bind(USER_ID)
      .run();

    return {
      answer: "Готово. Память очищена.",
      sources: [],
    };
  }

  if (isClearPreferences(message)) {
    await env.DB
      .prepare("DELETE FROM facts WHERE user_id = ? AND category = 'preference'")
      .bind(USER_ID)
      .run();

    return {
      answer: "Готово. Сохранённые предпочтения удалены.",
      sources: [],
    };
  }

  const forgetFact = extractForgetFact(message);

  if (forgetFact) {
    await deleteFact(env, forgetFact);

    return {
      answer: "Хорошо. Я больше не буду учитывать это.",
      sources: [],
    };
  }

  if (isRecallMemory(message)) {
    const facts = await getFacts(env);

    if (!facts.length) {
      return {
        answer: "Пока ничего важного о тебе не сохранено.",
        sources: [],
      };
    }

    const answer = formatFactsForUser(facts);

    return {
      answer,
      sources: [],
    };
  }


  // ----------------------------------------------------------
  // 2. SAVE NORMAL USER MESSAGE
  // ----------------------------------------------------------

  await saveMemory(
    env,
    "user",
    message
  );


  // ----------------------------------------------------------
  // 3. GET CONTEXT
  // ----------------------------------------------------------

  const [facts, history] = await Promise.all([
    getFacts(env),
    getHistory(env),
  ]);


  // ----------------------------------------------------------
  // 4. DETERMINE WHETHER WEB SEARCH IS NEEDED
  // ----------------------------------------------------------

  const shouldSearch = needsWebSearch(message);

  let webResults = [];

  if (shouldSearch) {
    try {
      webResults = await searchWeb(message);
    } catch (error) {
      console.error("SEARCH ERROR:", error);
      webResults = [];
    }
  }


  // ----------------------------------------------------------
  // 5. ASK AI
  // ----------------------------------------------------------

  let answer;

  try {
    answer = await askAI(
      env,
      message,
      facts,
      history,
      webResults
    );
  } catch (error) {
    console.error("AI ERROR:", error);

    return {
      answer:
        "Не удалось получить ответ от моего интеллектуального модуля. Попробуй повторить запрос.",
      sources: [],
    };
  }


  // ----------------------------------------------------------
  // 6. CLEAN ANSWER
  // ----------------------------------------------------------

  answer = cleanAnswer(answer);


  // ----------------------------------------------------------
  // 7. SAVE ASSISTANT MESSAGE
  // ----------------------------------------------------------

  await saveMemory(
    env,
    "assistant",
    answer
  );


  // ----------------------------------------------------------
  // 8. RETURN
  // ----------------------------------------------------------

  return {
    answer,
    sources: webResults.map(item => ({
      title: item.title,
      url: item.url,
    })),
  };
}


// ============================================================
// AI
// ============================================================

async function askAI(
  env,
  message,
  facts,
  history,
  webResults
) {

  const memoryText = facts.length
    ? facts
        .map(f => `- ${f.category}: ${f.fact}`)
        .join("\n")
    : "Нет сохранённых фактов.";

  const historyText = history.length
    ? history
        .reverse()
        .map(item => {
          const role =
            item.role === "user"
              ? "Егор"
              : "J.A.R.V.I.S.";

          return `${role}: ${item.content}`;
        })
        .join("\n")
    : "История разговора отсутствует.";

  const webText = webResults.length
    ? webResults
        .map((item, index) =>
          `${index + 1}. ${item.title}\n${item.snippet}\n${item.url}`
        )
        .join("\n\n")
    : "Интернет-поиск не выполнялся.";

  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

ТВОЯ ГЛАВНАЯ ЗАДАЧА

Ты должен вести себя не как бездушный чат-бот, а как умный собеседник и личный ассистент.

Обращайся к Егору естественно:
"ты", "тебе", "твой", "тебя".

Никогда не называй его:
"пользователь".

Никогда не говори:
"как пользователь",
"ваш запрос",
"пользователь хочет".

Говори естественным русским языком.

СТИЛЬ

Будь:
- грамотным;
- спокойным;
- уверенным;
- естественным;
- внимательным;
- кратким, когда вопрос простой;
- подробным, когда задача сложная;
- инициативным, когда это действительно полезно.

Не используй канцелярит.

Не повторяй постоянно:
"Конечно!",
"Разумеется!",
"С удовольствием!",
"Я готов помочь!"

Не начинай каждый ответ одинаково.

Не задавай вопрос в конце каждого сообщения.

Если вопрос простой — ответь сразу.

Если Егор просто здоровается, отвечай коротко и естественно.

Например:

Егор: "Джарвис, привет"

Хороший ответ:
"Привет, Егор. Я на связи."

Не нужно после приветствия автоматически писать длинный список того, чем ты можешь помочь.

ПАМЯТЬ

Ты можешь использовать сохранённые факты о Егоре.

Но не перечисляй память без необходимости.

Используй её естественно.

Если сохранено:
"Егор любит чай"

то можно сказать:
"Помню, ты любишь чай."

А не:
"В базе данных имеется информация о том, что пользователь предпочитает чай."

ГРАММАТИКА

Очень внимательно следи за русской грамматикой.

Особенно за согласованием лица и рода.

Нельзя писать:

"Ты люблю чай."

Нужно:

"Ты любишь чай."

Нельзя:

"Ты предпочитаю кофе."

Нужно:

"Ты предпочитаешь кофе."

Если сомневаешься, не преобразовывай фразу механически.

Лучше естественно переформулируй предложение.

ФОРМАТ

Не используй Markdown bold.

Не используй конструкции вроде:

**текст**

Если нужно выделение, используй обычные заголовки или списки.

Не добавляй лишние технические объяснения.

НЕ ПРИДУМЫВАЙ ФАКТЫ

Если информации недостаточно, честно скажи об этом.

Если используется интернет-поиск, отличай найденную информацию от собственных рассуждений.

ИНТЕРНЕТ

Если ниже предоставлены результаты интернет-поиска, используй их для актуальной информации.

Не утверждай, что ты что-то нашёл в интернете, если результатов поиска нет.

Если вопрос касается:
- текущих событий;
- последних новостей;
- сегодняшней информации;
- текущих цен;
- расписаний;
- актуальных сервисов;
- современных технологий;
- последних версий;
- текущих правил;

ориентируйся на предоставленные результаты поиска.

Если интернет-данные противоречат твоим общим знаниям, отдавай предпочтение свежим данным.

КОНТЕКСТ

Используй историю разговора, чтобы понимать местоимения и продолжение темы.

Например:

Егор:
"Расскажи про Home Assistant."

J.A.R.V.I.S.:
[ответ]

Егор:
"А как подключить это к айфону?"

Ты должен понимать, что "это" относится к Home Assistant.

НЕ ПЕРЕСКАЗЫВАЙ ИСТОРИЮ ДИАЛОГА без необходимости.

ТВОЯ РОЛЬ

Ты можешь помогать Егору:
- учиться;
- планировать;
- писать тексты;
- разбираться в технологиях;
- программировать;
- искать информацию;
- организовывать задачи;
- анализировать проблемы;
- готовить документы;
- работать над проектами;
- принимать решения через сравнение вариантов.

Если задача сложная — разбивай её на понятные шаги.

Если можно решить задачу непосредственно — решай её, а не рассказывай, что "можно было бы сделать".

ПАМЯТЬ ЕГОРА:
${memoryText}

ИСТОРИЯ ДИАЛОГА:
${historyText}

РЕЗУЛЬТАТЫ ИНТЕРНЕТ-ПОИСКА:
${webText}
`;


  const result = await env.AI.run(
    MODEL,
    {
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],
      max_tokens: 700,
      temperature: 0.65,
    }
  );

  const answer =
    result?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "AI returned empty response."
    );
  }

  return answer;
}


// ============================================================
// MEMORY
// ============================================================

async function saveMemory(
  env,
  role,
  content
) {

  await env.DB
    .prepare(`
      INSERT INTO memory
      (user_id, role, content)
      VALUES (?, ?, ?)
    `)
    .bind(
      USER_ID,
      role,
      content
    )
    .run();
}


async function saveFactToDB(
  env,
  fact
) {

  const existing = await env.DB
    .prepare(`
      SELECT id
      FROM facts
      WHERE user_id = ?
      AND category = ?
      AND LOWER(fact) = LOWER(?)
      LIMIT 1
    `)
    .bind(
      USER_ID,
      fact.category,
      fact.fact
    )
    .first();

  if (existing) {
    await env.DB
      .prepare(`
        UPDATE facts
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(existing.id)
      .run();

    return;
  }

  await env.DB
    .prepare(`
      INSERT INTO facts
      (user_id, category, fact)
      VALUES (?, ?, ?)
    `)
    .bind(
      USER_ID,
      fact.category,
      fact.fact
    )
    .run();
}


async function getFacts(env) {

  const result = await env.DB
    .prepare(`
      SELECT id, category, fact, created_at, updated_at
      FROM facts
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .bind(
      USER_ID,
      MAX_FACTS
    )
    .all();

  return result.results || [];
}


async function getHistory(env) {

  const result = await env.DB
    .prepare(`
      SELECT id, role, content, created_at
      FROM memory
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
    .bind(
      USER_ID,
      MAX_HISTORY
    )
    .all();

  return result.results || [];
}


async function deleteFact(
  env,
  text
) {

  await env.DB
    .prepare(`
      DELETE FROM facts
      WHERE user_id = ?
      AND LOWER(fact) LIKE LOWER(?)
    `)
    .bind(
      USER_ID,
      `%${text}%`
    )
    .run();
}


// ============================================================
// MEMORY COMMAND DETECTION
// ============================================================

function extractSaveFact(message) {

  const patterns = [
    /^запомни[, ]+(?:что )?(.+)$/i,
    /^запиши[, ]+(?:что )?(.+)$/i,
    /^сохрани[, ]+(?:что )?(.+)$/i,
    /^учти[, ]+(?:что )?(.+)$/i,
    /^имей в виду[, ]+(?:что )?(.+)$/i,
    /^не забывай[, ]+(?:что )?(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}


function extractForgetFact(message) {

  const patterns = [
    /^забудь[, ]+(?:что )?(.+)$/i,
    /^удали[, ]+(?:что )?(.+)$/i,
    /^не учитывай[, ]+(?:что )?(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}


function isRecallMemory(message) {

  const normalized =
    message
      .toLowerCase()
      .replace(/[?!.,]/g, "")
      .trim();

  const patterns = [
    "что ты знаешь обо мне",
    "что ты помнишь обо мне",
    "что ты обо мне помнишь",
    "что ты знаешь про меня",
    "что ты помнишь про меня",
    "покажи что ты помнишь",
    "расскажи что ты помнишь",
    "мои сохраненные факты",
    "моя память",
  ];

  return patterns.some(
    pattern => normalized.includes(pattern)
  );
}


function isClearPreferences(message) {

  const normalized =
    message
      .toLowerCase()
      .replace(/[?!.,]/g, "")
      .trim();

  return (
    normalized.includes("очисти предпочтения") ||
    normalized.includes("забудь мои предпочтения") ||
    normalized.includes("удали предпочтения") ||
    normalized.includes("очисти мои предпочтения")
  );
}


function isClearAllMemory(message) {

  const normalized =
    message
      .toLowerCase()
      .replace(/[?!.,]/g, "")
      .trim();

  return (
    normalized.includes("забудь всё") ||
    normalized.includes("забудь все") ||
    normalized.includes("очисти всю память") ||
    normalized.includes("удали всю память") ||
    normalized.includes("очисти память полностью")
  );
}


// ============================================================
// FACT NORMALIZATION
// ============================================================

function normalizeFact(rawFact) {

  let fact = rawFact
    .trim()
    .replace(/\s+/g, " ");

  fact = fact
    .replace(/^что\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

  let category = "general";

  const lower = fact.toLowerCase();

  if (
    lower.includes("люблю") ||
    lower.includes("нравится") ||
    lower.includes("предпочитаю") ||
    lower.includes("любимый") ||
    lower.includes("любимая") ||
    lower.includes("любимое")
  ) {
    category = "preference";
  }

  if (
    lower.includes("учусь") ||
    lower.includes("университет") ||
    lower.includes("учеб")
  ) {
    category = "education";
  }

  if (
    lower.includes("работаю") ||
    lower.includes("работа") ||
    lower.includes("проект")
  ) {
    category = "work";
  }

  if (
    lower.includes("живу") ||
    lower.includes("нахожусь")
  ) {
    category = "location";
  }

  // Сохраняем факт от первого лица.
  // Например:
  // "я люблю чай"
  //
  // а не пытаемся здесь превращать его
  // в "ты любишь чай".
  if (!/^я\b/i.test(fact)) {
    fact = "Я " + fact;
  }

  return {
    category,
    fact,
  };
}


// ============================================================
// HUMAN-FRIENDLY FACT DISPLAY
// ============================================================

function naturalizeFact(fact) {

  let text = fact.trim();

  text = text.replace(/^я\s+/i, "");

  const replacements = [
    [/^люблю\b/i, "Ты любишь"],
    [/^обожаю\b/i, "Ты обожаешь"],
    [/^нравится\b/i, "Тебе нравится"],
    [/^мне нравится\b/i, "Тебе нравится"],
    [/^предпочитаю\b/i, "Ты предпочитаешь"],
    [/^хочу\b/i, "Ты хочешь"],
    [/^не люблю\b/i, "Ты не любишь"],
    [/^ненавижу\b/i, "Ты не любишь"],
    [/^изучаю\b/i, "Ты изучаешь"],
    [/^учусь\b/i, "Ты учишься"],
    [/^работаю\b/i, "Ты работаешь"],
    [/^живу\b/i, "Ты живёшь"],
    [/^нахожусь\b/i, "Ты находишься"],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) {
      return text.replace(
        pattern,
        replacement
      ) + ".";
    }
  }

  // Если факт уже начинается с "я",
  // но не попал под правила выше.
  if (/^я\b/i.test(fact)) {
    return fact
      .replace(/^я\b/i, "Ты")
      .replace(/[.!?]+$/, "") + ".";
  }

  return text
    .replace(/^./, c => c.toUpperCase())
    .replace(/[.!?]+$/, "") + ".";
}


function formatFactsForUser(facts) {

  if (facts.length === 1) {
    return `Помню: ${naturalizeFact(facts[0].fact)}`;
  }

  const lines = facts
    .map(f => `• ${naturalizeFact(f.fact)}`)
    .join("\n");

  return `Вот что я сейчас помню о тебе:\n\n${lines}`;
}


// ============================================================
// WEB SEARCH
// ============================================================

function needsWebSearch(message) {

  const text =
    message.toLowerCase();

  const patterns = [
    "сегодня",
    "сейчас",
    "последние",
    "последняя",
    "последний",
    "новости",
    "актуальн",
    "текущ",
    "цена",
    "стоимость",
    "курс",
    "расписание",
    "открыт",
    "работает ли",
    "версия",
    "релиз",
    "обновление",
    "2026",
    "в 2026",
    "на данный момент",
    "найди в интернете",
    "поищи в интернете",
    "найди информацию",
    "поищи информацию",
    "что произошло",
    "что случилось",
    "как сейчас",
  ];

  return patterns.some(
    pattern => text.includes(pattern)
  );
}


// ============================================================
// DUCKDUCKGO SEARCH
// ============================================================

async function searchWeb(query) {

  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JARVIS/1.0)",
      "Accept":
        "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const results = [];

  const regex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < MAX_SEARCH_RESULTS
  ) {

    let link = decodeHtml(match[1]);

    const title =
      stripHtml(match[2]);

    if (
      link.includes("uddg=")
    ) {
      try {
        const parsed =
          new URL(link);

        const realUrl =
          parsed.searchParams.get("uddg");

        if (realUrl) {
          link = realUrl;
        }
      } catch {}
    }

    if (
      !link.startsWith("http://") &&
      !link.startsWith("https://")
    ) {
      continue;
    }

    results.push({
      title,
      url: link,
      snippet: "",
    });
  }

  // Пытаемся получить описания результатов.
  const snippetRegex =
    /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let snippetMatch;
  let index = 0;

  while (
    (snippetMatch = snippetRegex.exec(html)) &&
    index < results.length
  ) {

    results[index].snippet =
      stripHtml(snippetMatch[1]);

    index++;
  }

  return results;
}


// ============================================================
// HTML CLEANING
// ============================================================

function stripHtml(text) {

  return decodeHtml(
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}


function decodeHtml(text) {

  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}


// ============================================================
// ANSWER CLEANING
// ============================================================

function cleanAnswer(answer) {

  let text =
    String(answer || "").trim();

  // Убираем markdown bold.
  text = text.replace(/\*\*/g, "");

  // Убираем тройные обратные кавычки.
  text = text.replace(/```/g, "");

  // Убираем случайные пробелы.
  text = text.replace(/[ \t]+\n/g, "\n");

  // Слишком много пустых строк.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          "no-store",
      },
    }
  );
}


// ============================================================
// WEB APP
// ============================================================

const HTML = `
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
  background:
    radial-gradient(
      circle at top,
      #162238 0%,
      #080b12 45%,
      #030408 100%
    );

  color: #f1f5f9;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  min-height: 100vh;

  display: flex;
  justify-content: center;
}

.app {
  width: 100%;
  max-width: 850px;

  min-height: 100vh;

  display: flex;
  flex-direction: column;
}

.header {
  padding: 22px 18px 14px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  border-bottom:
    1px solid rgba(255,255,255,.08);

  background:
    rgba(3,6,12,.65);

  backdrop-filter: blur(15px);
}

.logo {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
}

.status {
  font-size: 12px;
  color: #7dd3fc;

  display: flex;
  align-items: center;
  gap: 7px;
}

.dot {
  width: 7px;
  height: 7px;

  background: #4ade80;

  border-radius: 50%;

  box-shadow:
    0 0 12px #4ade80;
}

.messages {
  flex: 1;

  padding:
    22px 16px 120px;

  overflow-y: auto;
}

.message {
  display: flex;

  margin-bottom: 16px;
}

.message.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 85%;

  padding:
    12px 15px;

  border-radius: 17px;

  line-height: 1.5;

  white-space: pre-wrap;

  word-break: break-word;

  font-size: 15px;
}

.user .bubble {
  background: #2563eb;

  border-bottom-right-radius: 5px;
}

.assistant .bubble {
  background:
    rgba(255,255,255,.075);

  border:
    1px solid rgba(255,255,255,.08);

  border-bottom-left-radius: 5px;
}

.sources {
  margin-top: 9px;

  font-size: 12px;
}

.sources a {
  color: #7dd3fc;

  text-decoration: none;

  display: block;

  margin-top: 5px;

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-area {
  position: fixed;

  bottom: 0;

  left: 0;
  right: 0;

  padding:
    12px 12px calc(12px + env(safe-area-inset-bottom));

  background:
    linear-gradient(
      transparent,
      rgba(3,4,8,.97) 30%
    );
}

.input-wrap {
  max-width: 850px;

  margin: 0 auto;

  display: flex;

  gap: 8px;

  background:
    rgba(20,25,35,.95);

  border:
    1px solid rgba(255,255,255,.1);

  border-radius: 18px;

  padding: 8px;

  box-shadow:
    0 10px 35px rgba(0,0,0,.35);
}

textarea {
  flex: 1;

  resize: none;

  border: 0;

  outline: 0;

  background: transparent;

  color: white;

  font-size: 16px;

  padding:
    10px 8px;

  max-height: 130px;

  font-family: inherit;
}

textarea::placeholder {
  color: #718096;
}

button {
  width: 46px;
  height: 46px;

  border: 0;

  border-radius: 14px;

  background: #2563eb;

  color: white;

  font-size: 20px;

  cursor: pointer;
}

button:disabled {
  opacity: .45;
}

.typing {
  opacity: .6;
  font-style: italic;
}

</style>

</head>

<body>

<div class="app">

  <header class="header">

    <div class="logo">
      J.A.R.V.I.S.
    </div>

    <div class="status">
      <span class="dot"></span>
      ONLINE
    </div>

  </header>


  <main
    id="messages"
    class="messages"
  >

    <div class="message assistant">

      <div class="bubble">
        Привет, Егор. Я на связи.
      </div>

    </div>

  </main>


  <div class="input-area">

    <div class="input-wrap">

      <textarea
        id="input"
        rows="1"
        placeholder="Напиши J.A.R.V.I.S..."
      ></textarea>

      <button
        id="send"
        onclick="sendMessage()"
      >
        ↑
      </button>

    </div>

  </div>

</div>


<script>

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const messages =
  document.getElementById("messages");


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


input.addEventListener(
  "input",
  function() {

    this.style.height = "auto";

    this.style.height =
      Math.min(
        this.scrollHeight,
        130
      ) + "px";
  }
);


function addMessage(
  text,
  role,
  sources = []
) {

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "message " + role;

  const bubble =
    document.createElement("div");

  bubble.className =
    "bubble";

  bubble.textContent =
    text;

  wrapper.appendChild(bubble);


  if (
    sources &&
    sources.length
  ) {

    const sourceBox =
      document.createElement("div");

    sourceBox.className =
      "sources";

    sources.forEach(
      source => {

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

        sourceBox.appendChild(
          link
        );
      }
    );

    bubble.appendChild(
      sourceBox
    );
  }


  messages.appendChild(
    wrapper
  );

  messages.scrollTop =
    messages.scrollHeight;
}


function addTyping() {

  const wrapper =
    document.createElement("div");

  wrapper.id =
    "typing";

  wrapper.className =
    "message assistant";

  wrapper.innerHTML =
    '<div class="bubble typing">J.A.R.V.I.S. думает…</div>';

  messages.appendChild(
    wrapper
  );

  messages.scrollTop =
    messages.scrollHeight;
}


function removeTyping() {

  const typing =
    document.getElementById(
      "typing"
    );

  if (typing) {
    typing.remove();
  }
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

  input.style.height =
    "auto";

  send.disabled =
    true;

  addTyping();


  try {

    const response =
      await fetch(
        "/chat",
        {
          method: "POST",

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


    const data =
      await response.json();


    removeTyping();


    if (!response.ok) {

      throw new Error(
        data?.error ||
        "HTTP " +
        response.status
      );
    }


    if (!data.ok) {

      throw new Error(
        data?.error ||
        "Неизвестная ошибка"
      );
    }


    addMessage(
      data.answer ||
      "Я не получил ответа.",
      "assistant",
      data.sources || []
    );


  } catch (error) {

    removeTyping();

    addMessage(
      "Не удалось связаться с J.A.R.V.I.S.\\n\\n" +
      error.message,
      "assistant"
    );

  } finally {

    send.disabled =
      false;

    input.focus();
  }
}

</script>

</body>

</html>
`;
