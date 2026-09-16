const VERSION = "v5.10";
const TIME_ZONE = "Europe/Moscow";
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: corsHeaders()
        });
      }

      // =========================
      // SYSTEM
      // =========================

      if (path === "/ping") {
        return json({
          ok: true,
          version: VERSION,
          timezone: TIME_ZONE,
          model: AI_MODEL,
          message: "J.A.R.V.I.S. online"
        });
      }

      if (path === "/health") {
        return json({
          ok: true,
          version: VERSION,
          database: !!env.DB,
          ai: !!env.AI,
          timezone: TIME_ZONE
        });
      }

      if (path === "/ai-test") {
        return await aiTest(env);
      }

      // =========================
      // TASK API
      // =========================

      if (path === "/tasks") {
        const userId = "web-user";

        const tasks = await getTasks(
          env,
          userId
        );

        return json({
          ok: true,
          version: VERSION,
          tasks
        });
      }

      // =========================
      // CHAT
      // =========================

      if (
        path === "/chat" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const message = String(
          body.message || ""
        ).trim();

        const userId = String(
          body.user_id || "web-user"
        );

        if (!message) {
          return json({
            ok: false,
            error: "Пустое сообщение"
          }, 400);
        }

        const answer = await handleChat(
          env,
          userId,
          message
        );

        return json({
          ok: true,
          version: VERSION,
          answer
        });
      }

      return htmlResponse(
        renderChatUI()
      );

    } catch (error) {
      console.error(error);

      return json({
        ok: false,
        version: VERSION,
        error:
          error?.message ||
          String(error)
      }, 500);
    }
  }
};


/* =========================================================
   MAIN CHAT
   ========================================================= */

