const VERSION = "v5.11";

const TIME_ZONE = "Europe/Moscow";
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================
      // CORS
      // =========================

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      };

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      // =========================
      // PING
      // =========================

      if (url.pathname === "/ping") {
        return json({
          ok: true,
          version: VERSION,
          timezone: TIME_ZONE,
          model: AI_MODEL,
          message: "J.A.R.V.I.S. online"
        }, corsHeaders);
      }

      // =========================
      // HEALTH
      // =========================

      if (url.pathname === "/health") {
        return json({
          ok: true,
          version: VERSION,
          database: !!env.DB,
          ai: !!env.AI,
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }

      // =========================
      // AI TEST
      // =========================

      if (url.pathname === "/ai-test") {
        const result = await env.AI.run(AI_MODEL, {
          messages: [
            {
              role: "system",
              content: "Ты тестовый модуль J.A.R.V.I.S. Ответь коротко."
            },
            {
              role: "user",
              content: "Проведи проверку связи."
            }
          ]
        });

        return json({
          ok: true,
          version: VERSION,
          model: AI_MODEL,
          response: extractAIText(result),
          raw: result
        }, corsHeaders);
      }

      // =========================
      // DEBUG TASK
      // =========================

      if (url.pathname === "/debug-task") {
        const text = url.searchParams.get("text") || "";

        const normalized = normalizeText(text);

        const hasDate =
          normalized.includes("сегодня") ||
          normalized.includes("завтра") ||
          normalized.includes("послезавтра");

        const timeMatch =
          normalized.match(
            /\bв\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/
          ) ||
          normalized.match(
            /\b([01]?\d|2[0-3]):([0-5]\d)\b/
          );

        let parsed = null;

        try {
          parsed = parseTask(text);
        } catch (error) {
          parsed = {
            error:
              error instanceof Error
                ? error.message
                : String(error)
          };
        }

        return json({
          ok: true,
          version: VERSION,
          input: text,
          normalized,
          hasDate,
          hasTime: !!timeMatch,
          timeMatch: timeMatch ? timeMatch[0] : null,
          explicitTaskIntent: hasExplicitTaskIntent(normalized),
          parsed
        }, corsHeaders);
      }

      // =========================
      // TASKS API
      // =========================

      if (url.pathname === "/tasks") {
        const userId =
          url.searchParams.get("user_id") || "web-user";

        const tasks = await getTasks(env, userId);

        return json({
          ok: true,
          version: VERSION,
          user_id: userId,
          tasks
        }, corsHeaders);
      }

      // =========================
      // CHAT API
      // =========================

      if (url.pathname === "/chat") {
        if (request.method !== "POST") {
          return json({
            ok: false,
            error: "Используй POST для /chat"
          }, corsHeaders, 405);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "Некорректный JSON"
          }, corsHeaders, 400);
        }

        const userId =
          String(body.user_id || "web-user");

        const message =
          String(body.message || "").trim();

        if (!message) {
          return json({
            ok: false,
            error: "Пустое сообщение"
          }, corsHeaders, 400);
        }

        const result = await handleChat(
          env,
          userId,
          message
        );

        return json({
          ok: true,
          version: VERSION,
          ...result
        }, corsHeaders);
      }

      // =========================
      // WEB INTERFACE
      // =========================

      return new Response(getHTML(), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          ...corsHeaders
        }
      });

    } catch (error) {
      return json({
        ok: false,
        version: VERSION,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      }, {
        "Access-Control-Allow-Origin": "*"
      }, 500);
    }
  }
};


// ============================================================
// CHAT LOGIC
// ============================================================

