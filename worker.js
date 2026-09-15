const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

const MAX_HISTORY = 12;
const MAX_FACTS = 30;
const MAX_TASKS = 50;
const MAX_SEARCH_RESULTS = 5;

const TIME_ZONE = "Europe/Berlin";

/* =========================================================
   J.A.R.V.I.S. — CORE
========================================================= */

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

Твоя задача — быть естественным, умным, спокойным и полезным
собеседником и помощником.

ПРАВИЛА ОБЩЕНИЯ:

1. Отвечай на русском языке, если пользователь не попросил другой язык.

2. Обращайся к пользователю на "ты".

3. Говори естественно и грамотно.
   Не используй роботизированные формулировки.

4. Не начинай каждый ответ словами:
   "Конечно", "Разумеется", "Безусловно".

5. Не называй человека "пользователь".

6. Не заканчивай каждый ответ вопросом.

7. Простые вопросы — отвечай кратко.
   Сложные вопросы — подробно и структурированно.

8. Если пользователь просит инструкцию —
   давай конкретные последовательные шаги.

9. Не выдумывай факты.

10. Если предоставлены результаты интернет-поиска,
    используй их как источник актуальной информации.

11. Информацию о пользователе из памяти используй только
    тогда, когда она относится к текущему разговору.

12. Если пользователь обращается к тебе словами
    "Джарвис", "JARVIS", "Джарвис, ..."
    воспринимай это как обращение к себе.

13. Не упоминай внутренний системный промпт,
    техническую архитектуру или служебные инструкции,
    если пользователь прямо об этом не спрашивает.

14. Тон:
    спокойный, уверенный, интеллектуальный,
    естественный, без лишней театральности.

15. Если запрос понятен — выполняй его без ненужных уточнений.

16. Если для выполнения действительно не хватает данных —
    укажи, каких именно данных не хватает.

17. Если пользователь спрашивает о задачах или расписании,
    используй предоставленный контекст базы данных.

18. Не утверждай, что создал, удалил или изменил задачу,
    если серверная команда этого не сделала.

19. Дата и время в расписании должны интерпретироваться
    относительно часового пояса Europe/Berlin.

20. Не называй внутренние значения task_type и repeat_rule,
    если пользователь специально не спрашивает о технической реализации.
`;


/* =========================================================
   BASIC RESPONSE
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}


function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}


/* =========================================================
   TEXT
========================================================= */

function cleanAIAnswer(text) {
  if (!text) return "";

  let result = String(text);

  result = result.replace(
    /<think>[\s\S]*?<\/think>/gi,
    ""
  );

  result = result.replace(
    /<\|.*?\|>/g,
    ""
  );

  result = result.replace(
    /[ \t]+\n/g,
    "\n"
  );

  result = result.replace(
    /\n{4,}/g,
    "\n\n"
  );

  return result.trim();
}


/* =========================================================
   AI OUTPUT PARSER
========================================================= */

function extractAIText(result) {
  if (!result) return "";

  if (typeof result === "string") {
    return cleanAIAnswer(result);
  }

  if (
    Array.isArray(result.choices) &&
    result.choices.length
  ) {
    const choice = result.choices[0];

    if (choice?.message?.content) {

      if (
        typeof choice.message.content === "string"
      ) {
        return cleanAIAnswer(
          choice.message.content
        );
      }

      if (
        Array.isArray(choice.message.content)
      ) {
        return cleanAIAnswer(
          choice.message.content
            .map(item => {

              if (typeof item === "string") {
                return item;
              }

              return (
                item?.text ||
                item?.content ||
                ""
              );

            })
            .join("")
        );
      }
    }

    if (
      typeof choice?.text === "string"
    ) {
      return cleanAIAnswer(
        choice.text
      );
    }
  }

  const candidates = [
    result.response,
    result.text,
    result.content,
    result.output_text,
    result.message?.content,
    result.output?.text,
    result.output?.content
  ];

  for (const candidate of candidates) {

    if (
      typeof candidate === "string" &&
      candidate.trim()
    ) {
      return cleanAIAnswer(candidate);
    }

    if (Array.isArray(candidate)) {

      const text = candidate
        .map(item => {

          if (typeof item === "string") {
            return item;
          }

          return (
            item?.text ||
            item?.content ||
            ""
          );

        })
        .join("");

      if (text.trim()) {
        return cleanAIAnswer(text);
      }
    }
  }

  return "";
}


/* =========================================================
   AI
========================================================= */

async function askAI(env, messages) {

  const result =
    await env.AI.run(
      MODEL,
      {
        messages,

        max_completion_tokens: 1024,

        temperature: 0.65,

        reasoning_effort: "low",

        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    );

  console.log(
    "AI RESULT:",
    JSON.stringify(result)
  );

  const answer =
    extractAIText(result);

  if (!answer) {
    throw new Error(
      "Workers AI вернул пустой текстовый ответ."
    );
  }

  return answer;
}


/* =========================================================
   CONVERSATION MEMORY
========================================================= */

async function saveMessage(
  env,
  role,
  content
) {

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


async function getHistory(env) {

  const result =
    await env.DB.prepare(`
      SELECT role, content
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

  return (result.results || [])
    .reverse()
    .map(row => ({
      role: row.role,
      content: row.content
    }));
}


