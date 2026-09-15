const VERSION = "v5.3";
const TIME_ZONE = "Europe/Moscow";

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твоя роль:
- помогать пользователю планировать дела;
- помнить важную информацию;
- управлять задачами;
- помогать с учебой, работой и личными делами;
- отвечать естественно, спокойно и уверенно;
- быть полезным, но не навязчивым.

Общайся на русском языке, если пользователь не попросил другой язык.

Стиль:
- уверенный;
- краткий, когда вопрос простой;
- подробный, когда требуется объяснение;
- без лишних повторов;
- естественный диалог в стиле персонального ассистента.

Если пользователь сообщает о задаче, напоминании или событии, система сама обработает его через базу данных.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return html(`
          <!DOCTYPE html>
          <html lang="ru">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>J.A.R.V.I.S.</title>
            <style>
              body {
                margin: 0;
                background: #080b10;
                color: #e8eef7;
                font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;
              }

              .container {
                max-width: 700px;
                margin: 0 auto;
                padding: 25px 18px;
              }

              h1 {
                font-size: 30px;
                margin-bottom: 5px;
              }

              .version {
                color: #7f8da3;
                margin-bottom: 25px;
              }

              .card {
                background: #111722;
                border: 1px solid #202a39;
                border-radius: 16px;
                padding: 18px;
                margin-bottom: 15px;
              }

              input, textarea {
                width: 100%;
                box-sizing: border-box;
                background: #0b1018;
                color: white;
                border: 1px solid #2b3749;
                border-radius: 12px;
                padding: 13px;
                font-size: 16px;
                margin-top: 8px;
              }

              button {
                width: 100%;
                margin-top: 10px;
                border: 0;
                border-radius: 12px;
                padding: 13px;
                font-size: 16px;
                background: #1d8cff;
                color: white;
              }

              pre {
                white-space: pre-wrap;
                word-break: break-word;
              }
            </style>
          </head>

          <body>
            <div class="container">
              <h1>J.A.R.V.I.S.</h1>
              <div class="version">${VERSION}</div>

              <div class="card">
                <strong>Система активна</strong>
                <p>Персональный ассистент готов к работе.</p>
                <p>Часовой пояс: Europe/Moscow</p>
              </div>

              <div class="card">
                <input id="user" placeholder="User ID" value="egor">
                <textarea id="message" rows="4"
                  placeholder="Например: Завтра в 10 подготовить презентацию"></textarea>
                <button onclick="send()">Отправить J.A.R.V.I.S.</button>
                <pre id="result"></pre>
              </div>
            </div>

            <script>
              async function send() {
                const user = document.getElementById("user").value;
                const message = document.getElementById("message").value;
                const result = document.getElementById("result");

                result.textContent = "J.A.R.V.I.S. обрабатывает запрос...";

                try {
                  const response = await fetch("/chat", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                      user_id: user,
                      message: message
                    })
                  });

                  const data = await response.json();
                  result.textContent = JSON.stringify(data, null, 2);
                } catch (error) {
                  result.textContent = "Ошибка: " + error.message;
                }
              }
            </script>
          </body>
          </html>
        `);
      }

      if (request.method === "GET" && url.pathname === "/ping") {
        return json({
          ok: true,
          version: VERSION,
          timezone: TIME_ZONE,
          service: "J.A.R.V.I.S."
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          status: "healthy",
          version: VERSION,
          timezone: TIME_ZONE
        });
      }

      if (request.method === "GET" && url.pathname === "/tasks") {
        const userId = url.searchParams.get("user_id") || "egor";

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
          ORDER BY
            CASE WHEN task_date IS NULL THEN 1 ELSE 0 END,
            task_date,
            task_time,
            id
        `)
        .bind(userId)
        .all();

        return json({
          ok: true,
          tasks: result.results || []
        });
      }

      if (request.method === "POST" && url.pathname === "/chat") {
        const body = await request.json();

        const userId = body.user_id || "egor";
        const message = String(body.message || "").trim();

        if (!message) {
          return json({
            ok: false,
            error: "Пустое сообщение"
          }, 400);
        }

        /*
         * 1. Сначала проверяем команды управления задачами.
         */

        const deleteResult = await tryDeleteTask(
          env,
          userId,
          message
        );

        if (deleteResult) {
          return json({
            ok: true,
            reply: deleteResult.reply,
            action: deleteResult.action,
            task: deleteResult.task || null
          });
        }

        const completeResult = await tryCompleteTask(
          env,
          userId,
          message
        );

        if (completeResult) {
          return json({
            ok: true,
            reply: completeResult.reply,
            action: completeResult.action,
            task: completeResult.task || null
          });
        }

        const listResult = await tryListTasks(
          env,
          userId,
          message
        );

        if (listResult) {
          return json({
            ok: true,
            reply: listResult.reply,
            action: "list_tasks",
            tasks: listResult.tasks
          });
        }

        /*
         * 2. Определяем, является ли сообщение задачей.
         */

        const parsedTask = parseTask(message);

        if (parsedTask) {
          const created = await createTask(
            env,
            userId,
            parsedTask
          );

          return json({
            ok: true,
            reply: buildTaskReply(created),
            action: "create_task",
            task: created
          });
        }

        /*
         * 3. Сохраняем сообщение в память.
         */

        await env.DB.prepare(`
          INSERT INTO memory (user_id, role, content)
          VALUES (?, ?, ?)
        `)
        .bind(userId, "user", message)
        .run();

        /*
         * 4. Получаем последние сообщения.
         */

        const memoryResult = await env.DB.prepare(`
          SELECT role, content
          FROM memory
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 20
        `)
        .bind(userId)
        .all();

        const messages = [
          {
            role: "system",
            content: SYSTEM_PROMPT
          }
        ];

        const history = (memoryResult.results || [])
          .reverse()
          .map(row => ({
            role: row.role === "assistant"
              ? "assistant"
              : "user",
            content: row.content
          }));

        for (const item of history) {
          messages.push(item);
        }

        const aiResult = await env.AI.run(
          "@cf/zai-org/glm-4.7-flash",
          {
            messages
          }
        );

        const reply =
          aiResult?.response ||
          aiResult?.result?.response ||
          "Не удалось получить ответ.";

        await env.DB.prepare(`
          INSERT INTO memory (user_id, role, content)
          VALUES (?, ?, ?)
        `)
        .bind(userId, "assistant", reply)
        .run();

        return json({
          ok: true,
          reply,
          action: "chat"
        });
      }

      return json({
        ok: false,
        error: "Not found"
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        error: error.message,
        version: VERSION
      }, 500);
    }
  }
};


/* =========================================================
   DATE / TIME
   ========================================================= */

function getLocalDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}


function getLocalTime() {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return formatter.format(new Date());
}


function parseDateFromNaturalLanguage(text) {
  const normalized = text.toLowerCase();

  const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: TIME_ZONE
    })
  );

  if (normalized.includes("послезавтра")) {
    now.setDate(now.getDate() + 2);
    return formatDate(now);
  }

  if (normalized.includes("завтра")) {
    now.setDate(now.getDate() + 1);
    return formatDate(now);
  }

  if (
    normalized.includes("сегодня") ||
    normalized.includes("сейчас")
  ) {
    return formatDate(now);
  }

  const weekdays = {
    "понедельник": 1,
    "вторник": 2,
    "среду": 3,
    "среда": 3,
    "четверг": 4,
    "пятницу": 5,
    "пятница": 5,
    "субботу": 6,
    "суббота": 6,
    "воскресенье": 0
  };

  for (const [word, day] of Object.entries(weekdays)) {
    if (normalized.includes(word)) {
      const currentDay = now.getDay();

      let difference = day - currentDay;

      if (difference <= 0) {
        difference += 7;
      }

      now.setDate(now.getDate() + difference);

      return formatDate(now);
    }
  }

  return null;
}


function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/* =========================================================
   TIME PARSER
   ========================================================= */

function parseTime(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("полдень") ||
    normalized.includes("12 дня")
  ) {
    return "12:00";
  }

  if (
    normalized.includes("полночь") ||
    normalized.includes("12 ночи")
  ) {
    return "00:00";
  }

  let match = normalized.match(
    /(?:в|на|к)\s*(\d{1,2})(?::(\d{2}))?\s*(утра|дня|вечера|ночи)?/
  );

  if (!match) {
    match = normalized.match(
      /\b(\d{1,2})(?::(\d{2}))?\s*(утра|дня|вечера|ночи)?/
    );
  }

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  let minute = Number(match[2] || 0);
  const period = match[3];

  if (period === "утра" && hour === 12) {
    hour = 0;
  }

  if (
    (period === "дня" ||
      period === "вечера" ||
      period === "ночи") &&
    hour < 12
  ) {
    hour += 12;
  }

  if (hour > 23 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}


/* =========================================================
   TASK TYPE
   ========================================================= */

function parseTaskType(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("напоминание") ||
    normalized.includes("напомни")
  ) {
    return "reminder";
  }

  if (
    normalized.includes("событие") ||
    normalized.includes("мероприятие")
  ) {
    return "event";
  }

  return "task";
}


/* =========================================================
   REPEAT
   ========================================================= */

function parseRepeatRule(text) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("каждый день") ||
    normalized.includes("ежедневно") ||
    normalized.includes("ежедневный")
  ) {
    return "daily";
  }

  if (
    normalized.includes("по будням") ||
    normalized.includes("каждый будний день")
  ) {
    return "weekdays";
  }

  if (
    normalized.includes("каждую неделю") ||
    normalized.includes("еженедельно")
  ) {
    return "weekly";
  }

  if (
    normalized.includes("каждый месяц") ||
    normalized.includes("ежемесячно")
  ) {
    return "monthly";
  }

  const weekdayMap = {
    "понедельник": "monday",
    "вторник": "tuesday",
    "среду": "wednesday",
    "среда": "wednesday",
    "четверг": "thursday",
    "пятницу": "friday",
    "пятница": "friday",
    "субботу": "saturday",
    "суббота": "saturday",
    "воскресенье": "sunday"
  };

  if (
    normalized.includes("каждый понедельник") ||
    normalized.includes("по понедельникам")
  ) {
    return "weekly:monday";
  }

  for (const [word, day] of Object.entries(weekdayMap)) {
    if (
      normalized.includes(`каждый ${word}`) ||
      normalized.includes(`по ${word}`)
    ) {
      return `weekly:${day}`;
    }
  }

  return "none";
}


/* =========================================================
   TASK TITLE
   ========================================================= */

function cleanTaskTitle(text) {
  let title = text.trim();

  title = title.replace(
    /(?:сегодня|завтра|послезавтра)/gi,
    ""
  );

  title = title.replace(
    /(?:в|на|к)\s*\d{1,2}(?::\d{2})?\s*(?:утра|дня|вечера|ночи)?/gi,
    ""
  );

  title = title.replace(
    /\b\d{1,2}:\d{2}\b/g,
    ""
  );

  title = title.replace(
    /(?:полдень|полночь)/gi,
    ""
  );

  title = title.replace(
    /(?:каждый день|ежедневно|по будням|каждую неделю|еженедельно|каждый месяц|ежемесячно)/gi,
    ""
  );

  title = title.replace(
    /(?:напомни|напоминание|напомнить|задача|задачу|событие|мероприятие)/gi,
    ""
  );

  title = title.replace(
    /\s+/g,
    " "
  );

  title = title
    .replace(/^[\s,.:;-]+/, "")
    .replace(/[\s,.:;-]+$/, "");

  if (!title) {
    title = text.trim();
  }

  return title;
}


/* =========================================================
   TASK PARSER
   ========================================================= */

function parseTask(text) {
  const normalized = text.toLowerCase();

  const hasTaskWords =
    normalized.includes("сделать") ||
    normalized.includes("подготовить") ||
    normalized.includes("купить") ||
    normalized.includes("позвонить") ||
    normalized.includes("написать") ||
    normalized.includes("отправить") ||
    normalized.includes("проверить") ||
    normalized.includes("встретиться") ||
    normalized.includes("напомни") ||
    normalized.includes("напоминание") ||
    normalized.includes("задача") ||
    normalized.includes("событие") ||
    normalized.includes("мероприятие") ||
    normalized.includes("подготовка");

  const hasDate =
    normalized.includes("сегодня") ||
    normalized.includes("завтра") ||
    normalized.includes("послезавтра") ||
    normalized.includes("понедельник") ||
    normalized.includes("вторник") ||
    normalized.includes("среда") ||
    normalized.includes("среду") ||
    normalized.includes("четверг") ||
    normalized.includes("пятница") ||
    normalized.includes("пятницу") ||
    normalized.includes("суббота") ||
    normalized.includes("субботу") ||
    normalized.includes("воскресенье");

  const hasTime =
    /\b\d{1,2}(?::\d{2})?\b/.test(normalized) ||
    normalized.includes("утра") ||
    normalized.includes("дня") ||
    normalized.includes("вечера") ||
    normalized.includes("ночи") ||
    normalized.includes("полдень") ||
    normalized.includes("полночь");

  const repeat =
    parseRepeatRule(normalized);

  if (
    !hasTaskWords &&
    !hasDate &&
    !hasTime &&
    repeat === "none"
  ) {
    return null;
  }

  /*
   * Чтобы обычные фразы вроде
   * "мне 10 минут" не превращались в задачи.
   */
  if (
    !hasTaskWords &&
    !hasDate &&
    repeat === "none"
  ) {
    return null;
  }

  const taskDate = parseDateFromNaturalLanguage(normalized);

  const taskTime = parseTime(normalized);

  const title = cleanTaskTitle(text);

  if (!title) {
    return null;
  }

  return {
    title,
    task_date: taskDate,
    task_time: taskTime,
    task_type: parseTaskType(normalized),
    repeat_rule: repeat
  };
}


/* =========================================================
   CREATE TASK
   ========================================================= */

async function createTask(env, userId, task) {
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
    RETURNING
      id,
      title,
      task_date,
      task_time,
      status,
      task_type,
      repeat_rule,
      created_at
  `)
  .bind(
    userId,
    task.title,
    task.task_date,
    task.task_time,
    task.task_type,
    task.repeat_rule
  )
  .first();

  return result;
}


