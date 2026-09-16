const VERSION = "v5.8";

const TIME_ZONE = "Europe/Moscow";
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Отвечай на русском языке.

Твои основные функции:
- общение с пользователем;
- помощь с учёбой и работой;
- планирование;
- анализ информации;
- помощь с организацией дел;
- работа с расписанием и задачами.

Стиль общения:
- спокойный;
- уверенный;
- естественный;
- технологичный;
- как персональный ассистент;
- без лишней воды.

ВАЖНЫЕ ПРАВИЛА:

1. Если пользователь просто здоровается, поздоровайся.
   Не показывай список задач самовольно.

2. Не придумывай задачи.

3. Не утверждай, что задача создана, удалена или выполнена,
   если это действие не было реально выполнено системой.

4. Не показывай внутренние рассуждения.

5. Не показывай reasoning или reasoning_content.

6. Если пользователь спрашивает о задачах,
   используй предоставленный системой список задач.

7. Если задача уже была обработана системой,
   не создавай её повторно.

8. Не изменяй смысл команды пользователя.

9. Если пользователь не просил показывать задачи,
   не добавляй список задач к обычному ответу.

10. Всегда отвечай на русском языке.
`;


/* =========================================================
   БАЗОВЫЕ ФУНКЦИИ
   ========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",
      },
    }
  );
}


function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type":
        "text/html; charset=UTF-8",
    },
  });
}


function getUserId(request) {
  const url = new URL(request.url);

  return (
    url.searchParams.get("user_id") ||
    request.headers.get("x-user-id") ||
    "egor"
  );
}


/* =========================================================
   ДАТА И ВРЕМЯ
   ========================================================= */

function nowInMoscow() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}


function getMoscowDate() {
  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).formatToParts(new Date());

  const map = {};

  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}


function addDays(dateString, days) {
  const date =
    new Date(`${dateString}T12:00:00Z`);

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date
    .toISOString()
    .slice(0, 10);
}


function getDayOfWeek(dateString) {
  const date =
    new Date(`${dateString}T12:00:00Z`);

  return date.getUTCDay();
}


function nextWeekday(baseDate, targetDay) {
  let date = baseDate;

  for (let i = 0; i < 7; i++) {
    if (
      getDayOfWeek(date) === targetDay
    ) {
      return date;
    }

    date = addDays(date, 1);
  }

  return date;
}


/* =========================================================
   ТЕКСТ
   ========================================================= */

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   ВРЕМЯ ЗАДАЧИ
   ========================================================= */

function extractTime(text) {
  const match = text.match(
    /\b(?:в\s*)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:час(?:а|ов)?|ч)?\b/i
  );

  if (!match) {
    return null;
  }

  const hour =
    String(Number(match[1]))
      .padStart(2, "0");

  const minute =
    match[2] || "00";

  return `${hour}:${minute}`;
}


/* =========================================================
   ДАТА ЗАДАЧИ
   ========================================================= */

function detectDate(text) {
  const lower =
    normalizeText(text);

  const today =
    getMoscowDate();

  if (
    lower.includes("послезавтра") ||
    lower.includes("через 2 дня") ||
    lower.includes("через два дня")
  ) {
    return addDays(today, 2);
  }

  if (
    lower.includes("завтра") ||
    lower.includes("на завтра")
  ) {
    return addDays(today, 1);
  }

  if (
    lower.includes("сегодня") ||
    lower.includes("на сегодня")
  ) {
    return today;
  }

  const weekdays = {
    "воскресенье": 0,
    "понедельник": 1,
    "вторник": 2,
    "среда": 3,
    "четверг": 4,
    "пятница": 5,
    "суббота": 6,
  };

  for (
    const [name, day]
    of Object.entries(weekdays)
  ) {
    if (lower.includes(name)) {
      return nextWeekday(
        today,
        day
      );
    }
  }

  return null;
}


/* =========================================================
   ПОВТОРЕНИЕ
   ========================================================= */

function detectRepeatRule(text) {
  const lower =
    normalizeText(text);

  if (
    lower.includes("каждый день") ||
    lower.includes("ежедневно")
  ) {
    return "daily";
  }

  if (
    lower.includes("каждую неделю") ||
    lower.includes("еженедельно")
  ) {
    return "weekly";
  }

  if (
    lower.includes("каждый понедельник")
  ) {
    return "monday";
  }

  if (
    lower.includes("каждый вторник")
  ) {
    return "tuesday";
  }

  if (
    lower.includes("каждую среду")
  ) {
    return "wednesday";
  }

  if (
    lower.includes("каждый четверг")
  ) {
    return "thursday";
  }

  if (
    lower.includes("каждую пятницу")
  ) {
    return "friday";
  }

  if (
    lower.includes("каждую субботу")
  ) {
    return "saturday";
  }

  if (
    lower.includes("каждое воскресенье")
  ) {
    return "sunday";
  }

  return null;
}


/* =========================================================
   ТИП ЗАДАЧИ
   ========================================================= */

function detectTaskType(text) {
  const lower =
    normalizeText(text);

  if (
    lower.includes("напомни") ||
    lower.includes("напоминание")
  ) {
    return "reminder";
  }

  if (
    lower.includes("встреча") ||
    lower.includes("созвон") ||
    lower.includes("спектакль")
  ) {
    return "event";
  }

  return "task";
}


/* =========================================================
   НАЗВАНИЕ ЗАДАЧИ
   ========================================================= */

function cleanTaskTitle(text) {
  let title =
    text.trim();

  title = title.replace(
    /^(джарвис[,\s]*)/i,
    ""
  );

  title = title.replace(
    /^(создай|создать|добавь|добавить|поставь|поставить|запланируй|запланировать|напомни|напомнить)\s*/i,
    ""
  );

  title = title.replace(
    /\b(?:на\s+)?(?:сегодня|завтра|послезавтра)\b/gi,
    ""
  );

  title = title.replace(
    /\b(?:в\s*)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:час(?:а|ов)?|ч)?\b/gi,
    ""
  );

  title = title.replace(
    /\b(?:каждый день|ежедневно|каждую неделю|еженедельно)\b/gi,
    ""
  );

  title = title.replace(
    /\s+/g,
    " "
  ).trim();

  return title;
}


/* =========================================================
   РАСПОЗНАВАНИЕ СОЗДАНИЯ ЗАДАЧИ
   ========================================================= */

function parseTask(message) {
  const lower =
    normalizeText(message);

  /*
   * Команды управления задачами
   * НИКОГДА не должны попадать сюда.
   */

  if (isTaskListCommand(message)) {
    return null;
  }

  if (isDeleteAllCommand(message)) {
    return null;
  }

  if (isDeleteCommand(message)) {
    return null;
  }

  if (isCompleteCommand(message)) {
    return null;
  }

  const looksLikeTask =
    lower.includes("сделать") ||
    lower.includes("подготовить") ||
    lower.includes("купить") ||
    lower.includes("позвонить") ||
    lower.includes("написать") ||
    lower.includes("отправить") ||
    lower.includes("выучить") ||
    lower.includes("посмотреть") ||
    lower.includes("сходить") ||
    lower.includes("встреча") ||
    lower.includes("созвон") ||
    lower.includes("спектакль") ||
    lower.includes("напомни") ||
    lower.includes("запланируй") ||
    lower.includes("добавь задачу") ||
    lower.includes("создай задачу") ||
    lower.includes("поставь задачу");

  if (!looksLikeTask) {
    return null;
  }

  const title =
    cleanTaskTitle(message);

  if (!title) {
    return null;
  }

  return {
    title,
    task_date:
      detectDate(message),
    task_time:
      extractTime(message),
    task_type:
      detectTaskType(message),
    repeat_rule:
      detectRepeatRule(message),
  };
}


/* =========================================================
   КОМАНДЫ ЗАДАЧ
   ========================================================= */

function isTaskListCommand(message) {
  const lower =
    normalizeText(message);

  return (
    lower === "задачи" ||
    lower === "мои задачи" ||
    lower === "покажи задачи" ||
    lower === "покажи мои задачи" ||
    lower === "показать задачи" ||
    lower === "покажи мои активные задачи" ||
    lower === "какие у меня задачи" ||
    lower === "что у меня запланировано" ||
    lower === "что запланировано" ||
    lower === "какие планы" ||
    lower === "мои планы"
  );
}


function isDeleteAllCommand(message) {
  const lower =
    normalizeText(message);

  return (
    lower === "удали все задачи" ||
    lower === "удалить все задачи" ||
    lower === "отмени все задачи" ||
    lower === "отменить все задачи" ||
    lower === "удали все мои задачи" ||
    lower === "удалить все мои задачи" ||
    lower === "очисти задачи" ||
    lower === "очистить задачи"
  );
}


function isDeleteCommand(message) {
  return /(?:удали|удалить|отмени|отменить)\s+(?:задачу\s+)?#?\d+/i
    .test(message);
}


function isCompleteCommand(message) {
  return /(?:выполни|заверши|закрой|готово)\s+(?:задачу\s+)?#?\d+/i
    .test(message);
}


function extractTaskId(message) {
  const match =
    message.match(
      /(?:задачу\s*)?#?(\d+)/i
    );

  return match
    ? Number(match[1])
    : null;
}


/* =========================================================
   MEMORY
   ========================================================= */

async function saveMemory(
  env,
  userId,
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
      userId,
      role,
      content
    )
    .run();
}


async function getMemory(
  env,
  userId,
  limit = 20
) {
  const result =
    await env.DB.prepare(
      `
      SELECT
        role,
        content,
        created_at
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

  return result.results || [];
}