/* =========================================================
   FACTS
========================================================= */

function normalizeFact(text) {

  let fact =
    String(text)
      .trim()
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      )
      .replace(
        /^запомни\s*/i,
        ""
      )
      .replace(
        /^запиши\s*/i,
        ""
      )
      .replace(
        /^сохрани\s*/i,
        ""
      )
      .replace(
        /^учти\s*/i,
        ""
      )
      .trim();

  if (!fact) return "";

  fact = fact.replace(
    /^я люблю\s+/i,
    "Ты любишь "
  );

  fact = fact.replace(
    /^я предпочитаю\s+/i,
    "Ты предпочитаешь "
  );

  fact = fact.replace(
    /^я не люблю\s+/i,
    "Ты не любишь "
  );

  fact = fact.replace(
    /^мне нравится\s+/i,
    "Тебе нравится "
  );

  fact = fact.replace(
    /^мне не нравится\s+/i,
    "Тебе не нравится "
  );

  fact = fact.replace(
    /^я хочу\s+/i,
    "Ты хочешь "
  );

  fact = fact.replace(
    /^я выбираю\s+/i,
    "Ты выбираешь "
  );

  fact = fact.replace(
    /\*\*/g,
    ""
  );

  return fact.trim();
}


async function saveFact(
  env,
  fact,
  category = "preference"
) {

  const normalized =
    normalizeFact(fact);

  if (!normalized) return;

  const existing =
    await env.DB.prepare(`
      SELECT id
      FROM facts
      WHERE user_id = ?
      AND fact = ?
      LIMIT 1
    `)
      .bind(
        USER_ID,
        normalized
      )
      .first();

  if (existing) {

    await env.DB.prepare(`
      UPDATE facts
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind(existing.id)
      .run();

    return;
  }

  await env.DB.prepare(`
    INSERT INTO facts
      (user_id, category, fact)
    VALUES (?, ?, ?)
  `)
    .bind(
      USER_ID,
      category,
      normalized
    )
    .run();
}


async function getFacts(env) {

  const result =
    await env.DB.prepare(`
      SELECT id, category, fact
      FROM facts
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `)
      .bind(
        USER_ID,
        MAX_FACTS
      )
      .all();

  return result.results || [];
}


async function deleteFact(
  env,
  text
) {

  const search =
    String(text)
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      )
      .replace(
        /^забудь\s*/i,
        ""
      )
      .replace(
        /^удали из памяти\s*/i,
        ""
      )
      .trim();

  if (!search) return false;

  const result =
    await env.DB.prepare(`
      DELETE FROM facts
      WHERE user_id = ?
      AND fact LIKE ?
    `)
      .bind(
        USER_ID,
        `%${search}%`
      )
      .run();

  return Number(
    result.meta?.changes || 0
  ) > 0;
}


async function clearFacts(env) {

  await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();
}


async function clearAllMemory(env) {

  await env.DB.prepare(`
    DELETE FROM memory
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();

  await env.DB.prepare(`
    DELETE FROM facts
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();

  await env.DB.prepare(`
    DELETE FROM tasks
    WHERE user_id = ?
  `)
    .bind(USER_ID)
    .run();
}


/* =========================================================
   DATE HELPERS
========================================================= */

function localDate() {

  const now =
    new Date();

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

  return formatter.format(now);
}


function addDays(
  dateString,
  amount
) {

  const date =
    new Date(
      dateString + "T12:00:00"
    );

  date.setDate(
    date.getDate() + amount
  );

  return date
    .toISOString()
    .slice(0, 10);
}


function resolveTaskDate(text) {

  const lower =
    String(text)
      .toLowerCase();

  const today =
    localDate();

  if (
    lower.includes("послезавтра")
  ) {
    return addDays(
      today,
      2
    );
  }

  if (
    lower.includes("завтра")
  ) {
    return addDays(
      today,
      1
    );
  }

  if (
    lower.includes("сегодня")
  ) {
    return today;
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

  for (
    const [name, targetDay]
    of Object.entries(weekdays)
  ) {

    if (
      lower.includes(
        "в " + name
      ) ||
      lower.includes(
        name
      )
    ) {

      const current =
        new Date(
          today + "T12:00:00"
        );

      const currentDay =
        current.getDay();

      let diff =
        targetDay -
        currentDay;

      if (diff <= 0) {
        diff += 7;
      }

      return addDays(
        today,
        diff
      );
    }
  }

  return null;
}


function resolveTaskTime(text) {

  const lower =
    String(text)
      .toLowerCase();

  const match =
    lower.match(
      /\b(?:в\s*)?([01]?\d|2[0-3])[:.](\d{2})\b/
    );

  if (match) {

    return (
      String(match[1])
        .padStart(2, "0") +
      ":" +
      match[2]
    );
  }

  const hourMatch =
    lower.match(
      /\bв\s+([0-9]{1,2})\s*(час(?:а|ов)?|утра|дня|вечера|ночи)\b/
    );

  if (hourMatch) {

    let hour =
      Number(
        hourMatch[1]
      );

    const period =
      hourMatch[2];

    if (
      period.includes("вечер") &&
      hour < 12
    ) {
      hour += 12;
    }

    if (
      period.includes("дня") &&
      hour < 12
    ) {
      hour += 12;
    }

    if (
      period.includes("ноч") &&
      hour === 12
    ) {
      hour = 0;
    }

    return (
      String(hour)
        .padStart(2, "0") +
      ":00"
    );
  }

  return null;
}


function getTodayWeekday() {

  const date =
    new Date(
      localDate() +
      "T12:00:00"
    );

  return date.getDay();
}


function formatDateRu(
  dateString
) {

  const date =
    new Date(
      dateString +
      "T12:00:00"
    );

  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      weekday: "long",
      day: "numeric",
      month: "long"
    }
  ).format(date);
}


function formatShortDate(
  dateString
) {

  const date =
    new Date(
      dateString +
      "T12:00:00"
    );

  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      day: "2-digit",
      month: "2-digit"
    }
  ).format(date);
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
  repeatRule = null
) {

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
        USER_ID,
        title,
        taskDate,
        taskTime,
        taskType,
        repeatRule
      )
      .run();

  return result.meta?.last_row_id || null;
}


async function getTasks(
  env,
  taskDate = null,
  taskType = null
) {

  let result;

  if (
    taskDate &&
    taskType
  ) {

    result =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          task_date,
          task_time,
          task_type,
          repeat_rule,
          status
        FROM tasks
        WHERE user_id = ?
        AND task_date = ?
        AND task_type = ?
        AND status = 'active'
        ORDER BY
          CASE
            WHEN task_time IS NULL THEN 1
            ELSE 0
          END,
          task_time,
          id
        LIMIT ?
      `)
        .bind(
          USER_ID,
          taskDate,
          taskType,
          MAX_TASKS
        )
        .all();

  } else if (taskDate) {

    result =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          task_date,
          task_time,
          task_type,
          repeat_rule,
          status
        FROM tasks
        WHERE user_id = ?
        AND task_date = ?
        AND status = 'active'
        ORDER BY
          CASE
            WHEN task_time IS NULL THEN 1
            ELSE 0
          END,
          task_time,
          id
        LIMIT ?
      `)
        .bind(
          USER_ID,
          taskDate,
          MAX_TASKS
        )
        .all();

  } else if (taskType) {

    result =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          task_date,
          task_time,
          task_type,
          repeat_rule,
          status
        FROM tasks
        WHERE user_id = ?
        AND task_type = ?
        AND status = 'active'
        ORDER BY
          CASE
            WHEN task_date IS NULL THEN 1
            ELSE 0
          END,
          task_date,
          task_time,
          id
        LIMIT ?
      `)
        .bind(
          USER_ID,
          taskType,
          MAX_TASKS
        )
        .all();

  } else {

    result =
      await env.DB.prepare(`
        SELECT
          id,
          title,
          task_date,
          task_time,
          task_type,
          repeat_rule,
          status
        FROM tasks
        WHERE user_id = ?
        AND status = 'active'
        ORDER BY
          CASE
            WHEN task_date IS NULL THEN 1
            ELSE 0
          END,
          task_date,
          task_time,
          id
        LIMIT ?
      `)
        .bind(
          USER_ID,
          MAX_TASKS
        )
        .all();
  }

  return result.results || [];
}