/* =========================================================
   TASK RESPONSE
   ========================================================= */

function buildTaskReply(task) {
  let reply = "Задача создана.";

  if (task.task_date) {
    reply += ` Дата: ${formatHumanDate(task.task_date)}.`;
  }

  if (task.task_time) {
    reply += ` Время: ${task.task_time}.`;
  }

  if (task.repeat_rule && task.repeat_rule !== "none") {
    reply += ` Повтор: ${formatRepeat(task.repeat_rule)}.`;
  }

  return reply;
}


function formatHumanDate(date) {
  const [year, month, day] = date.split("-");

  return `${day}.${month}.${year}`;
}


function formatRepeat(rule) {
  const map = {
    daily: "каждый день",
    weekdays: "по будням",
    weekly: "каждую неделю",
    monthly: "каждый месяц",
    "weekly:monday": "каждый понедельник",
    "weekly:tuesday": "каждый вторник",
    "weekly:wednesday": "каждую среду",
    "weekly:thursday": "каждый четверг",
    "weekly:friday": "каждую пятницу",
    "weekly:saturday": "каждую субботу",
    "weekly:sunday": "каждое воскресенье"
  };

  return map[rule] || rule;
}


/* =========================================================
   DELETE TASK
   ========================================================= */

async function tryDeleteTask(env, userId, text) {
  const normalized = text.toLowerCase();

  const isDelete =
    normalized.includes("удали") ||
    normalized.includes("удалить") ||
    normalized.includes("отмени задачу") ||
    normalized.includes("отменить задачу");

  if (!isDelete) {
    return null;
  }

  const title = extractTaskReference(text);

  if (!title) {
    return {
      reply: "Уточни, какую именно задачу удалить.",
      action: "delete_task"
    };
  }

  const task = await env.DB.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
      AND LOWER(title) LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `)
  .bind(
    userId,
    `%${title.toLowerCase()}%`
  )
  .first();

  if (!task) {
    return {
      reply: `Активную задачу «${title}» не нашёл.`,
      action: "delete_task"
    };
  }

  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE id = ?
  `)
  .bind(task.id)
  .run();

  return {
    reply: `Задача «${task.title}» удалена.`,
    action: "delete_task",
    task
  };
}


