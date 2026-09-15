const MODEL = "@cf/zai-org/glm-4.7-flash";

const USER_ID = "egor";
const TIME_ZONE = "Europe/Berlin";
const VERSION = "v5.1";

/* =========================================================
   J.A.R.V.I.S. — Personal AI Assistant
   Cloudflare Worker
   ========================================================= */

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      /* =========================
         BASIC ROUTES
         ========================= */

      if (path === "/ping") {
        return json({
          ok: true,
          service: "J.A.R.V.I.S.",
          version: VERSION
        });
      }

      if (path === "/health") {
        return await health(env);
      }

      if (path === "/tasks") {
        return await getTasks(env);
      }

      if (path === "/") {
        return html(homePage());
      }

      /* =========================
         CHAT API
         ========================= */

      if (path === "/chat" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));

        const message =
          typeof body.message === "string"
            ? body.message.trim()
            : "";

        if (!message) {
          return json({
            ok: false,
            error: "Пустое сообщение"
          }, 400);
        }

        const result = await processMessage(message, env);

        return json({
          ok: true,
          ...result
        });
      }

      return json({
        ok: false,
        error: "Not found"
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        error: error?.message || String(error)
      }, 500);
    }
  }
};


/* =========================================================
   MAIN MESSAGE PROCESSOR
   ========================================================= */

async function processMessage(message, env) {

  /*
   * ВАЖНО:
   * Команды задач обрабатываются ДО AI.
   * ИИ не решает, создавать задачу или нет.
   */

  /* ---------- CREATE TASK ---------- */

  if (isTaskCreationCommand(message)) {
    const task = parseTask(message);

    if (task) {
      const created = await createTask(task, env);

      return {
        type: "task_created",
        task: created,
        reply: buildTaskCreatedReply(created)
      };
    }
  }


  /* ---------- DELETE TASK ---------- */

  if (isTaskDeleteCommand(message)) {
    const deleted = await deleteTaskFromMessage(message, env);

    if (deleted) {
      return {
        type: "task_deleted",
        task: deleted,
        reply: `Удалил задачу: «${deleted.title}».`
      };
    }

    return {
      type: "task_not_found",
      reply: "Не нашёл активную задачу для удаления."
    };
  }


  /* ---------- COMPLETE TASK ---------- */

  if (isTaskCompleteCommand(message)) {
    const completed = await completeTaskFromMessage(message, env);

    if (completed) {
      return {
        type: "task_completed",
        task: completed,
        reply: `Готово. Задача «${completed.title}» отмечена выполненной.`
      };
    }

    return {
      type: "task_not_found",
      reply: "Не нашёл активную задачу для завершения."
    };
  }


  /* ---------- LIST TASKS ---------- */

  if (isTaskListCommand(message)) {
    const tasks = await loadTasks(env);

    return {
      type: "task_list",
      tasks,
      reply: buildTaskListReply(tasks)
    };
  }


  /* ---------- MEMORY ---------- */

  await saveMemory(env, "user", message);

  const facts = await getFacts(env);
  const recentMemory = await getRecentMemory(env);

  const systemPrompt = buildSystemPrompt(facts);

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },

    ...recentMemory.map(item => ({
      role: item.role === "assistant"
        ? "assistant"
        : "user",
      content: item.content
    })),

    {
      role: "user",
      content: message
    }
  ];

  const aiResponse = await env.AI.run(MODEL, {
    messages,
    max_completion_tokens: 1024,
    temperature: 0.65,
    reasoning_effort: "low",
    chat_template_kwargs: {
      enable_thinking: false
    }
  });

  const reply =
    extractAIText(aiResponse) ||
    "Я здесь. Готов помочь.";

  await saveMemory(env, "assistant", reply);

  return {
    type: "chat",
    reply
  };
}


/* =========================================================
   TASK DETECTION
   ========================================================= */