async function deleteTask(
  env,
  search
) {

  const result =
    await env.DB.prepare(`
      DELETE FROM tasks
      WHERE user_id = ?
      AND status = 'active'
      AND title LIKE ?
    `)
      .bind(
        USER_ID,
        `%${search}%`
      )
      .run();

  return Number(
    result.meta?.changes || 0
  ) > 0;
}


async function completeTask(
  env,
  search
) {

  const result =
    await env.DB.prepare(`
      UPDATE tasks
      SET status = 'completed'
      WHERE user_id = ?
      AND status = 'active'
      AND title LIKE ?
    `)
      .bind(
        USER_ID,
        `%${search}%`
      )
      .run();

  return Number(
    result.meta?.changes || 0
  ) > 0;
}


/* =========================================================
   COMMAND DETECTION
========================================================= */

function isSaveMemoryCommand(text) {

  return /^(джарвис[,:]?\s*)?(запомни|запиши|сохрани|учти)\b/i
    .test(text.trim());
}


function isRecallCommand(text) {

  return /^(джарвис[,:]?\s*)?(что я люблю|что ты знаешь обо мне|что ты помнишь|покажи память|покажи что ты помнишь|какая у тебя память)/i
    .test(text.trim());
}


function isDeleteFactCommand(text) {

  return /^(джарвис[,:]?\s*)?(забудь|удали из памяти)\b/i
    .test(text.trim());
}