async function handleChat(env, userId, message) {

  const normalized = normalizeText(message);

  // ----------------------------------------------------------
  // 1. ПОКАЗАТЬ ЗАДАЧИ
  // ----------------------------------------------------------

  if (isListCommand(normalized)) {
    const tasks = await getTasks(env, userId);

    if (!tasks.length) {
      return {
        type: "task_list",
        message: "Активных задач нет.",
        tasks
      };
    }

    return {
      type: "task_list",
      message: formatTaskList(tasks),
      tasks
    };
  }

  // ----------------------------------------------------------
  // 2. УДАЛИТЬ ВСЕ
  // ----------------------------------------------------------

  if (isDeleteAllCommand(normalized)) {
    const deleted = await deleteAllTasks(env, userId);

    return {
      type: "task_delete_all",
      message:
        deleted > 0
          ? `Удалено задач: ${deleted}.`
          : "Активных задач уже нет.",
      deleted
    };
  }

  // ----------------------------------------------------------
  // 3. УДАЛИТЬ КОНКРЕТНУЮ
  // ----------------------------------------------------------

  if (isDeleteCommand(normalized)) {
    const title = extractDeleteTitle(normalized);

    if (title) {
      const deleted = await deleteTask(
        env,
        userId,
        title
      );

      return {
        type: "task_delete",
        message:
          deleted > 0
            ? `Задача «${capitalize(title)}» удалена.`
            : `Задачу «${capitalize(title)}» не нашёл.`,
        deleted
      };
    }
  }

  // ----------------------------------------------------------
  // 4. ВЫПОЛНЕНО
  // ----------------------------------------------------------

  if (isCompleteCommand(normalized)) {
    const title = extractCompleteTitle(normalized);

    if (title) {
      const completed = await completeTask(
        env,
        userId,
        title
      );

      return {
        type: "task_complete",
        message:
          completed > 0
            ? `Задача «${capitalize(title)}» отмечена выполненной.`
            : `Задачу «${capitalize(title)}» не нашёл.`,
        completed
      };
    }
  }

  // ----------------------------------------------------------
  // 5. ПРИВЕТСТВИЕ
  // ----------------------------------------------------------

  if (isGreetingCommand(normalized)) {
    return {
      type: "greeting",
      message:
        "Здравствуйте. J.A.R.V.I.S. на связи. Чем могу помочь?"
    };
  }

  // ----------------------------------------------------------
  // 6. СОЗДАНИЕ ЗАДАЧИ
  // ----------------------------------------------------------

  const parsedTask = parseTask(message);

  if (parsedTask) {
    try {
      const created = await createTask(
        env,
        userId,
        parsedTask
      );

      return {
        type: "task_created",
        message: formatCreatedTask(created),
        task: created
      };

    } catch (error) {
      return {
        type: "task_error",
        message:
          "Я распознал задачу, но не смог сохранить её в памяти.",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        parsed: parsedTask
      };
    }
  }

  // ----------------------------------------------------------
  // 7. Обычный AI-ДИАЛОГ
  // ----------------------------------------------------------

  const aiText = await askAI(
    env,
    userId,
    message
  );

  await saveMemory(
    env,
    userId,
    "user",
    message
  );

  await saveMemory(
    env,
    userId,
    "assistant",
    aiText
  );

  return {
    type: "ai",
    message: aiText
  };
}


// ============================================================
// TASK PARSER
// ============================================================

function parseTask(text) {

  const normalized = normalizeText(text);

  if (!hasExplicitTaskIntent(normalized)) {
    return null;
  }

  let taskDate = null;
  let taskTime = null;

  // ----------------------------------------------------------
  // DATE
  // ----------------------------------------------------------

  if (normalized.includes("послезавтра")) {
    taskDate = addDaysToMoscowDate(2);
  } else if (normalized.includes("завтра")) {
    taskDate = addDaysToMoscowDate(1);
  } else if (normalized.includes("сегодня")) {
    taskDate = getMoscowDate();
  }

  // ----------------------------------------------------------
  // TIME
  // ----------------------------------------------------------

  let match = normalized.match(
    /\bв\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/
  );

  if (!match) {
    match = normalized.match(
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/
    );
  }

  if (match) {
    const hour = String(match[1]).padStart(2, "0");
    const minute =
      match[2] !== undefined
        ? String(match[2]).padStart(2, "0")
        : "00";

    taskTime = `${hour}:${minute}`;
  }

  // ----------------------------------------------------------
  // ЕСЛИ ВРЕМЯ ЕСТЬ, А ДАТЫ НЕТ — СЕГОДНЯ
  // ----------------------------------------------------------

  if (taskTime && !taskDate) {
    taskDate = getMoscowDate();
  }

  // ----------------------------------------------------------
  // TITLE
  // ----------------------------------------------------------

  const title = cleanTaskTitle(normalized);

  if (!title) {
    return null;
  }

  return {
    title,
    task_date: taskDate,
    task_time: taskTime,
    task_type: "once",
    repeat_rule: null
  };
}


// ============================================================
// TASK INTENT
// ============================================================

function hasExplicitTaskIntent(normalized) {

  const explicitWords = [
    "напомни",
    "напомнить",
    "напоминание",
    "поставь задачу",
    "создай задачу",
    "добавь задачу",
    "добавить задачу",
    "запланируй",
    "запланировать",
    "запиши",
    "записать",
    "поставь напоминание",
    "создай напоминание",
    "добавь напоминание"
  ];

  if (
    explicitWords.some(word =>
      normalized.includes(word)
    )
  ) {
    return true;
  }

  const hasDate =
    normalized.includes("сегодня") ||
    normalized.includes("завтра") ||
    normalized.includes("послезавтра");

  const hasTime =
    /\bв\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/.test(
      normalized
    ) ||
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/.test(
      normalized
    );

  // Естественная команда:
  // "завтра спектакль в 20"
  if (hasDate && hasTime) {
    return true;
  }

  // "завтра спектакль"
  if (hasDate) {
    return true;
  }

  return false;
}