function isTaskCreationCommand(text) {

  const s = normalize(text);

  /*
   * Явные команды.
   */

  const explicit =
    /\b(создай|создать|добавь|добавить|поставь|поставить|запиши|записать|напомни|напомнить|назначь|назначить)\b/i.test(s);

  if (explicit) {
    return true;
  }

  /*
   * Если есть дата/время + содержательная фраза,
   * считаем это созданием задачи.
   *
   * Например:
   * "Завтра в 10 подготовить презентацию"
   * "В субботу в 20 спектакль"
   */

  const hasDate =
    /\b(сегодня|завтра|послезавтра|понедельник|понедельника|вторник|вторника|среда|среду|среды|четверг|четверга|пятница|пятницу|пятницы|суббота|субботу|субботы|воскресенье|воскресенья)\b/i.test(s)
    || /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(s);

  const hasTime =
    /\bв\s+\d{1,2}(?::\d{2})?(?:\s*(?:утра|дня|вечера|ночи))?\b/i.test(s)
    || /\b(полдень|полночь)\b/i.test(s);

  return hasDate && hasTime;
}


/* =========================================================
   TASK PARSER
   ========================================================= */

function parseTask(originalText) {

  let text = normalize(originalText);

  const date = resolveTaskDate(text);
  const time = resolveTaskTime(text);
  const repeatRule = resolveRepeatRule(text);
  const taskType = resolveTaskType(text);

  /*
   * Если нет ни даты, ни времени, но есть явная команда,
   * всё равно разрешаем создание.
   */

  let title = extractTaskTitle(text);

  if (!title) {
    return null;
  }

  title = cleanTitle(title);

  if (!title) {
    return null;
  }

  return {
    title,
    task_date: date,
    task_time: time,
    task_type: taskType,
    repeat_rule: repeatRule
  };
}


/* =========================================================
   DATE
   ========================================================= */

function resolveTaskDate(text) {

  const s = normalize(text);

  const now = new Date();

  /*
   * YYYY-MM-DD
   */

  let match = s.match(
    /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/
  );

  if (match) {
    return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
  }

  /*
   * DD.MM.YYYY
   */

  match = s.match(
    /\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/
  );

  if (match) {
    return `${match[3]}-${pad(match[2])}-${pad(match[1])}`;
  }

  /*
   * Сегодня
   */

  if (/\bсегодня\b/i.test(s)) {
    return formatDate(now);
  }

  /*
   * Завтра
   */

  if (/\bзавтра\b/i.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }

  /*
   * Послезавтра
   */

  if (/\bпослезавтра\b/i.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }

  /*
   * Дни недели
   */

  const weekdays = {
    "понедельник": 1,
    "понедельника": 1,

    "вторник": 2,
    "вторника": 2,

    "среда": 3,
    "среду": 3,
    "среды": 3,

    "четверг": 4,
    "четверга": 4,

    "пятница": 5,
    "пятницу": 5,
    "пятницы": 5,

    "суббота": 6,
    "субботу": 6,
    "субботы": 6,

    "воскресенье": 0,
    "воскресенья": 0
  };

  for (const [word, targetDay] of Object.entries(weekdays)) {

    if (new RegExp(`\\b${word}\\b`, "i").test(s)) {

      const currentDay = now.getDay();

      let diff = targetDay - currentDay;

      /*
       * Если день недели сегодня или уже прошёл,
       * выбираем следующий такой день.
       */

      if (diff <= 0) {
        diff += 7;
      }

      const d = new Date(now);
      d.setDate(d.getDate() + diff);

      return formatDate(d);
    }
  }

  return null;
}


/* =========================================================
   TIME
   ========================================================= */