function isClearFactsCommand(text) {

  return /^(джарвис[,:]?\s*)?(очисти предпочтения|удали все предпочтения)/i
    .test(text.trim());
}


function isClearAllCommand(text) {

  return /^(джарвис[,:]?\s*)?(очисти всю память|забудь всё|забудь все|удали всю память)/i
    .test(text.trim());
}


function isCreateTaskCommand(text) {

  const clean =
    text
      .trim()
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      );

  const lower =
    clean.toLowerCase();

  return (
    /^(создай|добавь|поставь|запиши)\s+(задачу|дело|напоминание)/i
      .test(clean) ||

    /^напомни мне\b/i
      .test(clean) ||

    /^(сегодня|завтра|послезавтра)\b/i
      .test(clean) ||

    /^в\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\b/i
      .test(clean) ||

    (
      /\b(в|на)\s+(сегодня|завтра|послезавтра)\b/i
        .test(lower) &&
      /\b(в|на)\s+\d{1,2}([:.]\d{2})?/i
        .test(lower)
    )
  );
}


function isListTasksCommand(text) {

  const clean =
    text
      .trim()
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      );

  return (
    /^(какие у меня задачи|покажи задачи|мои задачи|список задач)/i
      .test(clean) ||

    /^что у меня\s+(сегодня|завтра|послезавтра)/i
      .test(clean)
  );
}


function isDeleteTaskCommand(text) {

  return /^(джарвис[,:]?\s*)?(удали|убери)\s+(задачу|дело|напоминание)/i
    .test(text.trim());
}


function isCompleteTaskCommand(text) {

  return /^(джарвис[,:]?\s*)?(выполнил|выполнено|заверши|закрой)\s+(задачу|дело)/i
    .test(text.trim());
}


function isWeekScheduleCommand(text) {

  const clean =
    text
      .trim()
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      );

  return (
    /^(покажи|покажи мне|выведи|покажи моё|покажи мое)?\s*(расписание|план)\s*(на\s*)?(эту\s*)?неделю/i
      .test(clean)
  );
}


function isScheduleDayCommand(text) {

  const clean =
    text
      .trim()
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      );

  return (
    /^что у меня\s+(сегодня|завтра|послезавтра)/i
      .test(clean) ||

    /^расписание\s+(на\s+)?(сегодня|завтра|послезавтра)/i
      .test(clean) ||

    /^план\s+(на\s+)?(сегодня|завтра|послезавтра)/i
      .test(clean)
  );
}


/* =========================================================
   TASK TITLE
========================================================= */

function extractTaskTitle(text) {

  let title =
    String(text)
      .replace(
        /^джарвис[,:]?\s*/i,
        ""
      )
      .replace(
        /^(создай|добавь|поставь|запиши)\s+(задачу|дело|напоминание)\s*:?\s*/i,
        ""
      )
      .replace(
        /^напомни мне\s*:?\s*/i,
        ""
      )
      .replace(
        /^(сегодня|завтра|послезавтра)\s*/i,
        ""
      )
      .replace(
        /^в\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\s*/i,
        ""
      )
      .trim();

  title =
    title.replace(
      /\bв\s+([01]?\d|2[0-3])[:.](\d{2})\b/gi,
      ""
    );

  title =
    title.replace(
      /\b([01]?\d|2[0-3])[:.](\d{2})\b/gi,
      ""
    );

  title =
    title.replace(
      /\bв\s+([0-9]{1,2})\s*(час(?:а|ов)?|утра|дня|вечера|ночи)\b/gi,
      ""
    );

  title =
    title.replace(
      /\s{2,}/g,
      " "
    );

  return title.trim();
}


/* =========================================================
   SCHEDULE TITLE CLEANER
========================================================= */

function cleanScheduleTitle(text) {

  let title =
    extractTaskTitle(text);

  title =
    title.replace(
      /^(на\s+)?(сегодня|завтра|послезавтра)\s*/i,
      ""
    );

  title =
    title.replace(
      /^на\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\s*/i,
      ""
    );

  title =
    title.replace(
      /^в\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\s*/i,
      ""
    );

  return title
    .replace(
      /\s{2,}/g,
      " "
    )
    .trim();
}


/* =========================================================
   WEB SEARCH
========================================================= */

function shouldSearch(text) {

  const triggers = [
    "сегодня",
    "сейчас",
    "новости",
    "актуаль",
    "текущ",
    "2026",
    "цена",
    "стоимость",
    "курс",
    "погода",
    "найди",
    "найти",
    "поищи",
    "посмотри",
    "сколько стоит",
    "последние",
    "свежие",
    "кто сейчас",
    "что сейчас"
  ];

  const lower =
    text.toLowerCase();

  return triggers.some(
    trigger =>
      lower.includes(trigger)
  );
}


function decodeHtml(str) {

  return String(str)
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#x27;/g,
      "'"
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    );
}