// ============================================================
// TITLE CLEANER
// ============================================================

function cleanTaskTitle(normalized) {

  let title = normalized;

  const removePatterns = [
    /\bjarvis\b/gi,
    /\bджарвис\b/gi,

    /\bнапомни\b/gi,
    /\bнапомнить\b/gi,
    /\bнапоминание\b/gi,

    /\bпоставь\s+задачу\b/gi,
    /\bсоздай\s+задачу\b/gi,
    /\bдобавь\s+задачу\b/gi,
    /\bдобавить\s+задачу\b/gi,

    /\bпоставь\s+напоминание\b/gi,
    /\bсоздай\s+напоминание\b/gi,
    /\bдобавь\s+напоминание\b/gi,

    /\bзапланируй\b/gi,
    /\bзапланировать\b/gi,
    /\bзапиши\b/gi,
    /\bзаписать\b/gi,

    /\bпослезавтра\b/gi,
    /\bзавтра\b/gi,
    /\bсегодня\b/gi,

    /\bв\s+(?:[01]?\d|2[0-3])(?::[0-5]\d)?\b/gi,

    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gi
  ];

  for (const pattern of removePatterns) {
    title = title.replace(pattern, " ");
  }

  title = title
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:!?-]+/, "")
    .replace(/[\s,.;:!?-]+$/, "")
    .trim();

  if (!title) {
    return null;
  }

  return capitalize(title);
}


// ============================================================
// CREATE TASK
// ============================================================

async function createTask(env, userId, task) {

  const result = await env.DB.prepare(`
    INSERT INTO tasks
    (
      user_id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule
    )
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `)
    .bind(
      userId,
      task.title,
      task.task_date,
      task.task_time,
      task.task_type || "once",
      task.repeat_rule || null
    )
    .run();

  const changes =
    result?.meta?.changes ?? 0;

  const id =
    result?.meta?.last_row_id;

  if (changes < 1 || !id) {
    throw new Error(
      `D1 INSERT не подтвердил создание задачи. meta=${JSON.stringify(result?.meta || {})}`
    );
  }

  // ----------------------------------------------------------
  // ПРОВЕРКА: действительно ли запись появилась
  // ----------------------------------------------------------

  const verification =
    await env.DB.prepare(`
      SELECT
        id,
        user_id,
        title,
        task_date,
        task_time,
        status,
        task_type,
        repeat_rule,
        created_at
      FROM tasks
      WHERE id = ?
        AND user_id = ?
        AND status = 'active'
      LIMIT 1
    `)
      .bind(id, userId)
      .first();

  if (!verification) {
    throw new Error(
      `D1 INSERT сообщил об успехе, но SELECT не нашёл созданную задачу. id=${id}`
    );
  }

  return verification;
}


// ============================================================
// GET TASKS
// ============================================================

async function getTasks(env, userId) {

  const result =
    await env.DB.prepare(`
      SELECT
        id,
        user_id,
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
      ORDER BY
        CASE
          WHEN task_date IS NULL THEN 1
          ELSE 0
        END,
        task_date ASC,
        task_time ASC,
        id ASC
    `)
      .bind(userId)
      .all();

  return result.results || [];
}


// ============================================================
// DELETE ALL
// ============================================================

async function deleteAllTasks(env, userId) {

  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'deleted'
      WHERE user_id = ?
        AND status = 'active'
    `)
      .bind(userId)
      .run();

  return result?.meta?.changes ?? 0;
}


// ============================================================
// DELETE ONE
// ============================================================

async function deleteTask(
  env,
  userId,
  title
) {

  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'deleted'
      WHERE user_id = ?
        AND status = 'active'
        AND LOWER(title) = LOWER(?)
    `)
      .bind(userId, title)
      .run();

  return result?.meta?.changes ?? 0;
}


// ============================================================
// COMPLETE
// ============================================================

