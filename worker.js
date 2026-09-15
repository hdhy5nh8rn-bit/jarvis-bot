const MODEL = "@cf/zai-org/glm-4.7-flash";

const USER_ID = "egor";
const TIME_ZONE = "Europe/Berlin";

const MAX_HISTORY = 12;
const MAX_FACTS = 30;
const MAX_TASKS = 50;
const MAX_SEARCH_RESULTS = 5;

/* =========================================================
   J.A.R.V.I.S. — SYSTEM PROMPT
   ========================================================= */

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Общайся на естественном русском языке.
Отвечай грамотно, спокойно, уверенно и по делу.

Твой стиль:
- умный персональный ассистент;
- естественный собеседник;
- без лишней официозности;
- без постоянного повторения имени пользователя;
- не начинай каждый ответ со слов "Конечно";
- если вопрос простой — отвечай кратко;
- если задача сложная — структурируй ответ;
- если пользователь просто разговаривает — поддерживай разговор естественно.

У тебя есть:
1. память;
2. задачи и расписание;
3. поиск информации в интернете;
4. история текущего диалога.

ВАЖНО:
- Не выдумывай факты о пользователе.
- Используй только предоставленный контекст.
- Если информации недостаточно — прямо скажи об этом.
- Не утверждай, что сделал действие, если действие реально не было выполнено.
- Если задача была удалена, это НЕ означает, что такую задачу нельзя создать снова.
- Если пользователь просит создать новую задачу, создай её независимо от существующих или ранее удалённых задач.

Если пользователь просит сохранить информацию о себе, используй контекст памяти.
Если пользователь спрашивает о своих задачах, используй контекст задач.

Если доступен интернет-поиск, используй найденные данные как дополнительный источник информации.
Не выдумывай результаты поиска.