function stripHtml(str) {

  return decodeHtml(
    String(str)
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        ""
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        ""
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}


async function searchWeb(query) {

  try {

    const url =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);

    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
          }
        }
      );

    if (!response.ok) {
      return [];
    }

    const htmlText =
      await response.text();

    const results = [];

    const regex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match = regex.exec(htmlText)) !== null &&
      results.length < MAX_SEARCH_RESULTS
    ) {

      const link =
        match[1];

      const title =
        stripHtml(
          match[2]
        );

      if (
        !title ||
        !link
      ) {
        continue;
      }

      let finalLink =
        link;

      try {

        const parsed =
          new URL(link);

        if (
          parsed.hostname.includes(
            "duckduckgo.com"
          )
        ) {

          const uddg =
            parsed.searchParams.get(
              "uddg"
            );

          if (uddg) {
            finalLink =
              decodeURIComponent(
                uddg
              );
          }
        }

      } catch (_) {}

      results.push({
        title,
        url: finalLink
      });
    }

    return results;

  } catch (error) {

    console.log(
      "SEARCH ERROR:",
      error
    );

    return [];
  }
}


/* =========================================================
   MEMORY CONTEXT
========================================================= */

async function buildMemoryContext(env) {

  const facts =
    await getFacts(env);

  if (!facts.length) {
    return "";
  }

  return `
СОХРАНЁННАЯ ИНФОРМАЦИЯ О ЕГОРЕ:

${facts
  .map(
    (item, index) =>
      `${index + 1}. ${item.fact}`
  )
  .join("\n")}

Используй эту информацию,
только если она относится к текущему разговору.
`;
}


/* =========================================================
   TASK CONTEXT
========================================================= */

async function buildTaskContext(env) {

  const tasks =
    await getTasks(env);

  if (!tasks.length) {
    return "";
  }

  return `
АКТИВНЫЕ ЗАДАЧИ И СОБЫТИЯ ЕГОРА:

${tasks
  .map(task => {

    const type =
      task.task_type === "schedule"
        ? "расписание"
        : "задача";

    const date =
      task.task_date
        ? `, дата: ${task.task_date}`
        : "";

    const time =
      task.task_time
        ? `, время: ${task.task_time}`
        : "";

    return (
      `ID ${task.id}: [${type}] ${task.title}` +
      date +
      time
    );

  })
  .join("\n")}

Не изменяй задачи самостоятельно.
Изменение задач выполняется сервером.
`;
}


/* =========================================================
   SCHEDULE — WEEK
========================================================= */

async function buildWeekSchedule(
  env
) {

  const today =
    localDate();

  const lines = [];

  for (
    let i = 0;
    i < 7;
    i++
  ) {

    const date =
      addDays(
        today,
        i
      );

    const events =
      await getTasks(
        env,
        date,
        "schedule"
      );

    const heading =
      formatDateRu(
        date
      );

    lines.push(
      `📅 ${heading}`
    );

    if (!events.length) {

      lines.push(
        "— свободно"
      );

    } else {

      for (
        const event
        of events
      ) {

        let line =
          "• ";

        if (
          event.task_time
        ) {

          line +=
            event.task_time +
            " — ";
        }

        line +=
          event.title;

        lines.push(
          line
        );
      }
    }

    lines.push("");
  }

  return (
    "Твоё расписание на ближайшие 7 дней:\n\n" +
    lines.join("\n")
  );
}


/* =========================================================
   CHAT HANDLER
========================================================= */