async function completeTask(
  env,
  userId,
  title
) {

  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'completed'
      WHERE user_id = ?
        AND status = 'active'
        AND LOWER(title) = LOWER(?)
    `)
      .bind(userId, title)
      .run();

  return result?.meta?.changes ?? 0;
}


// ============================================================
// COMMAND DETECTION
// ============================================================

function isListCommand(normalized) {

  const commands = [
    "покажи задачи",
    "покажи мои задачи",
    "мои задачи",
    "мои задачи покажи",
    "список задач",
    "список моих задач",
    "какие у меня задачи",
    "какие задачи",
    "что у меня запланировано"
  ];

  return commands.includes(normalized);
}


function isDeleteAllCommand(normalized) {

  const commands = [
    "удали все задачи",
    "удалить все задачи",
    "отмени все задачи",
    "отменить все задачи",

    "удали все мои задачи",
    "удалить все мои задачи",
    "отмени все мои задачи",
    "отменить все мои задачи",

    "очисти задачи",
    "очистить задачи",

    // Частая опечатка
    "удили все задачи",
    "удили все мои задачи"
  ];

  return commands.includes(normalized);
}


function isDeleteCommand(normalized) {

  return (
    normalized.startsWith("удали ") ||
    normalized.startsWith("удалить ") ||
    normalized.startsWith("отмени ") ||
    normalized.startsWith("отменить ")
  );
}


function isCompleteCommand(normalized) {

  return (
    normalized.startsWith("выполни ") ||
    normalized.startsWith("заверши ") ||
    normalized.startsWith("готово ")
  );
}


function isGreetingCommand(normalized) {

  const commands = [
    "привет",
    "здравствуй",
    "здравствуйте",
    "доброе утро",
    "добрый день",
    "добрый вечер",
    "доброй ночи",

    "привет jarvis",
    "привет джарвис",
    "здравствуй jarvis",
    "здравствуй джарвис",

    "джарвис привет",
    "jarvis привет"
  ];

  return commands.includes(normalized);
}


// ============================================================
// TITLE EXTRACTION
// ============================================================

function extractDeleteTitle(normalized) {

  return normalized
    .replace(/^удали\s+/, "")
    .replace(/^удалить\s+/, "")
    .replace(/^отмени\s+/, "")
    .replace(/^отменить\s+/, "")
    .trim();
}


function extractCompleteTitle(normalized) {

  return normalized
    .replace(/^выполни\s+/, "")
    .replace(/^заверши\s+/, "")
    .replace(/^готово\s+/, "")
    .trim();
}


// ============================================================
// AI
// ============================================================

async function askAI(
  env,
  userId,
  message
) {

  const history = await getMemory(
    env,
    userId,
    12
  );

  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Отвечай на русском языке.

Твой стиль:
- спокойный;
- умный;
- уважительный;
- краткий, но полезный;
- естественный;
- без лишней воды.

ВАЖНО:
Ты не должен утверждать, что создал, удалил, изменил или сохранил задачу, если это действие не было реально выполнено программой.

Если пользователь просит создать задачу, а программа не передала тебе подтверждение создания, не говори, что задача создана.

Если пользователь просит удалить задачу, а программа не передала подтверждение удаления, не говори, что она удалена.
`;

  const messages = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  for (const item of history) {
    messages.push({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",
      content: item.content
    });
  }

  messages.push({
    role: "user",
    content: message
  });

  const result =
    await env.AI.run(AI_MODEL, {
      messages
    });

  return extractAIText(result);
}


function extractAIText(result) {

  const text =
    result?.choices?.[0]?.message?.content;

  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  if (typeof result?.response === "string") {
    return result.response.trim();
  }

  return "Не удалось получить ответ от AI.";
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

  await env.DB.prepare(`
    INSERT INTO memory
    (user_id, role, content)
    VALUES (?, ?, ?)
  `)
    .bind(
      userId,
      role,
      content
    )
    .run();
}


async function getMemory(
  env,
  userId,
  limit = 12
) {

  const result =
    await env.DB.prepare(`
      SELECT
        role,
        content,
        created_at
      FROM memory
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `)
      .bind(userId, limit)
      .all();

  return (result.results || []).reverse();
}


// ============================================================
// DATE / TIME
// ============================================================

function getMoscowDate() {

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    );

  return formatter.format(
    new Date()
  );
}


function addDaysToMoscowDate(days) {

  const now = new Date();

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    );

  const parts =
    formatter.formatToParts(now);

  const year = Number(
    parts.find(p => p.type === "year").value
  );

  const month = Number(
    parts.find(p => p.type === "month").value
  );

  const day = Number(
    parts.find(p => p.type === "day").value
  );

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + days
      )
    );

  return date.toISOString().slice(0, 10);
}


// ============================================================
// FORMATTERS
// ============================================================

function formatCreatedTask(task) {

  let message =
    `Задача «${task.title}» добавлена.`;

  if (task.task_date) {
    message +=
      ` Дата: ${formatDate(task.task_date)}.`;
  }

  if (task.task_time) {
    message +=
      ` Время: ${task.task_time}.`;
  }

  return message;
}