async function handleChat(
  env,
  userId,
  message
) {
  const normalized =
    normalizeText(message);

  // -------------------------------------------------------
  // 1. СПИСОК ЗАДАЧ
  // -------------------------------------------------------

  if (
    isTaskListCommand(normalized)
  ) {
    const tasks =
      await getTasks(env, userId);

    const answer =
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
      answer
    );

    return answer;
  }


  // -------------------------------------------------------
  // 2. УДАЛЕНИЕ ВСЕХ ЗАДАЧ
  // -------------------------------------------------------

  if (
    isDeleteAllCommand(normalized)
  ) {
    const result =
      await deleteAllTasks(
        env,
        userId
      );

    let answer;

    if (result.changes > 0) {
      answer =
        `Выполнено. Удалено активных задач: ${result.changes}.`;
    } else {
      answer =
        "Активных задач уже нет.";
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


  // -------------------------------------------------------
  // 3. УДАЛЕНИЕ ОДНОЙ ЗАДАЧИ
  // -------------------------------------------------------

  if (
    isDeleteCommand(normalized)
  ) {
    const title =
      extractTaskTitleFromDelete(
        message
      );

    if (!title) {
      return "Уточни, какую именно задачу удалить.";
    }

    const result =
      await deleteTask(
        env,
        userId,
        title
      );

    let answer;

    if (result.changes > 0) {
      answer =
        `Задача «${title}» удалена.`;
    } else {
      answer =
        `Активная задача «${title}» не найдена.`;
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


  // -------------------------------------------------------
  // 4. ЗАВЕРШЕНИЕ ЗАДАЧИ
  // -------------------------------------------------------

  if (
    isCompleteCommand(normalized)
  ) {
    const title =
      extractTaskTitleFromComplete(
        message
      );

    if (!title) {
      return "Уточни, какую задачу отметить выполненной.";
    }

    const result =
      await completeTask(
        env,
        userId,
        title
      );

    let answer;

    if (result.changes > 0) {
      answer =
        `Задача «${title}» отмечена как выполненная.`;
    } else {
      answer =
        `Активная задача «${title}» не найдена.`;
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


  // -------------------------------------------------------
  // 5. ПРИВЕТСТВИЕ
  // -------------------------------------------------------

  if (
    isGreetingCommand(normalized)
  ) {
    const answer =
      "Приветствую. J.A.R.V.I.S. готов к работе.";

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


  // -------------------------------------------------------
  // 6. СОЗДАНИЕ ЗАДАЧИ
  //
  // ВАЖНО:
  // Сначала пытаемся распознать задачу.
  // Только если это НЕ задача — отправляем в AI.
  // -------------------------------------------------------

  const task =
    parseTask(message);

  if (task) {
    try {
      const created =
        await createTask(
          env,
          userId,
          task
        );

      return formatCreatedTask(
        created
      );

    } catch (error) {
      console.error(
        "TASK CREATE ERROR:",
        error
      );

      return (
        "Не удалось сохранить задачу в памяти J.A.R.V.I.S. " +
        "Запись в базе данных не подтверждена."
      );
    }
  }


  // -------------------------------------------------------
  // 7. AI
  // -------------------------------------------------------

  const answer =
    await askAI(
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
    answer
  );

  return answer;
}


/* =========================================================
   COMMANDS
   ========================================================= */

function isTaskListCommand(message) {
  const commands = [
    "мои задачи",
    "моя задача",
    "мои активные задачи",
    "покажи мои задачи",
    "покажи задачи",
    "показать задачи",
    "список задач",
    "список моих задач",
    "какие у меня задачи",
    "какие задачи у меня",
    "что у меня по задачам",
    "что запланировано"
  ];

  return commands.includes(
    message
  );
}


function isDeleteAllCommand(message) {
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

    // Опечатка пользователя
    "удили все задачи",
    "удили все мои задачи"
  ];

  return commands.includes(
    message
  );
}


function isDeleteCommand(message) {
  return (
    message.startsWith("удали ") ||
    message.startsWith("удалить ") ||
    message.startsWith("отмени ") ||
    message.startsWith("отменить ")
  );
}


function isCompleteCommand(message) {
  return (
    message.startsWith("выполни ") ||
    message.startsWith("выполнено ") ||
    message.startsWith("заверши ") ||
    message.startsWith("завершить ") ||
    message.startsWith("отметь выполненной ") ||
    message.startsWith("сделано ")
  );
}


function isGreetingCommand(message) {
  const greetings = [
    "привет",
    "здравствуй",
    "здравствуйте",
    "доброе утро",
    "добрый день",
    "добрый вечер",
    "доброй ночи",

    "привет джарвис",
    "здравствуй джарвис",
    "здравствуйте джарвис",

    "доброе утро джарвис",
    "добрый день джарвис",
    "добрый вечер джарвис"
  ];

  return greetings.includes(
    message
  );
}


/* =========================================================
   TASK PARSER
   ========================================================= */

function parseTask(message) {
  const normalized =
    normalizeText(message);

  /*
   * Команды управления задачами
   * не должны попадать сюда.
   */

  if (
    isTaskListCommand(normalized) ||
    isDeleteAllCommand(normalized) ||
    isDeleteCommand(normalized) ||
    isCompleteCommand(normalized)
  ) {
    return null;
  }


  /*
   * Определяем наличие намерения
   * создать задачу.
   *
   * Важное изменение v5.10:
   *
   * "завтра спектакль в 20"
   * тоже считается задачей.
   */

  const taskIntent =
    hasExplicitTaskIntent(
      normalized
    );


  if (!taskIntent) {
    return null;
  }


  const now =
    getMoscowDate();


  let taskDate = null;
  let taskTime = null;


  // -------------------------------------------------------
  // DATE
  // -------------------------------------------------------

  if (
    /\bпослезавтра\b/.test(
      normalized
    )
  ) {
    taskDate =
      addDays(now, 2);

  } else if (
    /\bзавтра\b/.test(
      normalized
    )
  ) {
    taskDate =
      addDays(now, 1);

  } else if (
    /\bсегодня\b/.test(
      normalized
    )
  ) {
    taskDate =
      now;
  }


  // -------------------------------------------------------
  // TIME
  // -------------------------------------------------------

  const timeMatch =
    normalized.match(
      /\bв\s*([01]?\d|2[0-3])(?::([0-5]\d))?\b/
    );


  if (timeMatch) {
    const hour =
      Number(timeMatch[1]);

    const minute =
      Number(
        timeMatch[2] || 0
      );

    taskTime =
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  } else {

    const standaloneTime =
      normalized.match(
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      );

    if (standaloneTime) {
      taskTime =
        `${String(
          Number(standaloneTime[1])
        ).padStart(2, "0")}:${standaloneTime[2]}`;
    }
  }


  /*
   * Если есть время,
   * но нет даты — сегодня.
   */

  if (
    taskTime &&
    !taskDate
  ) {
    taskDate = now;
  }


  const title =
    cleanTaskTitle(message);


  if (!title) {
    return null;
  }


  return {
    title,

    task_date:
      taskDate
        ? formatDate(taskDate)
        : null,

    task_time:
      taskTime,

    task_type:
      "one_time",

    repeat_rule:
      null
  };
}


/* =========================================================
   TASK INTENT
   ========================================================= */

function hasExplicitTaskIntent(
  message
) {
  /*
   * Явные команды.
   */

  if (
    message.startsWith("создай ") ||
    message.startsWith("создать ") ||
    message.startsWith("добавь ") ||
    message.startsWith("добавить ") ||
    message.startsWith("поставь ") ||
    message.startsWith("поставить ") ||
    message.startsWith("запланируй ") ||
    message.startsWith("запланировать ") ||
    message.startsWith("напомни ") ||
    message.startsWith("напомнить ")
  ) {
    return true;
  }


  /*
   * Естественная речь:
   *
   * завтра спектакль в 20
   * сегодня учеба в 10
   * послезавтра встреча в 15
   */

  const hasDate =
    /\b(сегодня|завтра|послезавтра)\b/
      .test(message);

  const hasTime =
    /\bв\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\b/
      .test(message);


  /*
   * Если пользователь говорит
   * дату + время — это задача.
   */

  if (
    hasDate &&
    hasTime
  ) {
    return true;
  }


  /*
   * Также поддерживаем:
   *
   * завтра спектакль
   * сегодня учеба
   */

  if (
    hasDate
  ) {
    return true;
  }


  return false;
}


/* =========================================================
   CLEAN TITLE
   ========================================================= */

function cleanTaskTitle(text) {
  let title =
    text.trim();


  /*
   * Убираем JARVIS
   */

  title =
    title.replace(
      /^(джарвис[\s,]*)/i,
      ""
    );


  /*
   * Убираем команды
   */

  title =
    title.replace(
      /^(создай|создать|добавь|добавить|поставь|поставить|запланируй|запланировать|напомни|напомнить)\s*/i,
      ""
    );


  /*
   * Удаляем даты
   */

  title =
    title.replace(
      /\b(сегодня|завтра|послезавтра)\b/gi,
      ""
    );


  /*
   * Удаляем:
   *
   * в 20
   * в 20:00
   */

  title =
    title.replace(
      /\bв\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\b/gi,
      ""
    );


  /*
   * Удаляем:
   *
   * 20
   * 20:00
   * 20 часов
   */

  title =
    title.replace(
      /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:час(?:а|ов)?|ч)?\b/gi,
      ""
    );


  /*
   * Удаляем оставшийся "в".
   */

  title =
    title.replace(
      /\s+\bв\s*$/i,
      ""
    );

  title =
    title.replace(
      /^\s*в\s+/i,
      ""
    );


  /*
   * Удаляем лишние пробелы.
   */

  title =
    title
      .replace(/\s+/g, " ")
      .trim();


  /*
   * Удаляем лишнюю пунктуацию.
   */

  title =
    title
      .replace(/^[,.\-:;]+/, "")
      .replace(/[,.\-:;]+$/, "")
      .trim();


  /*
   * Первая буква заглавная.
   */

  if (title.length > 0) {
    title =
      title.charAt(0).toUpperCase() +
      title.slice(1);
  }


  return title;
}


/* =========================================================
   DELETE / COMPLETE TITLE
   ========================================================= */

function extractTaskTitleFromDelete(
  message
) {
  let title =
    message.trim();

  title =
    title.replace(
      /^(джарвис[\s,]*)/i,
      ""
    );

  title =
    title.replace(
      /^(удали|удалить|отмени|отменить)\s*/i,
      ""
    );

  return title
    .replace(/\s+/g, " ")
    .trim();
}


function extractTaskTitleFromComplete(
  message
) {
  let title =
    message.trim();

  title =
    title.replace(
      /^(выполни|выполнено|заверши|завершить|сделано)\s*/i,
      ""
    );

  title =
    title.replace(
      /^отметь выполненной\s*/i,
      ""
    );

  return title
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   CREATE TASK
   ========================================================= */

async function createTask(
  env,
  userId,
  task
) {
  /*
   * 1. INSERT
   */

  const result =
    await env.DB.prepare(`
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
        task.task_type || "one_time",
        task.repeat_rule
      )
      .run();


  /*
   * 2. Проверяем, что INSERT действительно
   * изменил базу.
   */

  const changes =
    Number(
      result.meta?.changes || 0
    );


  const id =
    result.meta?.last_row_id;


  if (
    changes < 1 ||
    !id
  ) {
    throw new Error(
      "D1 INSERT не подтвердил создание задачи."
    );
  }


  /*
   * 3. КРИТИЧЕСКАЯ ПРОВЕРКА
   *
   * Читаем созданную запись обратно.
   */

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
        repeat_rule
      FROM tasks
      WHERE id = ?
        AND user_id = ?
        AND status = 'active'
      LIMIT 1
    `)
      .bind(
        id,
        userId
      )
      .first();


  if (!verification) {
    throw new Error(
      "Задача не прошла проверку после записи в D1."
    );
  }


  /*
   * 4. Возвращаем именно то,
   * что реально лежит в базе.
   */

  return verification;
}


/* =========================================================
   GET TASKS
   ========================================================= */

async function getTasks(
  env,
  userId
) {
  const result =
    await env.DB.prepare(`
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
        id DESC
    `)
      .bind(userId)
      .all();

  return result.results || [];
}


/* =========================================================
   DELETE ALL
   ========================================================= */

async function deleteAllTasks(
  env,
  userId
) {
  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'deleted'
      WHERE user_id = ?
        AND status = 'active'
    `)
      .bind(userId)
      .run();

  return {
    changes:
      Number(
        result.meta?.changes || 0
      )
  };
}


/* =========================================================
   DELETE ONE
   ========================================================= */

async function deleteTask(
  env,
  userId,
  title
) {
  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'deleted'
      WHERE id = (
        SELECT id
        FROM tasks
        WHERE user_id = ?
          AND status = 'active'
          AND LOWER(title) = LOWER(?)
        ORDER BY id DESC
        LIMIT 1
      )
    `)
      .bind(
        userId,
        title
      )
      .run();

  return {
    changes:
      Number(
        result.meta?.changes || 0
      )
  };
}


/* =========================================================
   COMPLETE
   ========================================================= */

async function completeTask(
  env,
  userId,
  title
) {
  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'completed'
      WHERE id = (
        SELECT id
        FROM tasks
        WHERE user_id = ?
          AND status = 'active'
          AND LOWER(title) = LOWER(?)
        ORDER BY id DESC
        LIMIT 1
      )
    `)
      .bind(
        userId,
        title
      )
      .run();

  return {
    changes:
      Number(
        result.meta?.changes || 0
      )
  };
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
  try {
    await env.DB.prepare(`
      INSERT INTO memory
      (
        user_id,
        role,
        content
      )
      VALUES (?, ?, ?)
    `)
      .bind(
        userId,
        role,
        content
      )
      .run();

  } catch (error) {
    console.error(
      "Memory save error:",
      error
    );
  }
}


/* =========================================================
   AI
   ========================================================= */

async function askAI(
  env,
  userId,
  message
) {
  const recentMemory =
    await getRecentMemory(
      env,
      userId,
      12
    );


  const memoryText =
    recentMemory
      .map(item =>
        `${item.role}: ${item.content}`
      )
      .join("\n");


  const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твоя роль:
- персональный помощник;
- организатор;
- собеседник;
- помощник в учебе;
- помощник в работе;
- помощник в планировании.

Стиль:
- спокойный;
- уверенный;
- уважительный;
- естественный;
- лаконичный для простых вопросов;
- подробный для сложных задач.

ВАЖНЫЕ ПРАВИЛА:

1. Никогда не утверждай, что действие выполнено,
если приложение его фактически не выполнило.

2. Никогда не говори:
"задача создана",
"задача удалена",
"напоминание установлено",
если соответствующая операция не была выполнена кодом приложения.

3. Не показывай задачи самостоятельно.

4. Если пользователь просто здоровается —
просто поздоровайся.

5. Не выдумывай данные из базы.

6. Не утверждай, что у тебя есть функция,
если она фактически не подключена.

7. Если пользователь спрашивает о задачах,
а специальная команда не была обработана,
не выдумывай список задач.

8. Ты работаешь в часовом поясе:
${TIME_ZONE}

Последняя история разговора:

${memoryText || "История отсутствует."}
`;


  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              systemPrompt
          },
          {
            role: "user",
            content:
              message
          }
        ]
      }
    );


  /*
   * Правильное извлечение ответа
   * Workers AI.
   */

  const answer =
    result
      ?.choices
      ?.[0]
      ?.message
      ?.content;


  if (
    typeof answer === "string" &&
    answer.trim()
  ) {
    return answer.trim();
  }


  /*
   * Резервный вариант.
   */

  if (
    typeof result?.response === "string" &&
    result.response.trim()
  ) {
    return result.response.trim();
  }


  return "Не удалось получить ответ от AI.";
}