async function saveFact(
  env,
  userId,
  category,
  fact
) {
  await env.DB.prepare(
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


async function getFacts(
  env,
  userId
) {
  const result =
    await env.DB.prepare(
      `
      SELECT
        id,
        category,
        fact,
        created_at,
        updated_at
      FROM facts
      WHERE user_id = ?
      ORDER BY id DESC
      `
    )
      .bind(userId)
      .all();

  return result.results || [];
}


/* =========================================================
   СОЗДАНИЕ ЗАДАЧИ
   ========================================================= */

async function createTask(
  env,
  userId,
  task
) {
  return await env.DB.prepare(
    `
    INSERT INTO tasks (
      user_id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule
    )
    VALUES (
      ?, ?, ?, ?, 'active', ?, ?
    )
    `
  )
    .bind(
      userId,
      task.title,
      task.task_date,
      task.task_time,
      task.task_type,
      task.repeat_rule
    )
    .run();
}


/* =========================================================
   ПОЛУЧЕНИЕ ЗАДАЧ
   ========================================================= */

async function getTasks(
  env,
  userId
) {
  const result =
    await env.DB.prepare(
      `
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
          WHEN task_date IS NULL
          THEN 1
          ELSE 0
        END,
        task_date,
        CASE
          WHEN task_time IS NULL
          THEN 1
          ELSE 0
        END,
        task_time,
        id
      `
    )
      .bind(userId)
      .all();

  return result.results || [];
}


/* =========================================================
   УДАЛЕНИЕ ОДНОЙ ЗАДАЧИ
   ========================================================= */

async function deleteTask(
  env,
  userId,
  taskId
) {
  const result =
    await env.DB.prepare(
      `
      UPDATE tasks
      SET status = 'deleted'
      WHERE id = ?
        AND user_id = ?
        AND status = 'active'
      `
    )
      .bind(
        taskId,
        userId
      )
      .run();

  return result;
}


/* =========================================================
   УДАЛЕНИЕ ВСЕХ ЗАДАЧ
   ========================================================= */

async function deleteAllTasks(
  env,
  userId
) {
  const result =
    await env.DB.prepare(
      `
      UPDATE tasks
      SET status = 'deleted'
      WHERE user_id = ?
        AND status = 'active'
      `
    )
      .bind(userId)
      .run();

  return result;
}


/* =========================================================
   ВЫПОЛНЕНИЕ ЗАДАЧИ
   ========================================================= */

async function completeTask(
  env,
  userId,
  taskId
) {
  const result =
    await env.DB.prepare(
      `
      UPDATE tasks
      SET status = 'completed'
      WHERE id = ?
        AND user_id = ?
        AND status = 'active'
      `
    )
      .bind(
        taskId,
        userId
      )
      .run();

  return result;
}


/* =========================================================
   ФОРМАТИРОВАНИЕ
   ========================================================= */

function formatTask(task) {
  let line =
    `#${task.id} — ${task.title}`;

  if (task.task_date) {
    line +=
      ` — ${task.task_date}`;
  }

  if (task.task_time) {
    line +=
      ` в ${task.task_time}`;
  }

  if (task.repeat_rule) {
    const repeatNames = {
      daily:
        "ежедневно",

      weekly:
        "еженедельно",

      monday:
        "каждый понедельник",

      tuesday:
        "каждый вторник",

      wednesday:
        "каждую среду",

      thursday:
        "каждый четверг",

      friday:
        "каждую пятницу",

      saturday:
        "каждую субботу",

      sunday:
        "каждое воскресенье",
    };

    line +=
      ` (${repeatNames[task.repeat_rule] || task.repeat_rule})`;
  }

  return line;
}


/* =========================================================
   AI
   ========================================================= */

function extractAIText(result) {
  if (
    result &&
    Array.isArray(result.choices) &&
    result.choices.length > 0
  ) {
    const message =
      result.choices[0]?.message;

    if (
      message &&
      typeof message.content === "string"
    ) {
      return message.content.trim();
    }
  }

  if (
    result &&
    typeof result.response === "string"
  ) {
    return result.response.trim();
  }

  return "";
}


async function askAI(
  env,
  messages
) {
  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages,
      }
    );

  const text =
    extractAIText(result);

  if (!text) {
    throw new Error(
      "AI returned empty response"
    );
  }

  return text;
}