function resolveTaskTime(text) {

  const s = normalize(text);

  /*
   * Полдень
   */

  if (/\bполдень\b/i.test(s)) {
    return "12:00";
  }

  /*
   * Полночь
   */

  if (/\bполночь\b/i.test(s)) {
    return "00:00";
  }

  /*
   * Формат:
   * в 10
   * в 10:00
   * в 10.00
   */

  let match = s.match(
    /\bв\s+(\d{1,2})(?:(?::|\.)(\d{2}))?\s*(утра|дня|вечера|ночи)?\b/i
  );

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  let minute = match[2]
    ? Number(match[2])
    : 0;

  const period = (match[3] || "").toLowerCase();

  if (period === "вечера" && hour < 12) {
    hour += 12;
  }

  if (period === "дня" && hour < 12) {
    hour += 12;
  }

  if (period === "ночи" && hour === 12) {
    hour = 0;
  }

  if (period === "утра" && hour === 12) {
    hour = 0;
  }

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${pad(hour)}:${pad(minute)}`;
}


/* =========================================================
   REPEAT
   ========================================================= */

function resolveRepeatRule(text) {

  const s = normalize(text);

  if (/\bкаждый день\b/i.test(s)) {
    return "daily";
  }

  if (
    /\bпо будням\b/i.test(s) ||
    /\bкаждый будний день\b/i.test(s)
  ) {
    return "weekdays";
  }

  if (/\bкаждую неделю\b/i.test(s)) {
    return "weekly";
  }

  if (/\bкаждый месяц\b/i.test(s)) {
    return "monthly";
  }

  const weekdays = [
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье"
  ];

  for (const day of weekdays) {

    const forms = {
      "понедельник": ["понедельник", "понедельника"],
      "вторник": ["вторник", "вторника"],
      "среда": ["среда", "среду", "среды"],
      "четверг": ["четверг", "четверга"],
      "пятница": ["пятница", "пятницу", "пятницы"],
      "суббота": ["суббота", "субботу", "субботы"],
      "воскресенье": ["воскресенье", "воскресенья"]
    };

    for (const form of forms[day]) {

      const pattern = new RegExp(
        `кажд(?:ый|ую)\\s+${form}`,
        "i"
      );

      if (pattern.test(s)) {
        return `weekly:${day}`;
      }
    }
  }

  return "none";
}


/* =========================================================
   TASK TYPE
   ========================================================= */

function resolveTaskType(text) {

  const s = normalize(text);

  if (
    /\bспектакль\b/i.test(s) ||
    /\bконцерт\b/i.test(s) ||
    /\bмероприятие\b/i.test(s) ||
    /\bвстреча\b/i.test(s) ||
    /\bсобытие\b/i.test(s)
  ) {
    return "event";
  }

  if (
    /\bнапомни\b/i.test(s) ||
    /\bнапомнить\b/i.test(s) ||
    /\bнапоминание\b/i.test(s)
  ) {
    return "reminder";
  }

  return "task";
}


/* =========================================================
   TITLE EXTRACTION
   ========================================================= */

function extractTaskTitle(text) {

  let title = text;

  /*
   * Удаляем явные команды.
   */

  title = title.replace(
    /\b(создай|создать|добавь|добавить|поставь|поставить|запиши|записать|напомни|напомнить|назначь|назначить)\b/gi,
    " "
  );

  /*
   * Удаляем повторение.
   */

  title = title.replace(
    /\bкаждый\s+(день|месяц|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\b/gi,
    " "
  );

  title = title.replace(
    /\bкаждую\s+неделю\b/gi,
    " "
  );

  title = title.replace(
    /\bпо\s+будням\b/gi,
    " "
  );

  /*
   * Удаляем относительные даты.
   */

  title = title.replace(
    /\b(сегодня|завтра|послезавтра)\b/gi,
    " "
  );

  /*
   * Удаляем дни недели.
   */

  title = title.replace(
    /\b(понедельник|понедельника|вторник|вторника|среда|среду|среды|четверг|четверга|пятница|пятницу|пятницы|суббота|субботу|субботы|воскресенье|воскресенья)\b/gi,
    " "
  );

  /*
   * Удаляем дату.
   */

  title = title.replace(
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
    " "
  );

  title = title.replace(
    /\b\d{1,2}[.]\d{1,2}[.](?:20\d{2})\b/g,
    " "
  );

  /*
   * Удаляем время:
   * в 10
   * в 10:00
   * в 10 вечера
   */

  title = title.replace(
    /\bв\s+\d{1,2}(?:(?::|\.)(?:\d{2}))?\s*(?:утра|дня|вечера|ночи)?\b/gi,
    " "
  );

  title = title.replace(
    /\b(полдень|полночь)\b/gi,
    " "
  );

  /*
   * Удаляем "на".
   */

  title = title.replace(
    /\bна\s*$/i,
    " "
  );

  /*
   * Убираем лишние пробелы.
   */

  title = title
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Если осталось начало вроде "в подготовить",
   * убираем одиночные служебные слова.
   */

  title = title.replace(
    /^(в|на|к|для|мне)\s+/i,
    ""
  );

  return title.trim();
}


function cleanTitle(title) {

  return title
    .replace(/^[,.;:—–-]+/, "")
    .replace(/[,.;:—–-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   CREATE TASK
   ========================================================= */

async function createTask(task, env) {

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
    RETURNING
      id,
      user_id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule,
      created_at
  `)
    .bind(
      USER_ID,
      task.title,
      task.task_date,
      task.task_time,
      task.task_type,
      task.repeat_rule || "none"
    )
    .first();

  if (!result) {
    throw new Error("Не удалось создать задачу");
  }

  return result;
}


