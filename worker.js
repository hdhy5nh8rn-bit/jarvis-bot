const VERSION = "DEBUG-v1.0";

const TIME_ZONE = "Europe/Moscow";

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // ==========================================
    // CORS
    // ==========================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // ==========================================
    // PING
    // ==========================================

    if (url.pathname === "/ping") {

      return json({
        ok: true,
        version: VERSION,
        timezone: TIME_ZONE,
        database: !!env.DB,
        message: "J.A.R.V.I.S. DEBUG ONLINE"
      }, corsHeaders);
    }

    // ==========================================
    // DEBUG TASK
    // ==========================================

    if (url.pathname === "/debug-task") {

      const text =
        url.searchParams.get("text") || "";

      const userId =
        url.searchParams.get("user_id") ||
        "web-user";

      return await debugTask(
        env,
        userId,
        text,
        corsHeaders
      );
    }

    // ==========================================
    // НЕИЗВЕСТНЫЙ ROUTE
    // ==========================================

    return json({
      ok: false,
      version: VERSION,
      error: "Unknown endpoint",
      available_endpoints: [
        "/ping",
        "/debug-task?text=Завтра%20спектакль%20в%2020"
      ]
    }, corsHeaders, 404);
  }
};


// =================================================
// DEBUG TASK
// =================================================

async function debugTask(
  env,
  userId,
  text,
  corsHeaders
) {

  const debug = {
    version: VERSION,
    timestamp: new Date().toISOString(),

    input: text,
    user_id: userId,

    parser: {},
    database: {},
    final: {}
  };

  // ==========================================
  // 1. Проверяем входные данные
  // ==========================================

  if (!text.trim()) {

    debug.final = {
      success: false,
      reason: "Пустой текст"
    };

    return json(
      debug,
      corsHeaders,
      400
    );
  }


  // ==========================================
  // 2. Нормализация
  // ==========================================

  const normalized =
    normalizeText(text);

  debug.parser.normalized =
    normalized;


  // ==========================================
  // 3. Дата
  // ==========================================

  const hasToday =
    normalized.includes("сегодня");

  const hasTomorrow =
    normalized.includes("завтра");

  const hasDayAfterTomorrow =
    normalized.includes("послезавтра");


  let taskDate = null;


  if (hasDayAfterTomorrow) {

    taskDate =
      addDaysToMoscowDate(2);

  } else if (hasTomorrow) {

    taskDate =
      addDaysToMoscowDate(1);

  } else if (hasToday) {

    taskDate =
      getMoscowDate();

  }


  debug.parser.date = {
    has_today: hasToday,
    has_tomorrow: hasTomorrow,
    has_day_after_tomorrow:
      hasDayAfterTomorrow,

    calculated_date: taskDate
  };


  // ==========================================
  // 4. Время
  // ==========================================

  let timeMatch =
    normalized.match(
      /\bв\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/
    );


  if (!timeMatch) {

    timeMatch =
      normalized.match(
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      );
  }


  let taskTime = null;


  if (timeMatch) {

    const hour =
      String(timeMatch[1])
        .padStart(2, "0");

    const minute =
      timeMatch[2] !== undefined
        ? String(timeMatch[2]).padStart(2, "0")
        : "00";

    taskTime =
      `${hour}:${minute}`;
  }


  debug.parser.time = {

    detected:
      !!timeMatch,

    match:
      timeMatch
        ? timeMatch[0]
        : null,

    calculated_time:
      taskTime
  };


  // ==========================================
  // 5. Если есть время, но нет даты
  // ==========================================

  if (taskTime && !taskDate) {

    taskDate =
      getMoscowDate();

    debug.parser.date.defaulted_to_today =
      true;

  } else {

    debug.parser.date.defaulted_to_today =
      false;
  }


  // ==========================================
  // 6. Намерение создать задачу
  // ==========================================

  const explicitIntent =
    hasExplicitTaskIntent(
      normalized
    );


  debug.parser.intent = {
    explicit_task_intent:
      explicitIntent,

    reason:
      explicitIntent
        ? "Дата/время или явная команда обнаружены"
        : "Признаков создания задачи не найдено"
  };


  // ==========================================
  // 7. Название задачи
  // ==========================================

  const title =
    cleanTaskTitle(
      normalized
    );


  debug.parser.title = {
    calculated_title:
      title
  };


  // ==========================================
  // 8. Итог распознавания
  // ==========================================

  const parsedTask = {

    title,

    task_date:
      taskDate,

    task_time:
      taskTime,

    task_type:
      "once",

    repeat_rule:
      null
  };


  debug.parser.parsed_task =
    parsedTask;


  // ==========================================
  // 9. Проверяем наличие DB
  // ==========================================

  if (!env.DB) {

    debug.database.connection =
      false;

    debug.final = {
      success: false,
      reason:
        "D1 binding DB отсутствует"
    };

    return json(
      debug,
      corsHeaders,
      500
    );
  }


  debug.database.connection =
    true;


  // ==========================================
  // 10. Проверяем таблицу tasks
  // ==========================================

  try {

    const tableTest =
      await env.DB.prepare(`
        SELECT *
        FROM tasks
        LIMIT 1
      `).all();


    debug.database.table_tasks = {
      accessible: true,

      existing_rows:
        tableTest.results?.length || 0
    };

  } catch (error) {

    debug.database.table_tasks = {
      accessible: false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };


    debug.final = {
      success: false,
      reason:
        "Не удалось обратиться к таблице tasks"
    };


    return json(
      debug,
      corsHeaders,
      500
    );
  }


  // ==========================================
  // 11. Проверяем структуру таблицы
  // ==========================================

  try {

    const schema =
      await env.DB.prepare(`
        PRAGMA table_info(tasks)
      `).all();


    debug.database.schema =
      schema.results || [];

  } catch (error) {

    debug.database.schema = {
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }


  // ==========================================
  // 12. Если parser не распознал задачу
  // ==========================================

  if (!explicitIntent || !title) {

    debug.final = {

      success: false,

      reason:
        "Парсер не сформировал задачу",

      parser_result:
        parsedTask
    };


    return json(
      debug,
      corsHeaders
    );
  }


  // ==========================================
  // 13. ПРОБНЫЙ INSERT
  // ==========================================

  let insertResult;


  try {

    insertResult =
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
        VALUES
        (?, ?, ?, ?, 'active', ?, ?)
      `)
      .bind(
        userId,
        title,
        taskDate,
        taskTime,
        "once",
        null
      )
      .run();


    debug.database.insert = {

      success: true,

      meta:
        insertResult.meta || null
    };

  } catch (error) {

    debug.database.insert = {

      success: false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };


    debug.final = {

      success: false,

      reason:
        "INSERT в D1 завершился ошибкой"
    };


    return json(
      debug,
      corsHeaders,
      500
    );
  }


  // ==========================================
  // 14. Получаем ID
  // ==========================================

  const insertedId =
    insertResult?.meta?.last_row_id;


  const changes =
    insertResult?.meta?.changes || 0;


  debug.database.inserted_id =
    insertedId;

  debug.database.changes =
    changes;


  // ==========================================
  // 15. Читаем созданную задачу обратно
  // ==========================================

  if (!insertedId) {

    debug.database.verification = {

      success: false,

      reason:
        "D1 не вернул last_row_id"
    };


    debug.final = {

      success: false,

      reason:
        "INSERT не вернул ID созданной записи"
    };


    return json(
      debug,
      corsHeaders,
      500
    );
  }


  try {

    const row =
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
        LIMIT 1
      `)
      .bind(insertedId)
      .first();


    debug.database.verification = {

      success:
        !!row,

      row:
        row || null
    };


    if (!row) {

      debug.final = {

        success: false,

        reason:
          "INSERT сообщил об успехе, но запись не найдена при SELECT"
      };


      return json(
        debug,
        corsHeaders,
        500
      );
    }


  } catch (error) {

    debug.database.verification = {

      success: false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };


    debug.final = {

      success: false,

      reason:
        "Ошибка SELECT после INSERT"
    };


    return json(
      debug,
      corsHeaders,
      500
    );
  }


  // ==========================================
  // 16. Финал
  // ==========================================

  debug.final = {

    success: true,

    message:
      "Парсер и запись в D1 работают.",

    created_task:
      debug.database.verification.row
  };


  return json(
    debug,
    corsHeaders
  );
}