async function handleChat(
  request,
  env
) {

  let body;

  try {

    body =
      await request.json();

  } catch (_) {

    return json(
      {
        ok: false,
        error: "Некорректный JSON."
      },
      400
    );
  }


  const userMessage =
    String(
      body.message || ""
    ).trim();


  if (!userMessage) {

    return json(
      {
        ok: false,
        error: "Сообщение пустое."
      },
      400
    );
  }


  /* =======================================================
     CLEAR ALL
  ======================================================= */

  if (
    isClearAllCommand(
      userMessage
    )
  ) {

    await clearAllMemory(
      env
    );

    return json({
      ok: true,
      answer:
        "Готово. Я очистил всю сохранённую память, задачи и расписание."
    });
  }


  /* =======================================================
     MEMORY
  ======================================================= */

  if (
    isSaveMemoryCommand(
      userMessage
    )
  ) {

    const fact =
      normalizeFact(
        userMessage
      );

    if (!fact) {

      return json({
        ok: true,
        answer:
          "Скажи, что именно мне нужно запомнить."
      });
    }

    await saveFact(
      env,
      fact
    );

    return json({
      ok: true,
      answer:
        `Запомнил: ${fact}`
    });
  }


  if (
    isRecallCommand(
      userMessage
    )
  ) {

    const facts =
      await getFacts(
        env
      );

    if (!facts.length) {

      return json({
        ok: true,
        answer:
          "Пока в моей памяти ничего нет."
      });
    }

    return json({
      ok: true,
      answer:
        "Вот что я помню о тебе:\n\n" +
        facts
          .map(
            (item, index) =>
              `${index + 1}. ${item.fact}`
          )
          .join("\n")
    });
  }


  if (
    isDeleteFactCommand(
      userMessage
    )
  ) {

    const deleted =
      await deleteFact(
        env,
        userMessage
      );

    return json({
      ok: true,
      answer: deleted
        ? "Готово. Я удалил эту информацию из памяти."
        : "Я не нашёл такую информацию в памяти."
    });
  }


  if (
    isClearFactsCommand(
      userMessage
    )
  ) {

    await clearFacts(
      env
    );

    return json({
      ok: true,
      answer:
        "Готово. Сохранённые предпочтения удалены."
    });
  }


  /* =======================================================
     WEEK SCHEDULE
  ======================================================= */

  if (
    isWeekScheduleCommand(
      userMessage
    )
  ) {

    const answer =
      await buildWeekSchedule(
        env
      );

    return json({
      ok: true,
      answer
    });
  }


  /* =======================================================
     DAY SCHEDULE
  ======================================================= */

  if (
    isScheduleDayCommand(
      userMessage
    )
  ) {

    const taskDate =
      resolveTaskDate(
        userMessage
      );

    const events =
      await getTasks(
        env,
        taskDate,
        "schedule"
      );

    if (!events.length) {

      return json({
        ok: true,
        answer:
          taskDate
            ? `На ${formatDateRu(taskDate)} расписание свободно.`
            : "В расписании пока ничего нет."
      });
    }

    const lines =
      events
        .map(event => {

          let line =
            "• ";

          if (
            event.task_time
          ) {

            line +=
              event.task_time +
              " — ";
          }

          line +=
            event.title;

          return line;
        })
        .join("\n");

    return json({
      ok: true,
      answer:
        `Расписание на ${formatDateRu(taskDate)}:\n\n${lines}`
    });
  }


  /* =======================================================
     CREATE TASK / SCHEDULE
  ======================================================= */

  if (
    isCreateTaskCommand(
      userMessage
    )
  ) {

    const taskDate =
      resolveTaskDate(
        userMessage
      );

    const taskTime =
      resolveTaskTime(
        userMessage
      );

    const title =
      cleanScheduleTitle(
        userMessage
      );

    if (!title) {

      return json({
        ok: true,
        answer:
          "Что именно нужно записать?"
      });
    }

    const isSchedule =
      Boolean(
        taskDate ||
        taskTime
      );

    const taskType =
      isSchedule
        ? "schedule"
        : "task";

    const id =
      await createTask(
        env,
        title,
        taskDate,
        taskTime,
        taskType,
        null
      );

    let answer =
      isSchedule
        ? `Записал в расписание: ${title}`
        : `Добавил задачу: ${title}`;

    if (
      taskDate
    ) {

      answer +=
        `\nДата: ${formatDateRu(taskDate)}`;
    }

    if (
      taskTime
    ) {

      answer +=
        `\nВремя: ${taskTime}`;
    }

    if (
      id
    ) {

      answer +=
        `\nID: ${id}`;
    }

    return json({
      ok: true,
      answer
    });
  }


  /* =======================================================
     TASK LIST
  ======================================================= */

  if (
    isListTasksCommand(
      userMessage
    )
  ) {

    const taskDate =
      resolveTaskDate(
        userMessage
      );

    const tasks =
      await getTasks(
        env,
        taskDate,
        taskDate
          ? null
          : "task"
      );

    if (!tasks.length) {

      return json({
        ok: true,
        answer:
          taskDate
            ? `На ${formatDateRu(taskDate)} задач нет.`
            : "Активных задач сейчас нет."
      });
    }

    const answer =
      tasks
        .map(task => {

          let line =
            `• ${task.title}`;

          if (
            task.task_date
          ) {

            line +=
              ` — ${formatShortDate(task.task_date)}`;
          }

          if (
            task.task_time
          ) {

            line +=
              ` в ${task.task_time}`;
          }

          return line;
        })
        .join("\n");

    return json({
      ok: true,
      answer:
        taskDate
          ? `Задачи на ${formatDateRu(taskDate)}:\n\n${answer}`
          : `Твои активные задачи:\n\n${answer}`
    });
  }


  /* =======================================================
     TASK DELETE
  ======================================================= */

  if (
    isDeleteTaskCommand(
      userMessage
    )
  ) {

    let search =
      userMessage
        .replace(
          /^джарвис[,:]?\s*/i,
          ""
        )
        .replace(
          /^(удали|убери)\s+(задачу|дело|напоминание)\s*/i,
          ""
        )
        .replace(
          /^про\s+/i,
          ""
        )
        .trim();

    if (!search) {

      return json({
        ok: true,
        answer:
          "Укажи, какую задачу удалить."
      });
    }

    const deleted =
      await deleteTask(
        env,
        search
      );

    return json({
      ok: true,
      answer: deleted
        ? "Готово. Задача или событие удалено."
        : "Я не нашёл такую активную задачу или событие."
    });
  }


  /* =======================================================
     TASK COMPLETE
  ======================================================= */

  if (
    isCompleteTaskCommand(
      userMessage
    )
  ) {

    let search =
      userMessage
        .replace(
          /^джарвис[,:]?\s*/i,
          ""
        )
        .replace(
          /^(выполнил|выполнено|заверши|закрой)\s+(задачу|дело)\s*/i,
          ""
        )
        .trim();

    if (!search) {

      return json({
        ok: true,
        answer:
          "Укажи, какую задачу отметить выполненной."
      });
    }

    const completed =
      await completeTask(
        env,
        search
      );

    return json({
      ok: true,
      answer: completed
        ? "Отметил задачу как выполненную."
        : "Я не нашёл такую активную задачу."
    });
  }


  /* =======================================================
     NORMAL CHAT
  ======================================================= */

  await saveMessage(
    env,
    "user",
    userMessage
  );


  const history =
    await getHistory(
      env
    );


  const memoryContext =
    await buildMemoryContext(
      env
    );


  const taskContext =
    await buildTaskContext(
      env
    );


  /* =======================================================
     SEARCH
  ======================================================= */

  let searchResults = [];

  if (
    shouldSearch(
      userMessage
    )
  ) {

    searchResults =
      await searchWeb(
        userMessage
      );
  }


  let searchContext = "";

  if (
    searchResults.length
  ) {

    searchContext = `
АКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ИНТЕРНЕТ-ПОИСКА:

${searchResults
  .map(
    (item, index) =>
      `${index + 1}. ${item.title}
URL: ${item.url}`
  )
  .join("\n\n")}

Используй эти данные,
если они относятся к вопросу.
Не выдумывай сведения,
которых нет в результатах.
`;
  }


  /* =======================================================
     AI
  ======================================================= */

  const messages = [

    {
      role: "system",

      content:
        SYSTEM_PROMPT +
        "\n\n" +
        memoryContext +
        "\n\n" +
        taskContext +
        "\n\n" +
        searchContext
    },

    ...history
  ];


  let answer;

  try {

    answer =
      await askAI(
        env,
        messages
      );

  } catch (error) {

    console.log(
      "AI ERROR:",
      error?.stack ||
      error
    );

    return json(
      {
        ok: false,
        error:
          "Ошибка Workers AI: " +
          (
            error?.message ||
            String(error)
          )
      },
      500
    );
  }


  await saveMessage(
    env,
    "assistant",
    answer
  );


  return json({
    ok: true,
    answer,
    sources: searchResults
  });
}