/* =========================================================
   TASK LIST
   ========================================================= */

async function getTasks(env) {

  const tasks = await loadTasks(env);

  return json({
    ok: true,
    tasks
  });
}


async function loadTasks(env) {

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
    .bind(USER_ID)
    .all();

  return result.results || [];
}


/* =========================================================
   DELETE
   ========================================================= */

function isTaskDeleteCommand(text) {

  return /\b(удали|удалить|убери|убрать|отмени|отменить)\b/i.test(
    normalize(text)
  );
}


async function deleteTaskFromMessage(text, env) {

  const title = extractDeleteTitle(text);

  if (!title) {
    return null;
  }

  const task = await env.DB.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
      AND lower(title) LIKE lower(?)
    ORDER BY id DESC
    LIMIT 1
  `)
    .bind(
      USER_ID,
      `%${title}%`
    )
    .first();

  if (!task) {
    return null;
  }

  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE id = ?
      AND user_id = ?
  `)
    .bind(task.id, USER_ID)
    .run();

  return task;
}


function extractDeleteTitle(text) {

  let title = normalize(text);

  title = title.replace(
    /\b(удали|удалить|убери|убрать|отмени|отменить)\b/gi,
    " "
  );

  title = title.replace(
    /\bзадачу\b/gi,
    " "
  );

  title = title.replace(
    /\s+/g,
    " "
  ).trim();

  return title;
}


/* =========================================================
   COMPLETE
   ========================================================= */

function isTaskCompleteCommand(text) {

  return /\b(выполнил|выполнено|завершил|завершить|готово|сделано|отметь выполненной|отметить выполненной)\b/i
    .test(normalize(text));
}


async function completeTaskFromMessage(text, env) {

  let title = normalize(text);

  title = title.replace(
    /\b(выполнил|выполнено|завершил|завершить|готово|сделано|отметь|отметить|выполненной|выполненной)\b/gi,
    " "
  );

  title = title.replace(
    /\s+/g,
    " "
  ).trim();

  const task = await env.DB.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
      AND lower(title) LIKE lower(?)
    ORDER BY id DESC
    LIMIT 1
  `)
    .bind(
      USER_ID,
      `%${title}%`
    )
    .first();

  if (!task) {
    return null;
  }

  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE id = ?
      AND user_id = ?
  `)
    .bind(task.id, USER_ID)
    .run();

  return task;
}


/* =========================================================
   TASK LIST COMMAND
   ========================================================= */

function isTaskListCommand(text) {

  const s = normalize(text);

  return (
    /\bмои задачи\b/i.test(s) ||
    /\bсписок задач\b/i.test(s) ||
    /\bпокажи задачи\b/i.test(s) ||
    /\bкакие задачи\b/i.test(s) ||
    /\bчто у меня сегодня\b/i.test(s) ||
    /\bчто у меня завтра\b/i.test(s) ||
    /\bчто запланировано\b/i.test(s) ||
    /\bрасписание\b/i.test(s)
  );
}


