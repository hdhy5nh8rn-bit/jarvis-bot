const VERSION = "v5.12";

const TIMEZONE = "Europe/Moscow";
const MODEL = "@cf/zai-org/glm-4.7-flash";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/ping") {
        return json({
          ok: true,
          version: VERSION,
          timezone: TIMEZONE,
          model: MODEL,
          message: "J.A.R.V.I.S. online"
        });
      }

      if (path === "/health") {
        return json({
          ok: true,
          version: VERSION,
          database: !!env.DB,
          ai: !!env.AI
        });
      }

      if (path === "/ai-test") {
        return await aiTest(env);
      }

      if (path === "/tasks") {
        return await getTasks(env, "web-user");
      }

      if (path === "/debug-task") {
        const text = url.searchParams.get("text") || "";
        return json({
          ok: true,
          version: VERSION,
          input: text,
          parser: parseTask(text),
          note: "DEBUG endpoint only parses text and does not create a task."
        });
      }

      if (path === "/chat") {
        const text = url.searchParams.get("text") || "";
        return await handleChat(text, env, "web-user");
      }

      if (request.method === "POST" && path === "/api/chat") {
        const body = await request.json().catch(() => ({}));
        const text = body.text || "";
        const userId = body.user_id || "web-user";

        return await handleChat(text, env, userId);
      }

      if (path === "/" || path === "") {
        return htmlPage();
      }

      return json({
        ok: false,
        error: "Not found",
        version: VERSION
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        version: VERSION,
        error: error?.message || String(error)
      }, 500);
    }
  }
};


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8"
    }
  });
}


function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


/* =========================================================
   MOSCOW DATE / TIME
   ========================================================= */

function getMoscowNow() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: TIMEZONE
    })
  );
}


function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}


function getRelativeDate(normalized) {
  const now = getMoscowNow();

  const hasToday =
    /(^|\s)сегодня(?=\s|$)/i.test(normalized);

  const hasTomorrow =
    /(^|\s)завтра(?=\s|$)/i.test(normalized);

  const hasDayAfterTomorrow =
    /(^|\s)послезавтра(?=\s|$)/i.test(normalized);

  let date = new Date(now);

  if (hasTomorrow) {
    date.setDate(date.getDate() + 1);
  }

  if (hasDayAfterTomorrow) {
    date.setDate(date.getDate() + 2);
  }

  return {
    has_today: hasToday,
    has_tomorrow: hasTomorrow,
    has_day_after_tomorrow: hasDayAfterTomorrow,
    calculated_date: formatDate(date),
    defaulted_to_today:
      !hasToday &&
      !hasTomorrow &&
      !hasDayAfterTomorrow
  };
}


/* =========================================================
   TIME PARSER
   ========================================================= */

function parseTime(normalized) {

  /*
    Поддерживаем:

    в 20
    в 20:00
    в 9
    в 9:30
    20:00
    9:30

    ВАЖНО:
    не используем \b около кириллицы.
  */

  let match =
    normalized.match(
      /(?:^|\s)в\s+([01]?\d|2[0-3])(?:\s*:\s*([0-5]\d))?(?=\s|$)/i
    );

  if (match) {
    const hour = Number(match[1]);
    const minute = match[2]
      ? Number(match[2])
      : 0;

    return {
      detected: true,
      match: match[0].trim(),
      calculated_time:
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    };
  }

  match =
    normalized.match(
      /(?:^|\s)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?=\s|$)/i
    );

  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);

    return {
      detected: true,
      match: match[0].trim(),
      calculated_time:
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    };
  }

  return {
    detected: false,
    match: null,
    calculated_time: null
  };
}


/* =========================================================
   TASK INTENT
   ========================================================= */

function hasExplicitTaskIntent(normalized) {

  const explicitCommands =
    /(^|\s)(напомни|напомнить|поставь|поставить|создай|создать|добавь|добавить|задача|задачу|напоминание)(?=\s|$)/i;

  const dateIntent =
    /(^|\s)(сегодня|завтра|послезавтра)(?=\s|$)/i;

  const timeIntent =
    /(?:^|\s)в\s+([01]?\d|2[0-3])(?:\s*:\s*[0-5]\d)?(?=\s|$)/i;

  const exactTimeIntent =
    /(?:^|\s)([01]?\d|2[0-3])\s*:\s*[0-5]\d(?=\s|$)/i;

  if (explicitCommands.test(normalized)) {
    return {
      explicit_task_intent: true,
      reason: "Явная команда создания задачи"
    };
  }

  if (dateIntent.test(normalized)) {
    return {
      explicit_task_intent: true,
      reason: "Обнаружена относительная дата"
    };
  }

  if (timeIntent.test(normalized)) {
    return {
      explicit_task_intent: true,
      reason: "Обнаружено время"
    };
  }

  if (exactTimeIntent.test(normalized)) {
    return {
      explicit_task_intent: true,
      reason: "Обнаружено точное время"
    };
  }

  return {
    explicit_task_intent: false,
    reason: "Признаков задачи не обнаружено"
  };
}