function formatTaskList(tasks) {

  return tasks
    .map((task, index) => {

      let line =
        `${index + 1}. ${task.title}`;

      if (task.task_date) {
        line +=
          ` — ${formatDate(task.task_date)}`;
      }

      if (task.task_time) {
        line +=
          ` в ${task.task_time}`;
      }

      return line;
    })
    .join("\n");
}


function formatDate(dateString) {

  const parts =
    String(dateString).split("-");

  if (parts.length !== 3) {
    return dateString;
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}


// ============================================================
// TEXT HELPERS
// ============================================================

function normalizeText(text) {

  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}


function capitalize(text) {

  if (!text) {
    return text;
  }

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  extraHeaders = {},
  status = 200
) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        ...extraHeaders
      }
    }
  );
}


// ============================================================
// WEB UI
// ============================================================

function getHTML() {

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

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
      #182638 0%,
      #080d14 45%,
      #030509 100%
    );
  color: #eaf4ff;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  min-height: 100vh;
}

.app {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 18px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  text-align: center;
  padding: 15px 0 20px;
}

.logo {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 5px;
}

.status {
  margin-top: 6px;
  font-size: 13px;
  opacity: .65;
}

.chat {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0 20px;
}

.message {
  margin: 12px 0;
  padding: 14px 16px;
  border-radius: 18px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.user {
  background: #17304a;
  margin-left: 30px;
}

.assistant {
  background: #101821;
  margin-right: 30px;
  border: 1px solid #1e3448;
}

.input-area {
  display: flex;
  gap: 10px;
  padding-top: 10px;
}

input {
  flex: 1;
  min-width: 0;
  padding: 15px;
  border-radius: 15px;
  border: 1px solid #29455e;
  background: #0b1118;
  color: white;
  outline: none;
  font-size: 16px;
}

button {
  border: 0;
  border-radius: 15px;
  padding: 0 20px;
  background: #1b7cff;
  color: white;
  font-weight: 600;
  font-size: 15px;
}

button:active {
  transform: scale(.97);
}

</style>
</head>

<body>

<div class="app">

  <div class="header">

    <div class="logo">
      J.A.R.V.I.S.
    </div>

    <div class="status">
      ONLINE · ${VERSION}
    </div>

  </div>

  <div
    id="chat"
    class="chat"
  ></div>

  <div class="input-area">

    <input
      id="input"
      type="text"
      placeholder="Сообщение J.A.R.V.I.S..."
      autocomplete="off"
    />

    <button
      id="send"
    >
      Отправить
    </button>

  </div>

</div>

<script>

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const chat =
  document.getElementById("chat");

const USER_ID =
  "web-user";

const HISTORY_KEY =
  "jarvis_chat_history_v511";


function addMessage(
  text,
  role
) {

  const div =
    document.createElement("div");

  div.className =
    "message " + role;

  div.textContent = text;

  chat.appendChild(div);

  chat.scrollTop =
    chat.scrollHeight;
}


function loadHistory() {

  try {

    const saved =
      JSON.parse(
        localStorage.getItem(
          HISTORY_KEY
        ) || "[]"
      );

    for (
      const item of saved
    ) {
      addMessage(
        item.text,
        item.role
      );
    }

  } catch {}

}


function saveMessage(
  text,
  role
) {

  try {

    const saved =
      JSON.parse(
        localStorage.getItem(
          HISTORY_KEY
        ) || "[]"
      );

    saved.push({
      text,
      role
    });

    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(
        saved.slice(-100)
      )
    );

  } catch {}

}


async function sendMessage() {

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  addMessage(
    text,
    "user"
  );

  saveMessage(
    text,
    "user"
  );

  input.value = "";

  send.disabled = true;

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
              user_id: USER_ID,
              message: text
            })
        }
      );

    const data =
      await response.json();

    const answer =
      data.message ||
      data.error ||
      "Нет ответа.";

    addMessage(
      answer,
      "assistant"
    );

    saveMessage(
      answer,
      "assistant"
    );

  } catch (error) {

    const answer =
      "Ошибка связи с J.A.R.V.I.S.";

    addMessage(
      answer,
      "assistant"
    );

    saveMessage(
      answer,
      "assistant"
    );

  } finally {

    send.disabled = false;

    input.focus();

  }

}


send.addEventListener(
  "click",
  sendMessage
);


input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {
      sendMessage();
    }

  }
);


loadHistory();

input.focus();

</script>

</body>
</html>`;
}