function buildTaskListReply(tasks) {

  if (!tasks.length) {
    return "Активных задач сейчас нет.";
  }

  const lines = tasks.map((task, index) => {

    const date =
      task.task_date
        ? formatDisplayDate(task.task_date)
        : "дата не указана";

    const time =
      task.task_time
        ? task.task_time
        : "";

    return `${index + 1}. ${task.title} — ${date}${time ? `, ${time}` : ""}`;
  });

  return `Активные задачи:\n${lines.join("\n")}`;
}


/* =========================================================
   REPLIES
   ========================================================= */

function buildTaskCreatedReply(task) {

  let when = "";

  if (task.task_date) {
    when += formatDisplayDate(task.task_date);
  }

  if (task.task_time) {
    when += ` в ${task.task_time}`;
  }

  if (!when) {
    when = "без указанной даты";
  }

  let typeText = "";

  if (task.task_type === "event") {
    typeText = "событие";
  } else if (task.task_type === "reminder") {
    typeText = "напоминание";
  } else {
    typeText = "задачу";
  }

  let repeatText = "";

  if (
    task.repeat_rule &&
    task.repeat_rule !== "none"
  ) {
    repeatText = ` Повтор: ${formatRepeat(task.repeat_rule)}.`;
  }

  return `Добавил ${typeText}: «${task.title}» — ${when}.${repeatText} ID: ${task.id}.`;
}


function formatRepeat(rule) {

  const map = {
    daily: "каждый день",
    weekdays: "по будням",
    weekly: "каждую неделю",
    monthly: "каждый месяц",

    "weekly:понедельник": "каждый понедельник",
    "weekly:вторник": "каждый вторник",
    "weekly:среда": "каждую среду",
    "weekly:четверг": "каждый четверг",
    "weekly:пятница": "каждую пятницу",
    "weekly:суббота": "каждую субботу",
    "weekly:воскресенье": "каждое воскресенье"
  };

  return map[rule] || rule;
}


/* =========================================================
   MEMORY
   ========================================================= */

async function saveMemory(env, role, content) {

  await env.DB.prepare(`
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


async function getRecentMemory(env) {

  const result = await env.DB.prepare(`
    SELECT role, content
    FROM memory
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 12
  `)
    .bind(USER_ID)
    .all();

  return (result.results || []).reverse();
}


async function getFacts(env) {

  const result = await env.DB.prepare(`
    SELECT category, fact
    FROM facts
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 30
  `)
    .bind(USER_ID)
    .all();

  return result.results || [];
}


/* =========================================================
   SYSTEM PROMPT
   ========================================================= */

function buildSystemPrompt(facts) {

  const factText = facts.length
    ? facts
        .map(item => `- ${item.category}: ${item.fact}`)
        .join("\n")
    : "Пока сохранённых фактов нет.";

  return `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твоя роль:
- персональный помощник;
- организатор;
- интеллектуальный собеседник;
- помощник в учёбе;
- помощник в работе;
- планировщик;
- аналитик;
- технический помощник.

Общайся на русском языке.

Стиль:
- спокойно;
- уверенно;
- естественно;
- умно;
- кратко, когда вопрос простой;
- подробно, когда задача требует объяснения.

Не называй пользователя "клиентом".

Не выдумывай факты.

ВАЖНО:
Команды задач уже обрабатываются системой до обращения к тебе.
Если пользователь спрашивает о создании задачи, не утверждай, что задача создана, если система не передала тебе подтверждение.

Сохранённые сведения о пользователе:
${factText}
`;
}


/* =========================================================
   AI RESPONSE EXTRACTION
   ========================================================= */

function extractAIText(result) {

  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result.trim();
  }

  if (typeof result.response === "string") {
    return result.response.trim();
  }

  if (typeof result.output_text === "string") {
    return result.output_text.trim();
  }

  if (
    result.choices &&
    result.choices[0] &&
    result.choices[0].message
  ) {
    const content =
      result.choices[0].message.content;

    if (typeof content === "string") {
      return content.trim();
    }
  }

  return "";
}


/* =========================================================
   HEALTH
   ========================================================= */

async function health(env) {

  const result = {
    ok: true,
    service: "J.A.R.V.I.S.",
    version: VERSION,
    database: false,
    ai: false
  };

  try {

    await env.DB.prepare(`
      SELECT 1
    `).first();

    result.database = true;

  } catch (error) {

    result.database = false;
    result.database_error = error?.message;
  }


  try {

    const ai = await env.AI.run(MODEL, {
      messages: [
        {
          role: "user",
          content: "Ответь одним словом: OK"
        }
      ],
      max_completion_tokens: 20,
      temperature: 0,
      chat_template_kwargs: {
        enable_thinking: false
      }
    });

    result.ai = !!extractAIText(ai);

  } catch (error) {

    result.ai = false;
    result.ai_error = error?.message;
  }


  return json(result);
}


/* =========================================================
   UTILITIES
   ========================================================= */

function normalize(text) {

  return String(text || "")
    .replace(/[«»“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function pad(value) {

  return String(value).padStart(2, "0");
}


function formatDate(date) {

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}-${month}-${day}`;
}


function formatDisplayDate(dateString) {

  if (!dateString) {
    return "";
  }

  const parts = dateString.split("-");

  if (parts.length !== 3) {
    return dateString;
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8"
      }
    }
  );
}