/* =========================================================
   TITLE CLEANING
   ========================================================= */

function cleanTaskTitle(text) {

  let title = normalizeText(text);

  /*
    Убираем команды.
  */

  title = title
    .replace(
      /(^|\s)(напомни|напомнить|поставь|поставить|создай|создать|добавь|добавить)(?=\s|$)/gi,
      " "
    );

  /*
    Убираем относительные даты.
  */

  title = title
    .replace(
      /(^|\s)сегодня(?=\s|$)/gi,
      " "
    )
    .replace(
      /(^|\s)завтра(?=\s|$)/gi,
      " "
    )
    .replace(
      /(^|\s)послезавтра(?=\s|$)/gi,
      " "
    );

  /*
    Убираем "в 20"
    "в 20:00"
  */

  title = title.replace(
    /(?:^|\s)в\s+(?:[01]?\d|2[0-3])(?:\s*:\s*[0-5]\d)?(?=\s|$)/gi,
    " "
  );

  /*
    Убираем "20:00".
  */

  title = title.replace(
    /(?:^|\s)(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d(?=\s|$)/gi,
    " "
  );

  /*
    Убираем лишние слова, если они остались.
  */

  title = title
    .replace(
      /(^|\s)(задача|задачу|напоминание)(?=\s|$)/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  /*
    Если после очистки ничего не осталось,
    используем исходный текст как название.
  */

  if (!title) {
    title = normalizeText(text);
  }

  return title;
}


/* =========================================================
   TASK PARSER
   ========================================================= */

function parseTask(text) {

  const normalized = normalizeText(text);

  const date = getRelativeDate(normalized);
  const time = parseTime(normalized);
  const intent = hasExplicitTaskIntent(normalized);

  const title = cleanTaskTitle(text);

  return {
    normalized,

    date,

    time,

    intent,

    title,

    parsed_task: {
      title,
      task_date: date.calculated_date,
      task_time: time.calculated_time,
      task_type: "once",
      repeat_rule: null
    }
  };
}


/* =========================================================
   DELETE ALL COMMAND
   ========================================================= */

function isDeleteAllCommand(normalized) {

  const patterns = [
    "удали все задачи",
    "удалить все задачи",
    "удали все",
    "удалить все",
    "очисти задачи",
    "очистить задачи",
    "удили все задачи",
    "удили все",
    "удаль все задачи",
    "удаль все",
    "удоли все задачи",
    "удоли все"
  ];

  return patterns.includes(normalized);
}


/* =========================================================
   GREETING
   ========================================================= */

function isGreetingCommand(normalized) {

  return [
    "привет",
    "здравствуй",
    "здравствуйте",
    "добрый день",
    "доброе утро",
    "добрый вечер",
    "джарвис привет",
    "джарвис, привет"
  ].includes(normalized);
}


/* =========================================================
   DATABASE — CREATE
   ========================================================= */

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

  if (!result.meta?.changes) {
    throw new Error("D1 не подтвердил создание задачи");
  }

  const id = result.meta.last_row_id;

  const row = await env.DB.prepare(`
    SELECT *
    FROM tasks
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!row) {
    throw new Error("Задача создана, но проверка записи не прошла");
  }

  return row;
}


/* =========================================================
   DATABASE — GET
   ========================================================= */

async function getTasks(env, userId) {

  const result = await env.DB.prepare(`
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

  return json({
    ok: true,
    version: VERSION,
    count: result.results?.length || 0,
    tasks: result.results || []
  });
}


/* =========================================================
   DATABASE — DELETE ALL
   ========================================================= */

async function deleteAllTasks(env, userId) {

  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE user_id = ?
      AND status = 'active'
  `)
    .bind(userId)
    .run();

  return result.meta?.changes || 0;
}


/* =========================================================
   DATABASE — COMPLETE
   ========================================================= */

async function completeTask(env, userId, taskId) {

  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE id = ?
      AND user_id = ?
      AND status = 'active'
  `)
    .bind(taskId, userId)
    .run();

  return result.meta?.changes || 0;
}


/* =========================================================
   AI
   ========================================================= */

async function askAI(env, messages) {

  const result = await env.AI.run(MODEL, {
    messages
  });

  return (
    result?.choices?.[0]?.message?.content ||
    "Не удалось получить ответ от модели."
  );
}


async function aiTest(env) {

  const answer = await askAI(env, [
    {
      role: "system",
      content:
        "Ты J.A.R.V.I.S. Отвечай кратко, спокойно и по существу."
    },
    {
      role: "user",
      content: "Представься."
    }
  ]);

  return json({
    ok: true,
    version: VERSION,
    model: MODEL,
    answer
  });
}


/* =========================================================
   CHAT
   ========================================================= */

async function handleChat(text, env, userId) {

  const normalized = normalizeText(text);

  if (!normalized) {
    return json({
      ok: false,
      version: VERSION,
      error: "Пустой запрос"
    }, 400);
  }


  /* ---------- DELETE ALL ---------- */

  if (isDeleteAllCommand(normalized)) {

    const deleted = await deleteAllTasks(env, userId);

    return json({
      ok: true,
      version: VERSION,
      action: "delete_all",
      deleted,
      message:
        deleted > 0
          ? `Удалено задач: ${deleted}`
          : "Активных задач не было."
    });
  }


  /* ---------- LIST ---------- */

  if (
    normalized === "покажи мои задачи" ||
    normalized === "покажи задачи" ||
    normalized === "мои задачи" ||
    normalized === "список задач" ||
    normalized === "покажи список задач"
  ) {
    return await getTasks(env, userId);
  }


  /* ---------- GREETING ---------- */

  if (isGreetingCommand(normalized)) {

    return json({
      ok: true,
      version: VERSION,
      action: "greeting",
      message:
        "Добрый день. J.A.R.V.I.S. к вашим услугам."
    });
  }


  /* ---------- TASK ---------- */

  const parsed = parseTask(text);

  if (parsed.intent.explicit_task_intent) {

    const task = await createTask(
      env,
      userId,
      parsed.parsed_task
    );

    return json({
      ok: true,
      version: VERSION,
      action: "create_task",
      message: buildTaskMessage(task),
      task
    });
  }


  /* ---------- AI CHAT ---------- */

  const recent = await env.DB.prepare(`
    SELECT role, content
    FROM memory
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `)
    .bind(userId)
    .all();

  const history = (recent.results || [])
    .reverse()
    .map(row => ({
      role: row.role,
      content: row.content
    }));


  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твои задачи:
- помогать думать;
- планировать;
- объяснять;
- учиться;
- организовывать задачи;
- отвечать спокойно и уверенно.

Стиль:
- кратко, когда вопрос простой;
- подробно, когда требуется объяснение;
- не выдумывай факты;
- если информации недостаточно — скажи об этом.

Ты находишься в часовом поясе Europe/Moscow.

Не утверждай, что задача создана, если её действительно не было создано через систему задач.
`.trim();


  const answer = await askAI(env, [
    {
      role: "system",
      content: systemPrompt
    },
    ...history,
    {
      role: "user",
      content: text
    }
  ]);


  await env.DB.prepare(`
    INSERT INTO memory (user_id, role, content)
    VALUES (?, 'user', ?)
  `)
    .bind(userId, text)
    .run();


  await env.DB.prepare(`
    INSERT INTO memory (user_id, role, content)
    VALUES (?, 'assistant', ?)
  `)
    .bind(userId, answer)
    .run();


  return json({
    ok: true,
    version: VERSION,
    action: "ai",
    message: answer
  });
}


/* =========================================================
   TASK MESSAGE
   ========================================================= */

function buildTaskMessage(task) {

  let message = `Задача создана: «${task.title}»`;

  if (task.task_date) {
    message += ` на ${formatRussianDate(task.task_date)}`;
  }

  if (task.task_time) {
    message += ` в ${task.task_time}`;
  }

  message += ".";

  return message;
}


function formatRussianDate(dateString) {

  const [year, month, day] =
    dateString.split("-").map(Number);

  const date = new Date(
    year,
    month - 1,
    day
  );

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long"
  });
}


/* =========================================================
   WEB UI
   ========================================================= */

function htmlPage() {

  return new Response(`
<!DOCTYPE html>
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
  background: #05070a;
  color: #e8f1ff;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px;
}

.header {
  text-align: center;
  margin-bottom: 24px;
}

.logo {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 5px;
}

.status {
  margin-top: 8px;
  font-size: 13px;
  opacity: .65;
}

.panel {
  background: #0b1018;
  border: 1px solid #1b2a3c;
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 16px;
}

.messages {
  min-height: 240px;
  max-height: 55vh;
  overflow-y: auto;
}

.message {
  padding: 12px 14px;
  margin: 8px 0;
  border-radius: 12px;
  line-height: 1.45;
}

.user {
  background: #162233;
}

.jarvis {
  background: #0d1824;
}

.input-row {
  display: flex;
  gap: 8px;
}

input {
  flex: 1;
  min-width: 0;
  background: #080d14;
  border: 1px solid #25364a;
  color: white;
  border-radius: 12px;
  padding: 14px;
  font-size: 16px;
}

button {
  border: 0;
  border-radius: 12px;
  padding: 0 18px;
  background: #193a5a;
  color: white;
  font-size: 16px;
}

button:active {
  transform: scale(.97);
}

.task {
  padding: 12px;
  border-bottom: 1px solid #1b2a3c;
}

.task:last-child {
  border-bottom: 0;
}

.small {
  font-size: 13px;
  opacity: .6;
}

</style>
</head>

<body>

<div class="container">

  <div class="header">
    <div class="logo">J.A.R.V.I.S.</div>
    <div class="status">
      ${VERSION} • ONLINE
    </div>
  </div>

  <div class="panel messages" id="messages">
    <div class="message jarvis">
      Добрый день. J.A.R.V.I.S. к вашим услугам.
    </div>
  </div>

  <div class="panel">

    <div class="input-row">

      <input
        id="input"
        placeholder="Введите команду..."
        autocomplete="off"
      />

      <button onclick="send()">
        →
      </button>

    </div>

  </div>

  <div class="panel">

    <button
      onclick="loadTasks()"
      style="width:100%;height:44px;"
    >
      Показать задачи
    </button>

    <div id="tasks" style="margin-top:12px;"></div>

  </div>

</div>


<script>

const input =
  document.getElementById("input");

const messages =
  document.getElementById("messages");

const tasks =
  document.getElementById("tasks");


input.addEventListener(
  "keydown",
  function(event) {
    if (event.key === "Enter") {
      send();
    }
  }
);


function addMessage(text, type) {

  const div =
    document.createElement("div");

  div.className =
    "message " + type;

  div.textContent = text;

  messages.appendChild(div);

  messages.scrollTop =
    messages.scrollHeight;
}


async function send() {

  const text =
    input.value.trim();

  if (!text) return;

  input.value = "";

  addMessage(text, "user");

  try {

    const response =
      await fetch(
        "/chat?text=" +
        encodeURIComponent(text)
      );

    const data =
      await response.json();

    if (data.message) {
      addMessage(
        data.message,
        "jarvis"
      );
    } else if (data.tasks) {

      addMessage(
        "Активных задач: " +
        data.tasks.length,
        "jarvis"
      );

      renderTasks(data.tasks);

    } else {
      addMessage(
        JSON.stringify(data),
        "jarvis"
      );
    }

    if (
      data.action === "create_task" ||
      data.action === "delete_all"
    ) {
      loadTasks();
    }

  } catch (error) {

    addMessage(
      "Ошибка соединения с J.A.R.V.I.S.",
      "jarvis"
    );
  }
}


async function loadTasks() {

  try {

    const response =
      await fetch("/tasks");

    const data =
      await response.json();

    renderTasks(data.tasks || []);

  } catch (error) {

    tasks.textContent =
      "Не удалось загрузить задачи.";
  }
}


function renderTasks(list) {

  if (!list.length) {

    tasks.innerHTML =
      '<div class="small">Активных задач нет.</div>';

    return;
  }

  tasks.innerHTML =
    list.map(task => {

      let dateTime = "";

      if (task.task_date) {
        dateTime += task.task_date;
      }

      if (task.task_time) {
        dateTime +=
          " " + task.task_time;
      }

      return \`
        <div class="task">
          <div>
            <strong>\${escapeHtml(task.title)}</strong>
          </div>

          <div class="small">
            \${escapeHtml(dateTime)}
          </div>
        </div>
      \`;

    }).join("");
}


function escapeHtml(text) {

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

</script>

</body>
</html>
  `, {
    headers: {
      "content-type":
        "text/html; charset=UTF-8"
    }
  });
}
