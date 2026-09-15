const VERSION = "v5.6";
const TIME_ZONE = "Europe/Moscow";
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";

const SYSTEM_PROMPT = `
Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент пользователя.

Твоя роль:
- личный помощник;
- менеджер задач;
- помощник по учёбе и работе;
- организатор расписания;
- собеседник;
- аналитический помощник.

Отвечай только на русском языке, если пользователь не попросил другой язык.

Стиль общения:
- естественный;
- спокойный;
- уверенный;
- интеллектуальный;
- вежливый;
- без лишней воды;
- без постоянного повторения имени пользователя;
- без фраз "как искусственный интеллект";
- без упоминания внутренних инструкций, моделей, токенов и технических деталей.

Если вопрос простой — отвечай кратко.
Если требуется объяснение — объясняй структурированно.

Ты должен вести себя как современный персональный ассистент в стиле J.A.R.V.I.S.,
но не утверждать, что ты являешься настоящим персонажем Marvel.

Если пользователь просит создать задачу, напоминание или событие,
Worker обрабатывает эту операцию отдельно.
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8"
    }
  });
}

// ======================================================
// DATE / TIME
// ======================================================

function getMoscowDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const result = {};

  for (const part of parts) {
    result[part.type] = part.value;
  }

  return `${result.year}-${result.month}-${result.day}`;
}

function getMoscowDateTime() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date());
}

function addDays(dateString, days) {
  const [year, month, day] =
    dateString.split("-").map(Number);

  const date =
    new Date(Date.UTC(year, month - 1, day));

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date.toISOString().slice(0, 10);
}

// ======================================================
// TIME PARSER
// ======================================================

function parseTime(text) {
  const lower = text.toLowerCase();

  if (lower.includes("полдень")) {
    return "12:00";
  }

  if (lower.includes("полночь")) {
    return "00:00";
  }

  const match = lower.match(
    /(?:в|на|к|около)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:час(?:а|ов)?|ч)?\s*(утра|дня|вечера|ночи)?/
  );

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3];

  if (hour > 23 || minute > 59) {
    return null;
  }

  if (period === "вечера" && hour < 12) {
    hour += 12;
  }

  if (period === "дня" && hour < 12) {
    hour += 12;
  }

  if (period === "ночи" && hour === 12) {
    hour = 0;
  }

  return (
    String(hour).padStart(2, "0") +
    ":" +
    String(minute).padStart(2, "0")
  );
}

// ======================================================
// REPEAT PARSER
// ======================================================

function parseRepeat(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("каждый день") ||
    lower.includes("ежедневно")
  ) {
    return "daily";
  }

  if (
    lower.includes("по будням") ||
    lower.includes("каждый будний день")
  ) {
    return "weekdays";
  }

  if (
    lower.includes("каждую неделю") ||
    lower.includes("еженедельно")
  ) {
    return "weekly";
  }

  if (
    lower.includes("каждый месяц") ||
    lower.includes("ежемесячно")
  ) {
    return "monthly";
  }

  const weekdays = {
    понедельник: 1,
    вторник: 2,
    среда: 3,
    четверг: 4,
    пятница: 5,
    суббота: 6,
    воскресенье: 0
  };

  for (const [name, number] of Object.entries(weekdays)) {
    if (
      lower.includes(`каждый ${name}`) ||
      lower.includes(`каждую ${name}`)
    ) {
      return `weekly:${number}`;
    }
  }

  return null;
}

// ======================================================
// TASK TYPE
// ======================================================

function parseTaskType(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("напоминание") ||
    lower.includes("напомни")
  ) {
    return "reminder";
  }

  if (
    lower.includes("событие") ||
    lower.includes("мероприятие")
  ) {
    return "event";
  }

  return "task";
}

// ======================================================
// TASK TITLE
// ======================================================

function cleanTaskTitle(text) {
  let title = text.trim();

  title = title
    .replace(/^на сегодня\s*/i, "")
    .replace(/^на завтра\s*/i, "")
    .replace(/^сегодня\s*/i, "")
    .replace(/^завтра\s*/i, "")
    .replace(/^послезавтра\s*/i, "");

  title = title.replace(
    /^(в|на|к|около)\s+\d{1,2}(?::\d{2})?\s*(?:час(?:а|ов)?|ч)?\s*(?:утра|дня|вечера|ночи)?/i,
    ""
  );

  title = title
    .replace(/^создай\s+/i, "")
    .replace(/^создать\s+/i, "")
    .replace(/^добавь\s+/i, "")
    .replace(/^добавить\s+/i, "")
    .replace(/^поставь\s+/i, "")
    .replace(/^поставить\s+/i, "")
    .replace(/^напомни\s+/i, "")
    .replace(/^напоминание\s+/i, "")
    .replace(/^задачу\s*/i, "")
    .replace(/^задача\s*/i, "")
    .replace(/^событие\s*/i, "");

  title = title
    .replace(
      /^(каждый день|ежедневно|по будням|каждую неделю|еженедельно|каждый месяц|ежемесячно)\s*/i,
      ""
    );

  return title.trim();
}

// ======================================================
// TASK PARSER
// ======================================================

function parseTask(text) {
  const lower = text.toLowerCase();

  const looksLikeTask =
    lower.includes("задач") ||
    lower.includes("сделать") ||
    lower.includes("подготовить") ||
    lower.includes("напомни") ||
    lower.includes("напоминание") ||
    lower.includes("создай") ||
    lower.includes("добавь") ||
    lower.includes("поставь") ||
    lower.includes("событие") ||
    lower.includes("встреч");

  if (!looksLikeTask) {
    return null;
  }

  let taskDate = getMoscowDate();

  if (lower.includes("послезавтра")) {
    taskDate = addDays(taskDate, 2);
  } else if (lower.includes("завтра")) {
    taskDate = addDays(taskDate, 1);
  }

  const weekdays = {
    воскресенье: 0,
    понедельник: 1,
    вторник: 2,
    среда: 3,
    четверг: 4,
    пятница: 5,
    суббота: 6
  };

  for (const [name, target] of Object.entries(weekdays)) {
    if (lower.includes(name)) {
      const current =
        new Date(`${taskDate}T00:00:00Z`);

      const currentDay =
        current.getUTCDay();

      let difference =
        target - currentDay;

      if (difference < 0) {
        difference += 7;
      }

      if (
        difference === 0 &&
        lower.includes("следующ")
      ) {
        difference = 7;
      }

      taskDate =
        addDays(taskDate, difference);

      break;
    }
  }

  const taskTime = parseTime(text);
  const repeatRule = parseRepeat(text);
  const taskType = parseTaskType(text);
  const title = cleanTaskTitle(text);

  if (!title) {
    return null;
  }

  return {
    title,
    task_date: taskDate,
    task_time: taskTime,
    task_type: taskType,
    repeat_rule: repeatRule
  };
}

// ======================================================
// MEMORY
// ======================================================

async function getRecentMemory(env, userId) {
  const result = await env.DB.prepare(`
    SELECT role, content, created_at
    FROM memory
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 20
  `)
    .bind(userId)
    .all();

  return (result.results || []).reverse();
}

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

// ======================================================
// FACTS
// ======================================================

async function getFacts(env, userId) {
  const result = await env.DB.prepare(`
    SELECT category, fact
    FROM facts
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 50
  `)
    .bind(userId)
    .all();

  return result.results || [];
}

async function saveFact(
  env,
  userId,
  category,
  fact
) {
  await env.DB.prepare(`
    INSERT INTO facts
      (user_id, category, fact)
    VALUES (?, ?, ?)
  `)
    .bind(
      userId,
      category,
      fact
    )
    .run();
}

// ======================================================
// TASKS
// ======================================================

async function getTasks(
  env,
  userId,
  status = "active"
) {
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
      AND status = ?
    ORDER BY
      CASE
        WHEN task_date IS NULL THEN 1
        ELSE 0
      END,
      task_date ASC,
      task_time ASC,
      id ASC
  `)
    .bind(userId, status)
    .all();

  return result.results || [];
}