// =================================================
// INTENT
// =================================================

function hasExplicitTaskIntent(
  normalized
) {

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
    explicitWords.some(
      word =>
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
    /\bв\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/
      .test(normalized)
    ||
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      .test(normalized);


  return hasDate || hasTime;
}


// =================================================
// TITLE
// =================================================

function cleanTaskTitle(
  normalized
) {

  let title =
    normalized;


  const patterns = [

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


  for (
    const pattern of patterns
  ) {

    title =
      title.replace(
        pattern,
        " "
      );
  }


  title =
    title
      .replace(/\s+/g, " ")
      .replace(
        /^[\s,.;:!?-]+/,
        ""
      )
      .replace(
        /[\s,.;:!?-]+$/,
        ""
      )
      .trim();


  if (!title) {
    return null;
  }


  return capitalize(title);
}


// =================================================
// DATE
// =================================================

function getMoscowDate() {

  const formatter =
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
    );


  return formatter.format(
    new Date()
  );
}


function addDaysToMoscowDate(
  days
) {

  const now =
    new Date();


  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
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
    );


  const parts =
    formatter.formatToParts(
      now
    );


  const year =
    Number(
      parts.find(
        p => p.type === "year"
      ).value
    );


  const month =
    Number(
      parts.find(
        p => p.type === "month"
      ).value
    );


  const day =
    Number(
      parts.find(
        p => p.type === "day"
      ).value
    );


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + days
      )
    );


  return date
    .toISOString()
    .slice(0, 10);
}


// =================================================
// TEXT
// =================================================

function normalizeText(text) {

  return String(text)
    .toLowerCase()
    .replace(
      /ё/g,
      "е"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// =================================================
// CAPITALIZE
// =================================================

function capitalize(text) {

  if (!text) {
    return text;
  }

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}


// =================================================
// JSON
// =================================================

function json(
  data,
  headers = {},
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

        ...headers
      }
    }
  );
}