/* =========================================================
   HEALTH
========================================================= */

async function handleHealth(env) {

  let databaseOk = false;
  let aiOk = false;

  let databaseError = null;
  let aiError = null;

  let aiRaw = null;
  let aiAnswer = null;


  try {

    await env.DB.prepare(
      "SELECT 1 AS ok"
    ).first();

    databaseOk = true;

  } catch (error) {

    databaseError =
      error?.message ||
      String(error);
  }


  try {

    const result =
      await env.AI.run(
        MODEL,
        {
          messages: [
            {
              role: "system",
              content:
                "Ты тестовый модуль J.A.R.V.I.S. Ответь одним словом."
            },
            {
              role: "user",
              content:
                "Ответь: готов"
            }
          ],

          max_completion_tokens: 128,

          temperature: 0,

          reasoning_effort: "low",

          chat_template_kwargs: {
            enable_thinking: false
          }
        }
      );

    aiRaw = result;

    aiAnswer =
      extractAIText(
        result
      );

    if (!aiAnswer) {

      throw new Error(
        "AI вернул ответ без текста."
      );
    }

    aiOk = true;

  } catch (error) {

    aiError =
      error?.message ||
      String(error);
  }


  return json({
    ok:
      databaseOk &&
      aiOk,

    checks: {
      worker: true,
      database: databaseOk,
      ai: aiOk
    },

    databaseError,

    aiError,

    aiAnswer,

    aiRaw,

    model: MODEL,

    time:
      new Date().toISOString()
  });
}


/* =========================================================
   HTML
========================================================= */