async function createTask(
  env,
  userId,
  task
) {
  const result = await env.DB.prepare(`
    INSERT INTO tasks (
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
      task.task_type,
      task.repeat_rule
    )
    .run();

  return result.meta?.last_row_id || null;
}

async function deleteTask(
  env,
  userId,
  id
) {
  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE id = ?
      AND user_id = ?
      AND status = 'active'
  `)
    .bind(id, userId)
    .run();

  return result.meta?.changes > 0;
}

async function completeTask(
  env,
  userId,
  id
) {
  const result = await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE id = ?
      AND user_id = ?
      AND status = 'active'
  `)
    .bind(id, userId)
    .run();

  return result.meta?.changes > 0;
}

function formatTasks(tasks) {
  if (!tasks.length) {
    return "Активных задач нет.";
  }

  return tasks.map((task, index) => {
    let line =
      `${index + 1}. ${task.title}`;

    if (task.task_date) {
      line += ` — ${task.task_date}`;
    }

    if (task.task_time) {
      line += ` в ${task.task_time}`;
    }

    if (
      task.task_type &&
      task.task_type !== "task"
    ) {
      line += ` [${task.task_type}]`;
    }

    if (task.repeat_rule) {
      line += ` 🔁 ${task.repeat_rule}`;
    }

    return line;
  }).join("\n");
}

// ======================================================
// AI RESPONSE
// ======================================================

function extractAIText(result) {
  /*
    Фактическая структура GLM-4.7-Flash,
    которую мы получили из /ai-test:

    {
      choices: [
        {
          message: {
            content: "Приветствую."
          }
        }
      ]
    }
  */

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

  // Дополнительная совместимость
  if (
    result &&
    typeof result.response === "string"
  ) {
    return result.response.trim();
  }

  if (
    result?.result &&
    Array.isArray(result.result.choices) &&
    result.result.choices.length > 0
  ) {
    const content =
      result.result.choices[0]?.message?.content;

    if (typeof content === "string") {
      return content.trim();
    }
  }

  return null;
}

async function askAI(
  env,
  messages
) {
  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages
      }
    );

  const text =
    extractAIText(result);

  if (!text) {
    throw new Error(
      "Workers AI вернул ответ, но текст не найден."
    );
  }

  return text;
}

// ======================================================
// CHAT
// ======================================================

async function handleChat(
  request,
  env
) {
  const body =
    await request.json();

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message) {
    return json({
      ok: false,
      error: "Пустое сообщение."
    }, 400);
  }

  const userId =
    body.user_id || "egor";

  const lower =
    message.toLowerCase();

  // ====================================================
  // CREATE TASK
  // ====================================================

  const parsedTask =
    parseTask(message);

  if (parsedTask) {

    const taskId =
      await createTask(
        env,
        userId,
        parsedTask
      );

    let reply =
      `Готово. Задача «${parsedTask.title}» создана`;

    if (parsedTask.task_date) {
      reply +=
        ` на ${parsedTask.task_date}`;
    }

    if (parsedTask.task_time) {
      reply +=
        ` в ${parsedTask.task_time}`;
    }

    reply += ".";

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
      reply
    );

    return json({
      ok: true,
      type: "task_created",
      task_id: taskId,
      task: parsedTask,
      reply
    });
  }

  // ====================================================
  // LIST TASKS
  // ====================================================

  if (
    lower === "задачи" ||
    lower === "мои задачи" ||
    lower.includes("покажи задачи") ||
    lower.includes("какие у меня задачи") ||
    lower.includes("что у меня запланировано")
  ) {

    const tasks =
      await getTasks(
        env,
        userId
      );

    const reply =
      formatTasks(tasks);

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
      reply
    );

    return json({
      ok: true,
      type: "tasks",
      tasks,
      reply
    });
  }

  // ====================================================
  // DELETE TASK
  // ====================================================

  const deleteMatch =
    lower.match(
      /(?:удали|удалить|отмени|отменить)\s+(?:задачу\s+)?#?(\d+)/
    );

  if (deleteMatch) {

    const id =
      Number(deleteMatch[1]);

    const success =
      await deleteTask(
        env,
        userId,
        id
      );

    const reply =
      success
        ? `Готово. Задача №${id} удалена.`
        : `Задачу №${id} не удалось найти среди активных.`;

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
      reply
    );

    return json({
      ok: true,
      type: "task_deleted",
      success,
      reply
    });
  }

  // ====================================================
  // COMPLETE TASK
  // ====================================================

  const completeMatch =
    lower.match(
      /(?:выполни|заверши|закрой|готово)\s+(?:задачу\s+)?#?(\d+)/
    );

  if (completeMatch) {

    const id =
      Number(completeMatch[1]);

    const success =
      await completeTask(
        env,
        userId,
        id
      );

    const reply =
      success
        ? `Готово. Задача №${id} отмечена выполненной.`
        : `Задачу №${id} не удалось найти среди активных.`;

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
      reply
    );

    return json({
      ok: true,
      type: "task_completed",
      success,
      reply
    });
  }

  // ====================================================
  // REMEMBER
  // ====================================================

  const rememberMatch =
    message.match(
      /^(?:запомни|запомни что|помни что)\s+(.+)/i
    );

  if (rememberMatch) {

    const fact =
      rememberMatch[1].trim();

    await saveFact(
      env,
      userId,
      "user",
      fact
    );

    const reply =
      "Хорошо. Я это запомнил.";

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
      reply
    );

    return json({
      ok: true,
      type: "memory_saved",
      reply
    });
  }

  // ====================================================
  // AI CHAT
  // ====================================================

  const memory =
    await getRecentMemory(
      env,
      userId
    );

  const facts =
    await getFacts(
      env,
      userId
    );

  let factText = "";

  if (facts.length) {
    factText =
      "\n\nИзвестные факты о пользователе:\n" +
      facts.map(
        fact =>
          `- ${fact.category}: ${fact.fact}`
      ).join("\n");
  }

  const messages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n\nТекущая дата и время по Москве: " +
        getMoscowDateTime() +
        factText
    }
  ];

  for (const item of memory) {

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

  try {

    const reply =
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
      reply
    );

    return json({
      ok: true,
      type: "chat",
      reply
    });

  } catch (error) {

    return json({
      ok: false,
      error: String(error),
      reply:
        "Произошла ошибка при обращении к интеллектуальному модулю."
    }, 500);
  }
}

// ======================================================
// WEB INTERFACE
// ======================================================

function renderApp() {

  return html(`
<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
           initial-scale=1,
           maximum-scale=1,
           viewport-fit=cover">

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

  background: #05070a;
  color: #f5f7fa;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    Arial,
    sans-serif;
}