/* =========================================================
   COMPLETE TASK
   ========================================================= */

async function tryCompleteTask(env, userId, text) {
  const normalized = text.toLowerCase();

  const isComplete =
    normalized.includes("выполнил") ||
    normalized.includes("выполнила") ||
    normalized.includes("выполнено") ||
    normalized.includes("выполнить") ||
    normalized.includes("завершил") ||
    normalized.includes("завершила") ||
    normalized.includes("готово") ||
    normalized.includes("сделал") ||
    normalized.includes("сделала");

  if (!isComplete) {
    return null;
  }

  const title = extractTaskReference(text);

  if (!title) {
    return {
      reply: "Уточни, какую задачу отметить выполненной.",
      action: "complete_task"
    };
  }

  const task = await env.DB.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
      AND status = 'active'
      AND LOWER(title) LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `)
  .bind(
    userId,
    `%${title.toLowerCase()}%`
  )
  .first();

  if (!task) {
    return {
      reply: `Активную задачу «${title}» не нашёл.`,
      action: "complete_task"
    };
  }

  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE id = ?
  `)
  .bind(task.id)
  .run();

  return {
    reply: `Задача «${task.title}» отмечена как выполненная.`,
    action: "complete_task",
    task
  };
}


/* =========================================================
   LIST TASKS
   ========================================================= */