/* =========================================================
   AI TEST
   ========================================================= */

async function aiTest(env) {
  const result =
    await env.AI.run(
      AI_MODEL,
      {
        messages: [
          {
            role: "system",
            content:
              "Ты тестовый модуль J.A.R.V.I.S. Ответь одной короткой фразой."
          },
          {
            role: "user",
            content:
              "Проверь связь."
          }
        ]
      }
    );


  return json({
    ok: true,
    version: VERSION,
    model: AI_MODEL,

    answer:
      result
        ?.choices
        ?.[0]
        ?.message
        ?.content || null,

    raw_keys:
      Object.keys(result || {})
  });
}


/* =========================================================
   RECENT MEMORY
   ========================================================= */

async function getRecentMemory(
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
      .bind(
        userId,
        limit
      )
      .all();


  return (
    result.results || []
  ).reverse();
}


/* =========================================================
   FORMAT TASKS
   ========================================================= */

function formatTasks(tasks) {
  if (!tasks.length) {
    return "Активных задач нет.";
  }


  const lines =
    tasks.map(
      (task, index) => {

        let dateText = "";

        if (
          task.task_date
        ) {
          dateText +=
            ` — ${formatDisplayDate(task.task_date)}`;
        }

        if (
          task.task_time
        ) {
          dateText +=
            ` в ${task.task_time}`;
        }

        return (
          `${index + 1}. ${task.title}${dateText}`
        );
      }
    );


  return (
    `Активные задачи:\n\n` +
    lines.join("\n")
  );
}