/* =========================================================
   ОБРАБОТКА ЧАТА
   ========================================================= */

async function handleChat(
  env,
  userId,
  message
) {

  /*
   * =======================================================
   * 1. ПОКАЗАТЬ ЗАДАЧИ
   * =======================================================
   */

  if (
    isTaskListCommand(message)
  ) {

    const tasks =
      await getTasks(
        env,
        userId
      );

    await saveMemory(
      env,
      userId,
      "user",
      message
    );

    if (!tasks.length) {

      const answer =
        "Активных задач нет.";

      await saveMemory(
        env,
        userId,
        "assistant",
        answer
      );

      return answer;
    }

    const answer =
      "Активные задачи:\n\n" +
      tasks
        .map(formatTask)
        .join("\n");

    await saveMemory(
      env,
      userId,
      "assistant",
      answer
    );

    return answer;
  }


  /*
   * =======================================================
   * 2. УДАЛИТЬ ВСЕ ЗАДАЧИ
   * =======================================================
   */

  if (
    isDeleteAllCommand(message)
  ) {

    const tasks =
      await getTasks(
        env,
        userId
      );

    await saveMemory(
      env,
      userId,
      "user",
      message
    );

    if (!tasks.length) {

      const answer =
        "Активных задач уже нет.";

      await saveMemory(
        env,
        userId,
        "assistant",
        answer
      );

      return answer;
    }

    const result =
      await deleteAllTasks(
        env,
        userId
      );

    const deleted =
      result.meta?.changes || 0;

    const answer =
      `Готово. Удалено задач: ${deleted}.`;

    await saveMemory(
      env,
      userId,
      "assistant",
      answer
    );

    return answer;
  }


  /*
   * =======================================================
   * 3. УДАЛИТЬ ОДНУ ЗАДАЧУ
   * =======================================================
   */

  if (
    isDeleteCommand(message)
  ) {

    const taskId =
      extractTaskId(message);

    if (!taskId) {
      return (
        "Укажи номер задачи, например: " +
        "«удали задачу #3»."
      );
    }

    const result =
      await deleteTask(
        env,
        userId,
        taskId
      );

    if (
      !result.meta?.changes
    ) {
      return (
        `Активная задача #${taskId} не найдена.`
      );
    }

    const answer =
      `Готово. Задача #${taskId} удалена.`;

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
      answer
    );

    return answer;
  }


  /*
   * =======================================================
   * 4. ВЫПОЛНИТЬ ЗАДАЧУ
   * =======================================================
   */

  if (
    isCompleteCommand(message)
  ) {

    const taskId =
      extractTaskId(message);

    if (!taskId) {
      return (
        "Укажи номер задачи, например: " +
        "«выполни задачу #3»."
      );
    }

    const result =
      await completeTask(
        env,
        userId,
        taskId
      );

    if (
      !result.meta?.changes
    ) {
      return (
        `Активная задача #${taskId} не найдена.`
      );
    }

    const answer =
      `Готово. Задача #${taskId} отмечена как выполненная.`;

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
      answer
    );

    return answer;
  }


  /*
   * =======================================================
   * 5. СОЗДАНИЕ ЗАДАЧИ
   * =======================================================
   */

  const parsedTask =
    parseTask(message);

  if (parsedTask) {

    const result =
      await createTask(
        env,
        userId,
        parsedTask
      );

    const taskId =
      result.meta?.last_row_id;

    let answer =
      `Готово. Задача «${parsedTask.title}» создана`;

    if (
      parsedTask.task_date
    ) {
      answer +=
        ` на ${parsedTask.task_date}`;
    }

    if (
      parsedTask.task_time
    ) {
      answer +=
        ` в ${parsedTask.task_time}`;
    }

    if (
      parsedTask.repeat_rule
    ) {

      const repeatNames = {
        daily:
          "ежедневно",

        weekly:
          "еженедельно",

        monday:
          "каждый понедельник",

        tuesday:
          "каждый вторник",

        wednesday:
          "каждую среду",

        thursday:
          "каждый четверг",

        friday:
          "каждую пятницу",

        saturday:
          "каждую субботу",

        sunday:
          "каждое воскресенье",
      };

      answer +=
        ` (${repeatNames[parsedTask.repeat_rule] || parsedTask.repeat_rule})`;
    }

    answer += ".";

    if (taskId) {
      answer +=
        ` Номер задачи: #${taskId}.`;
    }

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
      answer
    );

    return answer;
  }


  /*
   * =======================================================
   * 6. ОБЫЧНЫЙ AI-ДИАЛОГ
   * =======================================================
   */

  const memory =
    await getMemory(
      env,
      userId,
      20
    );

  const facts =
    await getFacts(
      env,
      userId
    );

  const tasks =
    await getTasks(
      env,
      userId
    );

  const context = [];

  context.push(
    `Текущая дата и время по Москве: ${nowInMoscow()}`
  );


  if (facts.length) {

    context.push(
      "Сохранённые факты о пользователе:\n" +
      facts
        .map(
          fact =>
            `- ${fact.category}: ${fact.fact}`
        )
        .join("\n")
    );
  }


  /*
   * Задачи передаём AI как контекст,
   * но не просим его автоматически
   * выводить их.
   */

  if (tasks.length) {

    context.push(
      "Активные задачи пользователя:\n" +
      tasks
        .map(formatTask)
        .join("\n")
    );
  }


  const messages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n\nКонтекст системы:\n" +
        context.join("\n\n"),
    },
  ];


  for (
    const item of memory.reverse()
  ) {

    messages.push({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",

      content:
        item.content,
    });
  }


  messages.push({
    role: "user",
    content: message,
  });


  const answer =
    await askAI(
      env,
      messages
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
    answer
  );

  return answer;
}