Формат:
- обычный разговор — обычный текст;
- списки — через •;
- инструкции — по шагам;
- не используй чрезмерное количество эмодзи;
- не используй Markdown-заголовки без необходимости.
`;

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .trim();
}

function normalizeSpaces(value) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanAIAnswer(text) {
  let answer = cleanText(text);

  answer = answer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, "")
    .replace(/<\|assistant\|>/gi, "")
    .replace(/<\|user\|>/gi, "")
    .replace(/<\|system\|>/gi, "")
    .trim();

  return answer || "Я на связи.";
}

/* =========================================================
   AI RESPONSE EXTRACTION
   ========================================================= */

function extractAIText(result) {
  if (!result) return "";

  if (typeof result === "string") {
    return result;
  }

  const candidates = [
    result.response,
    result.text,
    result.output_text,
    result.content,
    result.message?.content,
    result.choices?.[0]?.message?.content,
    result.choices?.[0]?.text,
    result.output?.[0]?.content?.[0]?.text
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (Array.isArray(candidate)) {
      const joined = candidate
        .map(x => {
          if (typeof x === "string") return x;
          return x?.text || x?.content || "";
        })
        .join("")
        .trim();

      if (joined) return joined;
    }
  }

  return "";
}

/* =========================================================
   AI
   ========================================================= */

async function askAI(env, messages) {
  try {
    const result = await env.AI.run(MODEL, {
      messages,
      max_completion_tokens: 1024,
      temperature: 0.65,
      reasoning_effort: "low",
      chat_template_kwargs: {
        enable_thinking: false
      }
    });

    const text = extractAIText(result);

    if (!text) {
      throw new Error("AI вернул ответ без текста.");
    }

    return cleanAIAnswer(text);

  } catch (error) {
    console.error("AI ERROR:", error);

    throw new Error(
      `Ошибка AI: ${error?.message || "неизвестная ошибка"}`
    );
  }
}

/* =========================================================
   DATE / TIME
   ========================================================= */

function localDate() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find(x => x.type === "year")?.value;
  const month = parts.find(x => x.type === "month")?.value;
  const day = parts.find(x => x.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function parseDateOnly(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return d;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const d = parseDateOnly(dateString);
  d.setUTCDate(d.getUTCDate() + amount);
  return formatDateOnly(d);
}

const WEEKDAYS = {
  "воскресенье": 0,
  "понедельник": 1,
  "вторник": 2,
  "среда": 3,
  "среду": 3,
  "четверг": 4,
  "пятница": 5,
  "суббота": 6,
  "субботу": 6,
  "понедельник": 1,
  "вторник": 2,
  "четверг": 4,
  "пятницу": 5
};

function getWeekday(dateString) {
  return parseDateOnly(dateString).getUTCDay();
}

function nextWeekday(baseDate, targetDay) {
  const currentDay = getWeekday(baseDate);

  let diff = targetDay - currentDay;

  if (diff <= 0) {
    diff += 7;
  }

  return addDays(baseDate, diff);
}

function resolveTaskDate(text) {
  const lower = text.toLowerCase();

  const today = localDate();

  if (/\bсегодня\b/.test(lower)) {
    return today;
  }

  if (/\bзавтра\b/.test(lower)) {
    return addDays(today, 1);
  }

  if (/\bпослезавтра\b/.test(lower)) {
    return addDays(today, 2);
  }

  const iso = lower.match(
    /\b(20\d{2})[-.](\d{1,2})[-.](\d{1,2})\b/
  );

  if (iso) {
    const year = iso[1];
    const month = iso[2].padStart(2, "0");
    const day = iso[3].padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  for (const [name, day] of Object.entries(WEEKDAYS)) {
    if (lower.includes(`в ${name}`)) {
      return nextWeekday(today, day);
    }

    if (lower.includes(`на ${name}`)) {
      return nextWeekday(today, day);
    }
  }

  return null;
}

function resolveTaskTime(text) {
  const lower = text.toLowerCase();

  if (/\bполночь\b/.test(lower)) {
    return "00:00";
  }

  if (/\bполдень\b/.test(lower)) {
    return "12:00";
  }

  let match = lower.match(
    /\bв\s+(\d{1,2})(?:[:.](\d{2}))?\s*(утра|дня|вечера|ночи)?\b/
  );

  if (!match) {
    match = lower.match(
      /\b(\d{1,2})[:.](\d{2})\b/
    );

    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2]);

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      }
    }

    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || "00");
  const period = match[3];

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  if (period === "утра" && hour === 12) {
    hour = 0;
  }

  if (period === "вечера" && hour < 12) {
    hour += 12;
  }

  if (period === "ночи") {
    if (hour === 12) hour = 0;
    if (hour >= 1 && hour <= 5) {
      // оставляем как есть
    }
  }

  if (period === "дня" && hour < 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/* =========================================================
   REPEAT RULE
   ========================================================= */

function resolveRepeatRule(text) {
  const lower = text.toLowerCase();

  if (
    /\bкаждый день\b/.test(lower) ||
    /\bкаждый день\b/.test(lower) ||
    /\bежедневно\b/.test(lower)
  ) {
    return "daily";
  }

  if (
    /\bпо будням\b/.test(lower) ||
    /\bкаждый будний день\b/.test(lower)
  ) {
    return "weekdays";
  }

  if (
    /\bкаждую неделю\b/.test(lower) ||
    /\bеженедельно\b/.test(lower)
  ) {
    return "weekly";
  }

  if (
    /\bкаждый месяц\b/.test(lower) ||
    /\bежемесячно\b/.test(lower)
  ) {
    return "monthly";
  }

  for (const name of Object.keys(WEEKDAYS)) {
    if (
      lower.includes(`каждый ${name}`) ||
      lower.includes(`каждую ${name}`)
    ) {
      return `weekly:${WEEKDAYS[name]}`;
    }
  }

  return "none";
}

/* =========================================================
   TASK TYPE
   ========================================================= */

function resolveTaskType(text) {
  const lower = text.toLowerCase();

  if (
    /\bнапоминание\b/.test(lower) ||
    /\bнапомни\b/.test(lower)
  ) {
    return "reminder";
  }

  if (
    /\bспектакль\b/.test(lower) ||
    /\bвстреча\b/.test(lower) ||
    /\bмероприятие\b/.test(lower) ||
    /\bзанятие\b/.test(lower) ||
    /\bучёба\b/.test(lower) ||
    /\bучеба\b/.test(lower)
  ) {
    return "event";
  }

  return "task";
}

/* =========================================================
   TASK COMMAND DETECTION
   ========================================================= */

function isTaskCreationCommand(text) {
  const lower = text.toLowerCase().trim();

  // Команды создания в явной форме
  if (
    /^(создай|добавь|добавить|поставь|поставить|запиши|записать)\b/.test(lower)
  ) {
    return true;
  }

  // "напомни мне ..."
  if (/^напомни(?:\s+мне)?\b/.test(lower)) {
    return true;
  }

  // Естественная форма:
  // "завтра в 10 подготовить презентацию"
  // "в субботу в 20 спектакль"
  // "сегодня в 15 позвонить..."
  if (
    /\b(сегодня|завтра|послезавтра)\b/.test(lower) &&
    (
      /\bв\s+\d{1,2}(?::|\.)?\d{0,2}\b/.test(lower) ||
      /\bв\s+\d{1,2}\s*(утра|дня|вечера|ночи)\b/.test(lower) ||
      /\bполдень\b/.test(lower) ||
      /\bполночь\b/.test(lower)
    )
  ) {
    return true;
  }

  // "в субботу в 20 спектакль"
  for (const day of Object.keys(WEEKDAYS)) {
    if (
      lower.includes(`в ${day}`) &&
      (
        /\bв\s+\d{1,2}(?::|\.)?\d{0,2}\b/.test(lower) ||
        /\bв\s+\d{1,2}\s*(утра|дня|вечера|ночи)\b/.test(lower)
      )
    ) {
      return true;
    }
  }

  // Повторяющиеся задачи
  if (
    /\bкаждый день\b/.test(lower) ||
    /\bежедневно\b/.test(lower) ||
    /\bпо будням\b/.test(lower) ||
    /\bкаждую неделю\b/.test(lower) ||
    /\bеженедельно\b/.test(lower) ||
    /\bкаждый понедельник\b/.test(lower) ||
    /\bкаждый вторник\b/.test(lower) ||
    /\bкаждую среду\b/.test(lower) ||
    /\bкаждый четверг\b/.test(lower) ||
    /\bкаждую пятницу\b/.test(lower) ||
    /\bкаждую субботу\b/.test(lower) ||
    /\bкаждое воскресенье\b/.test(lower)
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   TASK TITLE EXTRACTION
   ========================================================= */

function extractTaskTitle(text) {
  let title = normalizeSpaces(text);

  title = title
    .replace(
      /^(создай|создать|добавь|добавить|поставь|поставить|запиши|записать)\s+(задачу|дело|напоминание|событие)?\s*/i,
      ""
    )
    .replace(
      /^напомни(?:\s+мне)?\s*/i,
      ""
    );

  // Удаляем дату
  title = title
    .replace(/\bсегодня\b/gi, "")
    .replace(/\bзавтра\b/gi, "")
    .replace(/\bпослезавтра\b/gi, "");

  title = title.replace(
    /\bв\s+\d{1,2}(?:[:.]\d{2})?\s*(?:утра|дня|вечера|ночи)?\b/gi,
    ""
  );

  title = title.replace(
    /\b\d{1,2}[:.]\d{2}\b/gi,
    ""
  );

  title = title.replace(
    /\b(полдень|полночь)\b/gi,
    ""
  );

  for (const day of Object.keys(WEEKDAYS)) {
    title = title.replace(
      new RegExp(`\\bв\\s+${day}\\b`, "gi"),
      ""
    );

    title = title.replace(
      new RegExp(`\\bна\\s+${day}\\b`, "gi"),
      ""
    );
  }

  // Убираем повторение
  title = title
    .replace(/\bкаждый день\b/gi, "")
    .replace(/\bежедневно\b/gi, "")
    .replace(/\bпо будням\b/gi, "")
    .replace(/\bкаждую неделю\b/gi, "")
    .replace(/\bеженедельно\b/gi, "")
    .replace(/\bкаждый месяц\b/gi, "")
    .replace(/\bежемесячно\b/gi, "")
    .replace(/\bкаждый\s+(понедельник|вторник|четверг)\b/gi, "")
    .replace(/\bкаждую\s+(среду|пятницу|субботу|неделю)\b/gi, "")
    .replace(/\bкаждое\s+воскресенье\b/gi, "");

  title = title
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\-–—]+/, "")
    .replace(/[,.;:\-–—]+$/, "")
    .trim();

  return title || "Новое дело";
}

/* =========================================================
   MEMORY — CONVERSATION
   ========================================================= */

async function saveMemory(env, role, content) {
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

  return (result.results || []).reverse();
}

/* =========================================================
   FACT MEMORY
   ========================================================= */

function normalizeFact(fact) {
  let value = normalizeSpaces(fact);

  value = value.replace(/^что\s+/i, "").trim();

  if (/^я люблю\s+/i.test(value)) {
    return value.replace(/^я люблю\s+/i, "Ты любишь ");
  }

  if (/^я предпочитаю\s+/i.test(value)) {
    return value.replace(/^я предпочитаю\s+/i, "Ты предпочитаешь ");
  }

  if (/^я не люблю\s+/i.test(value)) {
    return value.replace(/^я не люблю\s+/i, "Ты не любишь ");
  }

  if (/^мне нравится\s+/i.test(value)) {
    return value.replace(/^мне нравится\s+/i, "Тебе нравится ");
  }

  if (/^мне не нравится\s+/i.test(value)) {
    return value.replace(/^мне не нравится\s+/i, "Тебе не нравится ");
  }

  if (/^я хочу\s+/i.test(value)) {
    return value.replace(/^я хочу\s+/i, "Ты хочешь ");
  }

  if (/^я выбираю\s+/i.test(value)) {
    return value.replace(/^я выбираю\s+/i, "Ты выбираешь ");
  }

  if (/^я учусь\s+/i.test(value)) {
    return value.replace(/^я учусь\s+/i, "Ты учишься ");
  }

  return value;
}

async function saveFact(env, fact, category = "general") {
  const normalized = normalizeFact(fact);

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

    return existing.id;
  }

  const result = await env.DB.prepare(`
    INSERT INTO facts (user_id, category, fact)
    VALUES (?, ?, ?)
  `)
    .bind(USER_ID, category, normalized)
    .run();

  return result.meta?.last_row_id;
}

async function getFacts(env) {
  const result = await env.DB.prepare(`
    SELECT id, category, fact, created_at, updated_at
    FROM facts
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `)
    .bind(USER_ID, MAX_FACTS)
    .all();

  return result.results || [];
}

async function deleteFact(env, searchText) {
  const result = await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
      AND fact LIKE ?
  `)
    .bind(USER_ID, `%${searchText}%`)
    .run();

  return result.meta?.changes || 0;
}