/* =========================================================
   FORMAT CREATED TASK
   ========================================================= */

function formatCreatedTask(
  task
) {
  let answer =
    `Задача «${task.title}» добавлена.`;


  if (
    task.task_date
  ) {
    answer +=
      ` Дата: ${formatDisplayDate(task.task_date)}.`;
  }


  if (
    task.task_time
  ) {
    answer +=
      ` Время: ${task.task_time}.`;
  }


  return answer;
}


/* =========================================================
   MOSCOW DATE
   ========================================================= */

function getMoscowDate() {
  /*
   * Получаем календарную дату именно
   * для Europe/Moscow.
   */

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIME_ZONE,
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit"
      }
    ).formatToParts(
      new Date()
    );


  const values = {};

  for (
    const part of parts
  ) {
    if (
      part.type !== "literal"
    ) {
      values[part.type] =
        part.value;
    }
  }


  /*
   * Создаем локальную дату,
   * не зависящую от часового пояса
   * сервера.
   */

  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
}


function addDays(
  date,
  days
) {
  const result =
    new Date(date);

  result.setDate(
    result.getDate() + days
  );

  return result;
}


function formatDate(
  date
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");


  return (
    `${year}-${month}-${day}`
  );
}


function formatDisplayDate(
  dateString
) {
  const parts =
    String(
      dateString
    ).split("-");


  if (
    parts.length !== 3
  ) {
    return dateString;
  }


  return (
    `${parts[2]}.${parts[1]}.${parts[0]}`
  );
}