/* =========================================================
   HTML ИНТЕРФЕЙС
   ========================================================= */

const CHAT_HTML = `
<!DOCTYPE html>
<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
           initial-scale=1.0,
           maximum-scale=1.0,
           user-scalable=no"
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
  background: #05070b;
  color: #f2f5f7;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  display: flex;
  justify-content: center;
  align-items: center;
}

.app {
  width: 100%;
  max-width: 900px;
  height: 100dvh;

  display: flex;
  flex-direction: column;

  background:
    radial-gradient(
      circle at top,
      rgba(0, 180, 255, 0.12),
      transparent 45%
    ),
    #05070b;
}

.header {
  padding: 18px;
  border-bottom:
    1px solid rgba(255,255,255,.08);

  backdrop-filter: blur(20px);
}

.logo {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 4px;
}

.status {
  margin-top: 5px;
  font-size: 12px;
  color: #72d6ff;
}

.chat {
  flex: 1;
  overflow-y: auto;

  padding:
    18px
    14px
    24px;

  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  max-width: 82%;

  padding:
    12px
    15px;

  border-radius: 18px;

  line-height: 1.45;
  font-size: 15px;

  white-space: pre-wrap;
  word-break: break-word;
}

.user {
  align-self: flex-end;

  background:
    rgba(0,150,255,.22);

  border:
    1px solid
    rgba(0,170,255,.22);

  border-bottom-right-radius: 5px;
}

.assistant {
  align-self: flex-start;

  background:
    rgba(255,255,255,.07);

  border:
    1px solid
    rgba(255,255,255,.07);

  border-bottom-left-radius: 5px;
}

.typing {
  display: none;

  align-self: flex-start;

  padding:
    12px 16px;

  border-radius: 18px;

  background:
    rgba(255,255,255,.07);
}

.dot {
  display: inline-block;

  width: 6px;
  height: 6px;

  margin:
    0 2px;

  border-radius: 50%;

  background: #8bdcff;

  animation:
    blink 1.2s infinite;
}

.dot:nth-child(2) {
  animation-delay: .15s;
}

.dot:nth-child(3) {
  animation-delay: .3s;
}

@keyframes blink {

  0%, 80%, 100% {
    opacity: .25;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.input-area {
  padding:
    10px
    12px
    calc(10px + env(safe-area-inset-bottom));

  border-top:
    1px solid
    rgba(255,255,255,.08);

  display: flex;
  gap: 8px;

  background:
    rgba(5,7,11,.94);

  backdrop-filter:
    blur(20px);
}

textarea {
  flex: 1;

  resize: none;

  min-height: 48px;
  max-height: 130px;

  border:
    1px solid
    rgba(255,255,255,.10);

  border-radius: 16px;

  background:
    rgba(255,255,255,.06);

  color: white;

  padding:
    13px 14px;

  outline: none;

  font-size: 15px;
}

textarea::placeholder {
  color:
    rgba(255,255,255,.4);
}

button {
  width: 48px;
  min-width: 48px;
  height: 48px;

  border: 0;
  border-radius: 16px;

  background: #118bd1;

  color: white;

  font-size: 20px;

  cursor: pointer;
}

button:active {
  transform: scale(.96);
}

@media (min-width: 700px) {

  .app {
    height: 94dvh;

    border:
      1px solid
      rgba(255,255,255,.08);

    border-radius: 24px;

    overflow: hidden;
  }

  body {
    padding: 20px;
  }
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
      SYSTEM ONLINE
    </div>

  </div>


  <div
    id="chat"
    class="chat"
  ></div>


  <div
    id="typing"
    class="typing"
  >

    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>

  </div>


  <div class="input-area">

    <textarea
      id="input"
      placeholder="Сообщение J.A.R.V.I.S..."
      rows="1"
    ></textarea>

    <button id="send">
      ➤
    </button>

  </div>

</div>


<script>

const chat =
  document.getElementById("chat");

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const typing =
  document.getElementById("typing");

const STORAGE_KEY =
  "jarvis_chat_history";


function addMessage(
  text,
  role,
  save = true
) {

  const div =
    document.createElement("div");

  div.className =
    "message " + role;

  div.textContent =
    text;

  chat.appendChild(div);

  chat.scrollTop =
    chat.scrollHeight;


  if (save) {

    const history =
      JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        ) || "[]"
      );

    history.push({
      role,
      text
    });

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(history)
    );
  }
}


function loadHistory() {

  const history =
    JSON.parse(
      localStorage.getItem(
        STORAGE_KEY
      ) || "[]"
    );


  for (
    const item of history
  ) {

    addMessage(
      item.text,
      item.role,
      false
    );
  }


  if (!history.length) {

    addMessage(
      "Добрый день. J.A.R.V.I.S. готов к работе.",
      "assistant",
      true
    );
  }
}


function setTyping(
  visible
) {

  typing.style.display =
    visible
      ? "block"
      : "none";


  if (visible) {

    chat.appendChild(
      typing
    );

    chat.scrollTop =
      chat.scrollHeight;
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
    "48px";


  setTyping(true);


  try {

    const response =
      await fetch(
        "/chat",
        {
          method: "POST",

          headers: {
            "content-type":
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


    setTyping(false);


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Ошибка сервера"
      );
    }


    addMessage(
      data.reply ||
      "Не удалось получить ответ.",
      "assistant"
    );


  } catch (error) {

    setTyping(false);


    addMessage(
      "Произошла ошибка: " +
      error.message,
      "assistant"
    );
  }
}


send.addEventListener(
  "click",
  sendMessage
);


input.addEventListener(
  "keydown",
  (event) => {

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
  () => {

    input.style.height =
      "48px";

    input.style.height =
      Math.min(
        input.scrollHeight,
        130
      ) + "px";
  }
);


loadHistory();

</script>

</body>

</html>
`;