body {
  overflow: hidden;
}

.app {
  height: 100dvh;

  display: flex;
  flex-direction: column;

  background:
    radial-gradient(
      circle at 50% 0%,
      rgba(50,130,190,.18),
      transparent 42%
    ),
    #05070a;
}

.header {

  height: 68px;

  flex-shrink: 0;

  display: flex;

  align-items: center;
  justify-content: space-between;

  padding:
    calc(env(safe-area-inset-top) + 8px)
    18px
    0
    18px;

  border-bottom:
    1px solid rgba(255,255,255,.07);

  background:
    rgba(5,7,10,.86);

  backdrop-filter:
    blur(20px);
}

.brand {

  display: flex;

  align-items: center;

  gap: 11px;
}

.arc {

  width: 36px;
  height: 36px;

  border:
    2px solid #8edbff;

  border-radius: 50%;

  position: relative;

  box-shadow:
    0 0 14px rgba(80,190,255,.5),
    inset 0 0 10px rgba(80,190,255,.2);
}

.arc:after {

  content: "";

  position: absolute;

  width: 9px;
  height: 9px;

  border-radius: 50%;

  background: #c7efff;

  top: 50%;
  left: 50%;

  transform:
    translate(-50%, -50%);

  box-shadow:
    0 0 15px #72d0ff;
}