/* =========================================================
   NORMALIZE
   ========================================================= */

function normalizeText(
  text
) {
  return String(
    text || ""
  )
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   HTTP
   ========================================================= */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type"
  };
}


function json(
  data,
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
        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


function htmlResponse(
  html
) {
  return new Response(
    html,
    {
      headers: {
        ...corsHeaders(),

        "Content-Type":
          "text/html; charset=utf-8"
      }
    }
  );
}


/* =========================================================
   WEB UI
   ========================================================= */

function renderChatUI() {
  return `
<!DOCTYPE html>
<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
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
  color: #f4f7fb;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  overflow: hidden;
}

.app {
  width: 100%;
  height: 100dvh;

  display: flex;
  flex-direction: column;
}

.header {
  padding:
    calc(env(safe-area-inset-top) + 14px)
    18px
    14px;

  border-bottom:
    1px solid #1b2330;

  background:
    linear-gradient(
      180deg,
      #0a0f17,
      #070a0f
    );

  display: flex;
  align-items: center;
  gap: 12px;
}

.arc {
  width: 42px;
  height: 42px;

  border-radius: 50%;

  border:
    2px solid #6aa7ff;

  box-shadow:
    0 0 12px rgba(
      80,
      150,
      255,
      .7
    ),

    inset 0 0 10px rgba(
      80,
      150,
      255,
      .25
    );

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 18px;
  font-weight: 700;
}

.title {
  font-size: 18px;
  font-weight: 700;

  letter-spacing: 2px;
}

.status {
  margin-left: auto;

  color: #72d5a0;

  font-size: 12px;
}

.chat {
  flex: 1;

  overflow-y: auto;

  padding:
    18px 14px 20px;

  scroll-behavior: smooth;
}

.message {
  display: flex;

  margin-bottom: 12px;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 84%;

  padding:
    11px 14px;

  border-radius: 16px;

  white-space: pre-wrap;

  line-height: 1.45;

  font-size: 15px;
}

.user .bubble {
  background: #1d4e89;

  border-bottom-right-radius: 5px;
}

.assistant .bubble {
  background: #111721;

  border:
    1px solid #202b39;

  border-bottom-left-radius: 5px;
}

.input-area {
  padding:
    10px
    12px
    calc(env(safe-area-inset-bottom) + 10px);

  border-top:
    1px solid #1b2330;

  background: #080b10;

  display: flex;

  gap: 8px;
}

textarea {
  flex: 1;

  resize: none;

  min-height: 44px;
  max-height: 130px;

  border:
    1px solid #283446;

  border-radius: 14px;

  background: #0e131b;

  color: white;

  padding:
    11px 13px;

  outline: none;

  font-size: 16px;
}

textarea:focus {
  border-color: #477dc4;
}

button {
  width: 46px;
  height: 46px;

  border: 0;

  border-radius: 14px;

  background: #1d4e89;

  color: white;

  font-size: 20px;
}

button:active {
  transform: scale(.96);
}

.typing {
  display: inline-flex;

  gap: 4px;

  align-items: center;
}

.dot {
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: #8da4c0;

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

  0%,
  60%,
  100% {
    opacity: .3;
  }

  30% {
    opacity: 1;
  }
}

</style>

</head>

<body>

<div class="app">

  <div class="header">

    <div class="arc">
      J
    </div>

    <div class="title">
      J.A.R.V.I.S.
    </div>

    <div class="status">
      ONLINE
    </div>

  </div>


  <div
    id="chat"
    class="chat"
  ></div>


  <div class="input-area">

    <textarea
      id="input"
      rows="1"
      placeholder="Сообщение J.A.R.V.I.S..."
    ></textarea>

    <button
      id="send"
      type="button"
    >
      ➤
    </button>

  </div>

</div>


<script>

const chat =
  document.getElementById(
    "chat"
  );

const input =
  document.getElementById(
    "input"
  );

const send =
  document.getElementById(
    "send"
  );


const STORAGE_KEY =
  "jarvis_chat_history_v510";


function addMessage(
  role,
  text,
  save = true
) {
  const message =
    document.createElement(
      "div"
    );

  message.className =
    "message " + role;


  const bubble =
    document.createElement(
      "div"
    );

  bubble.className =
    "bubble";

  bubble.textContent =
    text;


  message.appendChild(
    bubble
  );

  chat.appendChild(
    message
  );


  chat.scrollTop =
    chat.scrollHeight;


  if (save) {
    saveHistory();
  }
}


function addTyping() {
  const message =
    document.createElement(
      "div"
    );

  message.className =
    "message assistant";

  message.id =
    "typing";


  const bubble =
    document.createElement(
      "div"
    );

  bubble.className =
    "bubble";


  bubble.innerHTML =
    '<span class="typing">' +
      '<span class="dot"></span>' +
      '<span class="dot"></span>' +
      '<span class="dot"></span>' +
    '</span>';


  message.appendChild(
    bubble
  );

  chat.appendChild(
    message
  );


  chat.scrollTop =
    chat.scrollHeight;
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


function saveHistory() {
  const messages =
    [
      ...document.querySelectorAll(
        ".message"
      )
    ]
      .filter(
        x => x.id !== "typing"
      )
      .map(
        x => ({
          role:
            x.classList.contains(
              "user"
            )
              ? "user"
              : "assistant",

          text:
            x.querySelector(
              ".bubble"
            )?.textContent || ""
        })
      );


  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      messages
    )
  );
}


function loadHistory() {
  try {

    const saved =
      JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        )
      );


    if (
      Array.isArray(saved) &&
      saved.length
    ) {

      saved.forEach(
        item => {
          addMessage(
            item.role,
            item.text,
            false
          );
        }
      );

      return;
    }

  } catch (error) {}


  addMessage(
    "assistant",
    "Приветствую. J.A.R.V.I.S. готов к работе.",
    false
  );
}


async function sendMessage() {

  const message =
    input.value.trim();


  if (!message) {
    return;
  }


  input.value = "";

  input.style.height =
    "auto";


  addMessage(
    "user",
    message
  );


  addTyping();


  try {

    const response =
      await fetch(
        "/chat",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              message,
              user_id:
                "web-user"
            })
        }
      );


    const data =
      await response.json();


    removeTyping();


    if (data.ok) {

      addMessage(
        "assistant",
        data.answer
      );

    } else {

      addMessage(
        "assistant",
        "Ошибка: " +
        (
          data.error ||
          "неизвестная ошибка"
        )
      );
    }


  } catch (error) {

    removeTyping();


    addMessage(
      "assistant",
      "Не удалось связаться с J.A.R.V.I.S."
    );
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


loadHistory();

</script>

</body>
</html>
`;
}