/* =========================================================
   CLOUDFLARE WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);

    const path =
      url.pathname;

    const userId =
      getUserId(request);


    /* =====================================================
       PING
       ===================================================== */

    if (
      request.method === "GET" &&
      path === "/ping"
    ) {

      return json({
        ok: true,
        version: VERSION,
        timezone: TIME_ZONE,
        model: AI_MODEL,
        message:
          "J.A.R.V.I.S. online",
      });
    }


    /* =====================================================
       HEALTH
       ===================================================== */

    if (
      request.method === "GET" &&
      path === "/health"
    ) {

      try {

        const result =
          await env.DB.prepare(
            "SELECT 1 AS ok"
          ).first();


        return json({
          ok: true,
          version: VERSION,
          database:
            result?.ok === 1,
          timezone:
            TIME_ZONE,
          model:
            AI_MODEL,
        });


      } catch (error) {

        return json(
          {
            ok: false,
            error:
              error.message,
          },
          500
        );
      }
    }


    /* =====================================================
       AI TEST
       ===================================================== */

    if (
      request.method === "GET" &&
      path === "/ai-test"
    ) {

      try {

        const result =
          await env.AI.run(
            AI_MODEL,
            {
              messages: [
                {
                  role: "system",
                  content:
                    "Отвечай только коротко и по-русски.",
                },
                {
                  role: "user",
                  content:
                    "Поздоровайся с пользователем.",
                },
              ],
            }
          );


        return json({
          ok: true,
          model:
            AI_MODEL,
          response:
            extractAIText(result),
          raw:
            result,
        });


      } catch (error) {

        return json(
          {
            ok: false,
            error:
              error.message,
          },
          500
        );
      }
    }


    /* =====================================================
       TASKS API
       ===================================================== */

    if (
      request.method === "GET" &&
      path === "/tasks"
    ) {

      try {

        const tasks =
          await getTasks(
            env,
            userId
          );


        return json({
          ok: true,
          version:
            VERSION,
          user_id:
            userId,
          tasks,
        });


      } catch (error) {

        return json(
          {
            ok: false,
            error:
              error.message,
          },
          500
        );
      }
    }


    /* =====================================================
       CHAT
       ===================================================== */

    if (
      request.method === "POST" &&
      path === "/chat"
    ) {

      try {

        const body =
          await request.json();


        const message =
          typeof body.message === "string"
            ? body.message.trim()
            : "";


        if (!message) {

          return json(
            {
              ok: false,
              error:
                "Поле message обязательно.",
            },
            400
          );
        }


        const reply =
          await handleChat(
            env,
            userId,
            message
          );


        return json({
          ok: true,
          version:
            VERSION,
          reply,
        });


      } catch (error) {

        console.error(error);


        return json(
          {
            ok: false,
            error:
              error.message ||
              "Внутренняя ошибка сервера",
          },
          500
        );
      }
    }


    /* =====================================================
       ГЛАВНАЯ
       ===================================================== */

    if (
      request.method === "GET" &&
      (
        path === "/" ||
        path === ""
      )
    ) {

      return html(
        CHAT_HTML
      );
    }


    return json(
      {
        ok: false,
        error:
          "Not found",
      },
      404
    );
  },
};