.brand-title {

  font-size: 15px;

  font-weight: 700;

  letter-spacing: 2.5px;
}

.status {

  margin-top: 2px;

  font-size: 10px;

  color: #78f0a4;

  letter-spacing: .5px;
}

.version {

  font-size: 11px;

  color: #69737e;
}

.messages {

  flex: 1;

  overflow-y: auto;

  -webkit-overflow-scrolling:
    touch;

  padding:
    24px
    14px
    120px;
}

.welcome {

  min-height: 100%;

  display: flex;

  flex-direction: column;

  align-items: center;

  justify-content: center;

  text-align: center;

  padding: 25px;
}

.welcome-logo {

  width: 88px;
  height: 88px;

  border:
    2px solid #78d3ff;

  border-radius: 50%;

  display: flex;

  align-items: center;
  justify-content: center;

  margin-bottom: 24px;

  box-shadow:
    0 0 35px rgba(70,180,255,.18),
    inset 0 0 25px rgba(70,180,255,.08);
}

.welcome-logo span {

  font-size: 29px;

  color: #a9e5ff;
}

.welcome h1 {

  margin: 0 0 8px;

  font-size: 28px;

  letter-spacing: 4px;
}

.welcome p {

  margin: 0;

  max-width: 320px;

  color: #808b97;

  line-height: 1.5;

  font-size: 14px;
}