async function clearFacts(env) {
  const result = await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();

  return result.meta?.changes || 0;
}

/* =========================================================
   TASKS
   ========================================================= */

async function createTask(
  env,
  title,
  taskDate = null,
  taskTime = null,
  taskType = "task",
  repeatRule = "none"
) {
  /*
    ВАЖНО:
    Используются существующие колонки:
    id
    user_id
    title
    task_date
    task_time
    status
    created_at
    task_type
    repeat_rule
  */

  const result = await env.DB.prepare(`
    INSERT INTO tasks
      (user_id, title, task_date, task_time, status, task_type, repeat_rule)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `)
    .bind(
      USER_ID,
      title,
      taskDate,
      taskTime,
      taskType,
      repeatRule
    )
    .run();

  return result.meta?.last_row_id;
}

async function getTasks(env, options = {}) {
  let query = `
    SELECT
      id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule,
      created_at
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
  `;

  const binds = [USER_ID];

  if (options.date) {
    query += ` AND task_date = ?`;
    binds.push(options.date);
  }

  query += `
    ORDER BY
      CASE WHEN task_date IS NULL THEN 1 ELSE 0 END,
      task_date ASC,
      CASE WHEN task_time IS NULL THEN 1 ELSE 0 END,
      task_time ASC,
      id ASC
    LIMIT ?
  `;

  binds.push(MAX_TASKS);

  const result = await env.DB.prepare(query)
    .bind(...binds)
    .all();

  return result.results || [];
}