async function tryListTasks(env, userId, text) {
  const normalized = text.toLowerCase();

  const isList =
    normalized.includes("мои задачи") ||
    normalized.includes("список задач") ||
    normalized.includes("покажи задачи") ||
    normalized.includes("какие у меня задачи") ||
    normalized === "задачи" ||
    normalized.includes("что запланировано");

  if (!isList) {
    return null;
  }

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
    ORDER BY
      CASE WHEN task_date IS NULL THEN 1 ELSE 0 END,
      task_date,
      task_time,
      id
  `)
  .bind(userId)
  .all();

  const tasks = result.results || [];

  if (!tasks.length) {
    return {
      reply: "Активных задач сейчас нет.",
      tasks: []
    };
  }

  const lines = tasks.map((task, index) => {
    let line = `${index + 1}. ${task.title}`;

    if (task.task_date) {
      line += ` — ${formatHumanDate(task.task_date)}`;
    }

    if (task.task_time) {
      line += ` в ${task.task_time}`;
    }

    if (
      task.repeat_rule &&
      task.repeat_rule !== "none"
    ) {
      line += ` (${formatRepeat(task.repeat_rule)})`;
    }

    return line;
  });

  return {
    reply: "Твои активные задачи:\n\n" + lines.join("\n"),
    tasks
  };
}


/* =========================================================
   EXTRACT TASK REFERENCE
   ========================================================= */

function extractTaskReference(text) {
  let value = text.trim();

  value = value.replace(
    /^(удали|удалить|отмени задачу|отменить задачу|выполнил|выполнила|выполнено|выполнить|завершил|завершила|готово|сделал|сделала)\s*/i,
    ""
  );

  value = value.replace(
    /^(задачу|задача)\s*/i,
    ""
  );

  value = value.trim();

  return value || null;
}


/* =========================================================
   RESPONSES
   ========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}


function html(content, status = 200) {
  return new Response(
    content,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      }
    }
  );
}