.message {

  display: flex;

  margin:
    8px 0;
}

.message.user {

  justify-content:
    flex-end;
}

.message.assistant {

  justify-content:
    flex-start;
}

.bubble {

  max-width: 84%;

  padding:
    12px 15px;

  border-radius:
    18px;

  line-height: 1.48;

  font-size: 15px;

  white-space:
    pre-wrap;

  overflow-wrap:
    anywhere;
}

.user .bubble {

  background:
    #17364a;

  border-bottom-right-radius:
    5px;
}

.assistant .bubble {

  background:
    #151a20;

  border:
    1px solid rgba(255,255,255,.06);

  border-bottom-left-radius:
    5px;
}

.typing {

  display: flex;

  align-items: center;

  gap: 5px;
}

.dot {

  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: #8edcff;

  animation:
    blink 1.2s infinite;
}

.dot:nth-child(2) {
  animation-delay: .2s;
}

.dot:nth-child(3) {
  animation-delay: .4s;
}

@keyframes blink {

  0%, 100% {
    opacity: .2;
  }

  50% {
    opacity: 1;
  }
}

.input-area {

  position: fixed;

  left: 0;
  right: 0;
  bottom: 0;

  padding:
    9px 12px
    calc(9px + env(safe-area-inset-bottom));

  background:
    rgba(5,7,10,.94);

  backdrop-filter:
    blur(20px);

  border-top:
    1px solid rgba(255,255,255,.08);
}

.input-row {

  display: flex;

  align-items: flex-end;

  gap: 8px;

  max-width: 900px;

  margin: 0 auto;
}

textarea {

  flex: 1;

  resize: none;

  min-height: 45px;
  max-height: 130px;

  padding:
    12px 14px;

  border:
    1px solid rgba(255,255,255,.1);

  border-radius:
    18px;

  outline: none;

  background:
    #10151a;

  color: white;

  font-family: inherit;

  font-size: 16px;
}

textarea:focus {

  border-color:
    rgba(110,205,255,.5);
}

button {

  width: 45px;
  height: 45px;

  flex-shrink: 0;

  border: 0;

  border-radius: 50%;

  background:
    #bceaff;

  color:
    #071119;

  font-size: 20px;

  font-weight: 700;
}

button:disabled {

  opacity: .35;
}

@media (min-width: 700px) {

  .messages {

    width: 100%;

    max-width: 900px;

    margin: 0 auto;
  }
}

</style>

</head>

<body>

<div class="app">

<header class="header">

  <div class="brand">

    <div class="arc"></div>

    <div>

      <div class="brand-title">
        J.A.R.V.I.S.
      </div>

      <div class="status">
        ● ONLINE
      </div>

    </div>

  </div>

  <div class="version">
    ${VERSION}
  </div>

</header>

<main
  id="messages"
  class="messages">

  <div
    id="welcome"
    class="welcome">

    <div class="welcome-logo">
      <span>J</span>
    </div>

    <h1>
      J.A.R.V.I.S.
    </h1>

    <p>
      Ваш персональный интеллектуальный ассистент.
      Готов к работе.
    </p>

  </div>

</main>

<div class="input-area">

  <div class="input-row">

    <textarea
      id="input"
      rows="1"
      placeholder="Сообщение J.A.R.V.I.S...">
    </textarea>

    <button id="send">
      ↑
    </button>

  </div>

</div>

</div>

<script>

const messagesEl =
  document.getElementById("messages");

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const welcome =
  document.getElementById("welcome");

let history =
  JSON.parse(
    localStorage.getItem(
      "jarvis_chat"
    ) || "[]"
  );

function saveHistory() {

  localStorage.setItem(
    "jarvis_chat",
    JSON.stringify(
      history.slice(-100)
    )
  );
}