async function findActiveTasks(env, searchText) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
      AND title LIKE ?
    ORDER BY id DESC
    LIMIT 20
  `)
    .bind(USER_ID, `%${searchText}%`)
    .all();

  return result.results || [];
}

async function deleteTask(env, id) {
  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE user_id = ?
      AND id = ?
      AND status = 'active'
  `)
    .bind(USER_ID, id)
    .run();

  return (result.meta?.changes || 0) > 0;
}

async function completeTask(env, id) {
  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE user_id = ?
      AND id = ?
      AND status = 'active'
  `)
    .bind(USER_ID, id)
    .run();

  return (result.meta?.changes || 0) > 0;
}

/* =========================================================
   TASK COMMANDS
   ========================================================= */

function isListTaskCommand(text) {
  const lower = text.toLowerCase();

  return (
    /какие у меня задачи/.test(lower) ||
    /какие у меня дела/.test(lower) ||
    /что у меня за задачи/.test(lower) ||
    /что у меня сегодня/.test(lower) ||
    /что у меня завтра/.test(lower) ||
    /что у меня послезавтра/.test(lower) ||
    /какие планы/.test(lower) ||
    /планы на сегодня/.test(lower) ||
    /планы на завтра/.test(lower) ||
    /планы на субботу/.test(lower) ||
    /покажи задачи/.test(lower) ||
    /покажи дела/.test(lower)
  );
}

function resolveListDate(text) {
  const lower = text.toLowerCase();

  if (/\bсегодня\b/.test(lower)) {
    return localDate();
  }

  if (/\bзавтра\b/.test(lower)) {
    return addDays(localDate(), 1);
  }

  if (/\bпослезавтра\b/.test(lower)) {
    return addDays(localDate(), 2);
  }

  for (const [name, day] of Object.entries(WEEKDAYS)) {
    if (lower.includes(name)) {
      return nextWeekday(localDate(), day);
    }
  }

  return null;
}

function isDeleteTaskCommand(text) {
  const lower = text.toLowerCase();

  return (
    /\bудали\b/.test(lower) ||
    /\bудалить\b/.test(lower) ||
    /\bубери задачу\b/.test(lower) ||
    /\bотмени задачу\b/.test(lower)
  );
}

function isCompleteTaskCommand(text) {
  const lower = text.toLowerCase();

  return (
    /\bвыполни\b/.test(lower) ||
    /\bвыполнено\b/.test(lower) ||
    /\bзавершено\b/.test(lower) ||
    /\bотметь.*выполнен/.test(lower) ||
    /\bсделано\b/.test(lower)
  );
}

function extractTaskSearchText(text) {
  let value = text
    .replace(
      /^(удали|удалить|убери|отмени|выполни|завершить|заверши)\s*/i,
      ""
    )
    .replace(
      /^задачу\s*/i,
      ""
    )
    .replace(
      /^дело\s*/i,
      ""
    )
    .replace(
      /^про\s*/i,
      ""
    )
    .trim();

  return value;
}

/* =========================================================
   SEARCH — DUCKDUCKGO HTML
   ========================================================= */

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(text) {
  return decodeHtml(
    String(text || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function webSearch(query) {
  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JARVIS/5.0)"
      }
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();

    const results = [];

    const blocks = html.split(/result__body/gi);

    for (const block of blocks) {
      if (results.length >= MAX_SEARCH_RESULTS) break;

      const titleMatch = block.match(
        /result__a[^>]*>([\s\S]*?)<\/a>/i
      );

      const urlMatch = block.match(
        /result__a[^>]*href="([^"]+)"/i
      );

      const snippetMatch = block.match(
        /result__snippet[^>]*>([\s\S]*?)<\/a>/i
      );

      if (!titleMatch || !urlMatch) continue;

      const title = stripHtml(titleMatch[1]);
      const link = decodeHtml(urlMatch[1]);

      let snippet = snippetMatch
        ? stripHtml(snippetMatch[1])
        : "";

      if (!title || !link) continue;

      results.push({
        title,
        url: link,
        snippet
      });
    }

    return results;

  } catch (error) {
    console.error("SEARCH ERROR:", error);
    return [];
  }
}

function shouldSearch(text) {
  const lower = text.toLowerCase();

  return (
    /\bнайди\b/.test(lower) ||
    /\bпоищи\b/.test(lower) ||
    /\bзагугли\b/.test(lower) ||
    /\bв интернете\b/.test(lower) ||
    /\bактуальн/.test(lower) ||
    /\bпоследн(ие|юю|их)\b/.test(lower) ||
    /\bсейчас\b/.test(lower) ||
    /\bсегодня\b/.test(lower) &&
      /\bновост/.test(lower)
  );
}

function extractSearchQuery(text) {
  return text
    .replace(
      /^(джарвис[,:]?\s*)?/i,
      ""
    )
    .replace(
      /^(найди|поищи|загугли)\s*/i,
      ""
    )
    .replace(
      /\bв интернете\b/gi,
      ""
    )
    .trim();
}

/* =========================================================
   MEMORY COMMANDS
   ========================================================= */

function isSaveFactCommand(text) {
  return /^(запомни|запиши|сохрани|учти)\b/i.test(text.trim());
}

function isRecallCommand(text) {
  const lower = text.toLowerCase();

  return (
    /что ты обо мне помнишь/.test(lower) ||
    /что ты помнишь обо мне/.test(lower) ||
    /что ты знаешь обо мне/.test(lower) ||
    /что ты знаешь про меня/.test(lower) ||
    /какая у тебя память/.test(lower)
  );
}

function isClearMemoryCommand(text) {
  const lower = text.toLowerCase();

  return (
    /забудь всё/.test(lower) ||
    /забудь все/.test(lower) ||
    /очисти память/.test(lower) ||
    /удали всю память/.test(lower) ||
    /забудь всё обо мне/.test(lower) ||
    /забудь все обо мне/.test(lower)
  );
}

function isDeleteMemoryCommand(text) {
  const lower = text.toLowerCase();

  return (
    /забудь что/.test(lower) ||
    /забудь, что/.test(lower) ||
    /удали из памяти/.test(lower)
  );
}

function extractFactText(text) {
  return text
    .replace(
      /^(запомни|запиши|сохрани|учти)\s*,?\s*/i,
      ""
    )
    .trim();
}

function extractDeleteFactText(text) {
  return text
    .replace(
      /^(забудь что|забудь, что|удали из памяти)\s*/i,
      ""
    )
    .trim();
}

/* =========================================================
   CONTEXT BUILDING
   ========================================================= */

function formatFacts(facts) {
  if (!facts.length) {
    return "Память о пользователе пока пуста.";
  }

  return facts
    .map(f => `• ${f.fact}`)
    .join("\n");
}

function formatTasks(tasks) {
  if (!tasks.length) {
    return "Активных задач нет.";
  }

  return tasks
    .map(task => {
      const date = task.task_date
        ? ` — ${task.task_date}`
        : "";

      const time = task.task_time
        ? ` в ${task.task_time}`
        : "";

      const type =
        task.task_type && task.task_type !== "task"
          ? ` [${task.task_type}]`
          : "";

      const repeat =
        task.repeat_rule && task.repeat_rule !== "none"
          ? ` [повтор: ${task.repeat_rule}]`
          : "";

      return `• ${task.title}${date}${time}${type}${repeat}`;
    })
    .join("\n");
}

/* =========================================================
   CHAT HANDLER
   ========================================================= */

async function handleChat(env, userMessage) {
  const text = normalizeSpaces(userMessage);

  if (!text) {
    return "Я на связи.";
  }

  /* -----------------------------------------
     MEMORY: SAVE
     ----------------------------------------- */

  if (isSaveFactCommand(text)) {
    const factText = extractFactText(text);

    if (!factText) {
      return "Что именно мне запомнить?";
    }

    await saveFact(env, factText);

    await saveMemory(env, "user", text);

    const answer = `Запомнил. ${normalizeFact(factText)}.`;

    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     MEMORY: RECALL
     ----------------------------------------- */

  if (isRecallCommand(text)) {
    const facts = await getFacts(env);

    let answer;

    if (!facts.length) {
      answer = "Пока у меня нет сохранённых фактов о тебе.";
    } else {
      answer =
        "Вот что я сейчас помню о тебе:\n\n" +
        formatFacts(facts);
    }

    await saveMemory(env, "user", text);
    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     MEMORY: CLEAR
     ----------------------------------------- */

  if (isClearMemoryCommand(text)) {
    const count = await clearFacts(env);

    await saveMemory(env, "user", text);

    const answer =
      count > 0
        ? `Готово. Удалил ${count} сохранённых фактов из памяти.`
        : "В сохранённой памяти и так ничего не было.";

    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     MEMORY: DELETE FACT
     ----------------------------------------- */

  if (isDeleteMemoryCommand(text)) {
    const factText = extractDeleteFactText(text);

    if (!factText) {
      return "Какой именно факт мне забыть?";
    }

    const count = await deleteFact(env, factText);

    await saveMemory(env, "user", text);

    const answer =
      count > 0
        ? "Удалил этот факт из памяти."
        : "Я не нашёл такой факт в памяти.";

    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     TASK: CREATE
     ----------------------------------------- */

  if (isTaskCreationCommand(text)) {
    const taskDate = resolveTaskDate(text);
    const taskTime = resolveTaskTime(text);
    const repeatRule = resolveRepeatRule(text);
    const taskType = resolveTaskType(text);
    const title = extractTaskTitle(text);

    const taskId = await createTask(
      env,
      title,
      taskDate,
      taskTime,
      taskType,
      repeatRule
    );

    await saveMemory(env, "user", text);

    let answer = `Добавил в расписание: ${title}`;

    if (taskDate) {
      answer += ` — ${taskDate}`;
    }

    if (taskTime) {
      answer += ` в ${taskTime}`;
    }

    if (repeatRule !== "none") {
      answer += ` (${repeatRule})`;
    }

    answer += `.\nID задачи: ${taskId}`;

    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     TASK: LIST
     ----------------------------------------- */

  if (isListTaskCommand(text)) {
    const date = resolveListDate(text);

    const tasks = await getTasks(env, {
      date
    });

    await saveMemory(env, "user", text);

    let answer;

    if (date) {
      if (!tasks.length) {
        answer = `На ${date} активных задач нет.`;
      } else {
        answer =
          `Задачи на ${date}:\n\n` +
          formatTasks(tasks);
      }
    } else {
      if (!tasks.length) {
        answer = "Активных задач сейчас нет.";
      } else {
        answer =
          "Твои активные задачи:\n\n" +
          formatTasks(tasks);
      }
    }

    await saveMemory(env, "assistant", answer);

    return answer;
  }

  /* -----------------------------------------
     TASK: DELETE
     ----------------------------------------- */

  if (isDeleteTaskCommand(text)) {
    const searchText = extractTaskSearchText(text);

    if (!searchText) {
      return "Какую именно задачу удалить?";
    }

    const matches = await findActiveTasks(env, searchText);

    if (!matches.length) {
      return `Не нашёл активную задачу по запросу «${searchText}».`;
    }

    if (matches.length === 1) {
      const task = matches[0];

      await deleteTask(env, task.id);

      const answer =
        `Задача «${task.title}» удалена.`;

      await saveMemory(env, "user", text);
      await saveMemory(env, "assistant", answer);

      return answer;
    }

    const answer =
      "Нашёл несколько подходящих задач:\n\n" +
      matches
        .map(task => `• ${task.id}. ${task.title}`)
        .join("\n") +
      "\n\nУкажи ID нужной задачи.";

    return answer;
  }

  /* -----------------------------------------
     TASK: COMPLETE
     ----------------------------------------- */

  if (isCompleteTaskCommand(text)) {
    const searchText = extractTaskSearchText(text);

    if (!searchText) {
      return "Какую задачу отметить выполненной?";
    }

    const matches = await findActiveTasks(env, searchText);

    if (!matches.length) {
      return `Не нашёл активную задачу по запросу «${searchText}».`;
    }

    if (matches.length === 1) {
      const task = matches[0];

      await completeTask(env, task.id);

      const answer =
        `Готово. Задача «${task.title}» отмечена как выполненная.`;

      await saveMemory(env, "user", text);
      await saveMemory(env, "assistant", answer);

      return answer;
    }

    return (
      "Нашёл несколько подходящих задач:\n\n" +
      matches
        .map(task => `• ${task.id}. ${task.title}`)
        .join("\n") +
      "\n\nУкажи ID нужной задачи."
    );
  }

  /* -----------------------------------------
     WEB SEARCH
     ----------------------------------------- */

  let searchResults = [];

  if (shouldSearch(text)) {
    const query = extractSearchQuery(text);

    if (query) {
      searchResults = await webSearch(query);
    }
  }

  /* -----------------------------------------
     AI CONTEXT
     ----------------------------------------- */

  const history = await getHistory(env);
  const facts = await getFacts(env);

  const allTasks = await getTasks(env);

  let context = "";

  context += "\n\n=== ПАМЯТЬ ===\n";
  context += formatFacts(facts);

  context += "\n\n=== АКТИВНЫЕ ЗАДАЧИ ===\n";
  context += formatTasks(allTasks);

  if (searchResults.length) {
    context += "\n\n=== РЕЗУЛЬТАТЫ ПОИСКА ===\n";

    searchResults.forEach((result, index) => {
      context +=
        `\n${index + 1}. ${result.title}\n` +
        `URL: ${result.url}\n` +
        `Описание: ${result.snippet}\n`;
    });
  }

  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT + context
    },
    ...history.map(item => ({
      role: item.role,
      content: item.content
    })),
    {
      role: "user",
      content: text
    }
  ];

  const answer = await askAI(env, messages);

  await saveMemory(env, "user", text);
  await saveMemory(env, "assistant", answer);

  return answer;
}

/* =========================================================
   HTML INTERFACE
   ========================================================= */

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover">

<title>J.A.R.V.I.S.</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0b0f14;
  color: #f4f7fb;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 18px 18px 14px;
  border-bottom: 1px solid #202832;
  background: #0d1218;
  position: sticky;
  top: 0;
  z-index: 10;
}

.logo {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
}

.status {
  margin-top: 5px;
  font-size: 12px;
  color: #8d98a5;
}

#chat {
  flex: 1;
  overflow-y: auto;
  padding: 18px 14px 120px;
}

.message {
  max-width: 88%;
  padding: 12px 14px;
  border-radius: 16px;
  margin: 9px 0;
  white-space: pre-wrap;
  line-height: 1.45;
  word-wrap: break-word;
}

.user {
  margin-left: auto;
  background: #1d2936;
}

.jarvis {
  margin-right: auto;
  background: #121a22;
  border: 1px solid #202b36;
}

.source {
  display: block;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid #29343f;
  color: #83b9ff;
  text-decoration: none;
  font-size: 12px;
}

.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding:
    10px
    10px
    calc(10px + env(safe-area-inset-bottom));
  background: rgba(11,15,20,.96);
  border-top: 1px solid #202832;
  display: flex;
  gap: 8px;
}

textarea {
  flex: 1;
  resize: none;
  min-height: 46px;
  max-height: 120px;
  border: 1px solid #2a3541;
  border-radius: 14px;
  background: #111820;
  color: white;
  padding: 12px;
  outline: none;
  font-size: 16px;
}

button {
  width: 48px;
  border: 0;
  border-radius: 14px;
  background: #e8eef5;
  color: #10151b;
  font-size: 20px;
  font-weight: 700;
}

button:active {
  transform: scale(.96);
}

.typing {
  opacity: .6;
}
</style>
</head>

<body>

<header>
  <div class="logo">J.A.R.V.I.S.</div>
  <div class="status">Personal Intelligence System</div>
</header>

<div id="chat"></div>

<div class="composer">
  <textarea
    id="input"
    placeholder="Напишите JARVIS..."
    rows="1"></textarea>

  <button id="send">↑</button>
</div>

<script>
const chat = document.getElementById("chat");
const input = document.getElementById("input");
const send = document.getElementById("send");

function addMessage(text, type, sources = []) {
  const div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;

  if (sources && sources.length) {
    sources.forEach(source => {
      const a = document.createElement("a");
      a.className = "source";
      a.href = source.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = source.title;
      div.appendChild(a);
    });
  }

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();

  if (!text) return;

  addMessage(text, "user");

  input.value = "";
  input.style.height = "auto";

  const typing = document.createElement("div");
  typing.className = "message jarvis typing";
  typing.textContent = "JARVIS думает…";
  chat.appendChild(typing);
  chat.scrollTop = chat.scrollHeight;

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: text
      })
    });

    const data = await response.json();

    typing.remove();

    if (!response.ok) {
      addMessage(
        data.error || "Произошла ошибка.",
        "jarvis"
      );
      return;
    }

    addMessage(
      data.answer || "Я на связи.",
      "jarvis",
      data.sources || []
    );

  } catch (error) {
    typing.remove();

    addMessage(
      "Не удалось связаться с JARVIS.",
      "jarvis"
    );
  }
}

send.addEventListener("click", sendMessage);

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height =
    Math.min(input.scrollHeight, 120) + "px";
});

addMessage(
  "Привет. Я на связи.",
  "jarvis"
);
</script>

</body>
</html>`;
}