function html(content) {

  return new Response(
    content,
    {
      headers: {
        "content-type": "text/html; charset=UTF-8"
      }
    }
  );
}


/* =========================================================
   MOBILE WEB UI
   ========================================================= */

function homePage() {

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width,
               initial-scale=1,
               maximum-scale=1">

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #05070a;
  color: #e8edf2;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {
  max-width: 720px;
  margin: auto;
  padding: 20px;
}

.header {
  text-align: center;
  padding: 24px 0;
}

.logo {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 5px;
}

.subtitle {
  color: #8793a0;
  margin-top: 8px;
}

.chat {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  padding: 14px 16px;
  border-radius: 16px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.user {
  background: #17202b;
  align-self: flex-end;
}

.jarvis {
  background: #0d1218;
  border: 1px solid #202a35;
  align-self: flex-start;
}

.input-area {
  position: sticky;
  bottom: 0;
  background: #05070a;
  padding: 14px 0;
  display: flex;
  gap: 8px;
}

input {
  flex: 1;
  background: #10151b;
  color: white;
  border: 1px solid #27313c;
  border-radius: 14px;
  padding: 14px;
  font-size: 16px;
  outline: none;
}

button {
  border: 0;
  border-radius: 14px;
  padding: 0 18px;
  background: #dce7f0;
  color: #080b0e;
  font-weight: 600;
}

button:active {
  transform: scale(.97);
}

</style>
</head>

<body>

<div class="container">

  <div class="header">
    <div class="logo">J.A.R.V.I.S.</div>
    <div class="subtitle">
      Personal Intelligence System
    </div>
  </div>

  <div id="chat" class="chat"></div>

  <div class="input-area">
    <input
      id="message"
      type="text"
      placeholder="Введите команду..."
      autocomplete="off"
    />

    <button onclick="sendMessage()">
      Отправить
    </button>
  </div>

</div>


<script>

const input = document.getElementById("message");
const chat = document.getElementById("chat");

function addMessage(text, type) {

  const div = document.createElement("div");

  div.className =
    "message " + type;

  div.textContent = text;

  chat.appendChild(div);

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

  addMessage(message, "user");

  input.value = "";

  try {

    const response =
      await fetch("/chat", {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          message
        })
      });

    const data =
      await response.json();

    addMessage(
      data.reply ||
      data.error ||
      "Нет ответа.",
      "jarvis"
    );

  } catch (error) {

    addMessage(
      "Ошибка соединения: " +
      error.message,
      "jarvis"
    );
  }
}


input.addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {
      sendMessage();
    }

  }
);

</script>

</body>
</html>`;
}