function getHTML() {

  return `<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
/>

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;

  background:
    radial-gradient(
      circle at top,
      #18202c,
      #080b10 45%,
      #030405
    );

  color: #f2f5f8;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "Segoe UI",
    sans-serif;
}

body {
  min-height: 100vh;

  display: flex;
  justify-content: center;
}

.app {
  width: 100%;
  max-width: 720px;
  min-height: 100vh;

  display: flex;
  flex-direction: column;

  padding:
    env(safe-area-inset-top)
    14px
    env(safe-area-inset-bottom);
}

.header {
  padding: 20px 8px 14px;

  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
}

.status {
  font-size: 10px;
  color: #7df5b5;
  letter-spacing: 1px;
}

.chat {
  flex: 1;

  overflow-y: auto;

  padding:
    8px 2px 130px;
}

.message {
  max-width: 88%;

  margin: 10px 0;

  padding: 13px 15px;

  border-radius: 18px;

  line-height: 1.48;

  white-space: pre-wrap;

  word-break: break-word;
}

.assistant {
  margin-right: auto;

  background:
    rgba(255,255,255,0.08);

  border:
    1px solid rgba(255,255,255,0.07);
}

.user {
  margin-left: auto;

  background:
    rgba(70,130,255,0.22);

  border:
    1px solid rgba(100,160,255,0.18);
}

.sources {
  margin-top: 8px;

  font-size: 12px;
}

.sources a {
  display: block;

  margin: 6px 0;

  color: #7db7ff;

  text-decoration: none;
}

.bottom {
  position: fixed;

  left: 0;
  right: 0;
  bottom: 0;

  padding:
    10px
    max(10px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(10px, env(safe-area-inset-left));

  background:
    linear-gradient(
      to top,
      #030405 70%,
      transparent
    );
}

.composer {
  max-width: 720px;

  margin: auto;

  display: flex;

  gap: 8px;

  background:
    rgba(20,24,31,0.94);

  border:
    1px solid rgba(255,255,255,0.08);

  border-radius: 22px;

  padding: 8px;
}

textarea {
  flex: 1;

  min-height: 44px;
  max-height: 130px;

  resize: none;

  border: 0;
  outline: 0;

  background: transparent;

  color: white;

  font-size: 16px;

  padding: 10px;
}

button {
  width: 46px;
  height: 46px;

  border: 0;

  border-radius: 16px;

  background: white;

  color: black;

  font-size: 19px;

  font-weight: 700;
}

button:disabled {
  opacity: .45;
}

.debug {
  text-align: center;

  font-size: 9px;

  color: #555;

  margin-top: 4px;
}

</style>

</head>

<body>

<div class="app">

  <div class="header">

    <div class="brand">
      J.A.R.V.I.S.
    </div>

    <div
      id="status"
      class="status"
    >
      READY
    </div>

  </div>


  <div
    id="chat"
    class="chat"
  >

    <div class="message assistant">
      Привет. Я на связи.
    </div>

  </div>


  <div class="bottom">

    <form
      id="form"
      class="composer"
    >

      <textarea
        id="input"
        placeholder="Напиши Джарвису..."
        autocomplete="off"
        rows="1"
      ></textarea>

      <button
        id="send"
        type="submit"
      >
        ↑
      </button>

    </form>

    <div
      id="debug"
      class="debug"
    >
      READY
    </div>

  </div>

</div>


<script>

const form =
  document.getElementById("form");

const input =
  document.getElementById("input");

const send =
  document.getElementById("send");

const chat =
  document.getElementById("chat");

const status =
  document.getElementById("status");

const debug =
  document.getElementById("debug");


function setStatus(value) {

  status.textContent =
    value;

  debug.textContent =
    value;
}


function addMessage(
  text,
  role
) {

  const div =
    document.createElement(
      "div"
    );

  div.className =
    "message " +
    role;

  div.textContent =
    text;

  chat.appendChild(
    div
  );

  chat.scrollTop =
    chat.scrollHeight;
}


function addSources(
  sources
) {

  if (
    !sources ||
    !sources.length
  ) {
    return;
  }

  const box =
    document.createElement(
      "div"
    );

  box.className =
    "sources";

  sources.forEach(
    source => {

      const a =
        document.createElement(
          "a"
        );

      a.href =
        source.url;

      a.target =
        "_blank";

      a.rel =
        "noopener noreferrer";

      a.textContent =
        "↗ " +
        source.title;

      box.appendChild(
        a
      );

    }
  );

  chat.appendChild(
    box
  );

  chat.scrollTop =
    chat.scrollHeight;
}


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


input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      form.requestSubmit();
    }
  }
);


form.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const text =
      input.value.trim();

    if (!text) {
      return;
    }

    addMessage(
      text,
      "user"
    );

    input.value =
      "";

    input.style.height =
      "auto";

    send.disabled =
      true;

    setStatus(
      "THINKING"
    );


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

            cache:
              "no-store",

            body:
              JSON.stringify({
                message: text
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "Ошибка сервера"
        );
      }


      if (!data.ok) {

        throw new Error(
          data.error ||
          "Неизвестная ошибка"
        );
      }


      addMessage(
        data.answer,
        "assistant"
      );


      addSources(
        data.sources
      );


      setStatus(
        "READY"
      );


    } catch (error) {

      console.error(
        error
      );

      addMessage(
        "Ошибка: " +
        error.message,
        "assistant"
      );

      setStatus(
        "ERROR"
      );

    } finally {

      send.disabled =
        false;

      input.focus();
    }

  }
);

</script>

</body>

</html>`;
}


/* =========================================================
   FETCH
========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );


    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {

      return html(
        getHTML()
      );
    }


    if (
      request.method === "GET" &&
      url.pathname === "/ping"
    ) {

      return json({
        ok: true,
        message:
          "J.A.R.V.I.S. online",
        time:
          new Date().toISOString()
      });
    }


    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {

      return handleHealth(
        env
      );
    }


    if (
      request.method === "POST" &&
      url.pathname === "/chat"
    ) {

      return handleChat(
        request,
        env
      );
    }


    return json(
      {
        ok: false,
        error: "Not found"
      },
      404
    );
  }

};