function escapeHTML(text) {

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addMessage(
  role,
  text,
  save = true
) {

  if (welcome) {
    welcome.style.display =
      "none";
  }

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "message " + role;

  const bubble =
    document.createElement("div");

  bubble.className =
    "bubble";

  bubble.innerHTML =
    escapeHTML(text);

  wrapper.appendChild(
    bubble
  );

  messagesEl.appendChild(
    wrapper
  );

  messagesEl.scrollTop =
    messagesEl.scrollHeight;

  if (save) {

    history.push({
      role,
      text
    });

    saveHistory();
  }
}

function showHistory() {

  if (!history.length) {
    return;
  }

  if (welcome) {
    welcome.style.display =
      "none";
  }

  for (const item of history) {

    addMessage(
      item.role,
      item.text,
      false
    );
  }

  messagesEl.scrollTop =
    messagesEl.scrollHeight;
}

function showTyping() {

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "message assistant";

  wrapper.id =
    "typing";

  wrapper.innerHTML = \`
    <div class="bubble typing">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  \`;

  messagesEl.appendChild(
    wrapper
  );

  messagesEl.scrollTop =
    messagesEl.scrollHeight;
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

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  input.value = "";
  input.style.height =
    "auto";

  addMessage(
    "user",
    text
  );

  send.disabled = true;

  showTyping();

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
              message: text,
              user_id: "egor"
            })
        }
      );

    const data =
      await response.json();

    removeTyping();

    if (data.reply) {

      addMessage(
        "assistant",
        data.reply
      );

    } else if (data.error) {

      addMessage(
        "assistant",
        "Ошибка: " +
        data.error
      );

    } else {

      addMessage(
        "assistant",
        "J.A.R.V.I.S. не получил текстовый ответ."
      );
    }

  } catch (error) {

    removeTyping();

    addMessage(
      "assistant",
      "Не удалось подключиться к J.A.R.V.I.S."
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
      "auto";

    input.style.height =
      Math.min(
        input.scrollHeight,
        130
      ) + "px";
  }
);

showHistory();

input.focus();

</script>

</body>

</html>
`);
}

// ======================================================
// WORKER
// ======================================================

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    // ==================================================
    // MAIN PAGE
    // ==================================================

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return renderApp();
    }

    // ==================================================
    // PING
    // ==================================================

    if (
      request.method === "GET" &&
      url.pathname === "/ping"
    ) {

      return json({
        ok: true,
        version: VERSION,
        timezone: TIME_ZONE,
        model: AI_MODEL,
        message:
          "J.A.R.V.I.S. online"
      });
    }

    // ==================================================
    // HEALTH
    // ==================================================

    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {

      return json({
        ok: true,
        version: VERSION,
        database:
          !!env.DB,
        ai:
          !!env.AI,
        timezone:
          TIME_ZONE,
        model:
          AI_MODEL
      });
    }

    // ==================================================
    // AI TEST
    // ==================================================

    if (
      request.method === "GET" &&
      url.pathname === "/ai-test"
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
                    "Ты J.A.R.V.I.S. Ответь кратко."
                },
                {
                  role: "user",
                  content:
                    "Ответь одним словом: Привет"
                }
              ]
            }
          );

        return json({
          ok: true,
          model: AI_MODEL,
          raw: result
        });

      } catch (error) {

        return json({
          ok: false,
          model: AI_MODEL,
          error:
            String(error),
          stack:
            error?.stack || null
        }, 500);
      }
    }

    // ==================================================
    // TASKS
    // ==================================================

    if (
      request.method === "GET" &&
      url.pathname === "/tasks"
    ) {

      try {

        const userId =
          url.searchParams.get(
            "user_id"
          ) || "egor";

        const tasks =
          await getTasks(
            env,
            userId
          );

        return json({
          ok: true,
          tasks
        });

      } catch (error) {

        return json({
          ok: false,
          error:
            String(error)
        }, 500);
      }
    }

    // ==================================================
    // CHAT
    // ==================================================

    if (
      request.method === "POST" &&
      url.pathname === "/chat"
    ) {

      try {

        return await handleChat(
          request,
          env
        );

      } catch (error) {

        return json({
          ok: false,
          error:
            String(error)
        }, 500);
      }
    }

    // ==================================================
    // 404
    // ==================================================

    return json({
      ok: false,
      error: "Not found"
    }, 404);
  }
};