/* =========================================================
   WORKER
   ========================================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      /* -----------------------------------------
         MAIN PAGE
         ----------------------------------------- */

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(htmlPage(), {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      /* -----------------------------------------
         PING
         ----------------------------------------- */

      if (request.method === "GET" && url.pathname === "/ping") {
        return json({
          ok: true,
          service: "J.A.R.V.I.S.",
          version: "v5"
        });
      }

      /* -----------------------------------------
         HEALTH
         ----------------------------------------- */

      if (request.method === "GET" && url.pathname === "/health") {
        let database = false;
        let ai = false;
        let aiError = null;

        try {
          await env.DB.prepare("SELECT 1").first();
          database = true;
        } catch (error) {
          database = false;
        }

        try {
          const result = await env.AI.run(MODEL, {
            messages: [
              {
                role: "user",
                content: "Ответь одним словом: готов."
              }
            ],
            max_completion_tokens: 20,
            temperature: 0,
            reasoning_effort: "low",
            chat_template_kwargs: {
              enable_thinking: false
            }
          });

          ai = Boolean(extractAIText(result));

          if (!ai) {
            aiError = "AI вернул ответ без текста.";
          }

        } catch (error) {
          ai = false;
          aiError = error?.message || String(error);
        }

        return json({
          ok: database && ai,
          worker: true,
          database,
          ai,
          model: MODEL,
          aiError
        });
      }

      /* -----------------------------------------
         CHAT
         ----------------------------------------- */

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {
        const body = await request.json();

        const message = normalizeSpaces(
          body?.message ||
          body?.text ||
          ""
        );

        if (!message) {
          return json(
            { error: "Пустое сообщение." },
            400
          );
        }

        const answer = await handleChat(
          env,
          message
        );

        let sources = [];

        if (shouldSearch(message)) {
          const query = extractSearchQuery(message);

          if (query) {
            sources = await webSearch(query);
          }
        }

        return json({
          ok: true,
          answer,
          sources: sources.map(source => ({
            title: source.title,
            url: source.url
          }))
        });
      }

      /* -----------------------------------------
         TASKS API
         ----------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/tasks"
      ) {
        const date = url.searchParams.get("date");

        const tasks = await getTasks(env, {
          date: date || null
        });

        return json({
          ok: true,
          tasks
        });
      }

      return json(
        {
          ok: false,
          error: "Маршрут не найден."
        },
        404
      );

    } catch (error) {
      console.error("WORKER ERROR:", error);

      return json(
        {
          ok: false,
          error:
            error?.message ||
            "Внутренняя ошибка J.A.R.V.I.S."
        },
        500
      );
    }
  }
};
