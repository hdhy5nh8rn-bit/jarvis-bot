const VERSION = "v5.4";
const TIME_ZONE = "Europe/Moscow";
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твоя задача — помогать пользователю:
- думать;
- планировать;
- учиться;
- работать;
- организовывать задачи;
- анализировать информацию;
- создавать тексты;
- вести обычный дружеский разговор.

Общайся на русском языке.
Стиль: спокойный, уверенный, умный, естественный.
Отвечай как современный персональный AI-ассистент.
Не говори "как искусственный интеллект", если это не требуется.
Не упоминай внутреннюю архитектуру, Cloudflare, API, D1 и программный код без необходимости.
Если пользователь просто здоровается — отвечай естественно и кратко.
`;


/* ============================================================
   WORKER
============================================================ */

export default {

  async fetch(request, env) {

    try {

      const url = new URL(request.url);


      /* ======================================================
         ГЛАВНАЯ
      ====================================================== */

      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {

        return new Response(
          HTML_PAGE,
          {
            headers: {
              "content-type":
                "text/html; charset=UTF-8"
            }
          }
        );

      }


      /* ======================================================
         PING
      ====================================================== */

      if (
        url.pathname === "/ping"
      ) {

        return json({
          ok: true,
          version: VERSION,
          timezone: TIME_ZONE,
          model: AI_MODEL,
          message: "J.A.R.V.I.S. online"
        });

      }


      /* ======================================================
         HEALTH
      ====================================================== */

      if (
        url.pathname === "/health"
      ) {

        return json({
          ok: true,
          version: VERSION,
          database: !!env.DB,
          ai: !!env.AI,
          timezone: TIME_ZONE
        });

      }


      /* ======================================================
         СПИСОК ЗАДАЧ
      ====================================================== */

      if (
        url.pathname === "/tasks" &&
        request.method === "GET"
      ) {

        const userId =
          url.searchParams.get("user_id") ||
          "default";


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


        return json({
          ok: true,
          tasks:
            result.results || []
        });

      }


      /* ======================================================
         CHAT
      ====================================================== */

      if (
        url.pathname === "/chat" &&
        request.method === "POST"
      ) {

        const body =
          await request.json();


        const userId =
          body.user_id ||
          "default";


        const message =
          String(
            body.message || ""
          ).trim();


        if (!message) {

          return json({
            ok: false,
            error:
              "Пустое сообщение."
          }, 400);

        }


        /* ====================================================
           СОХРАНЯЕМ СООБЩЕНИЕ
        ==================================================== */

        await env.DB.prepare(`
          INSERT INTO memory (
            user_id,
            role,
            content
          )
          VALUES (?, ?, ?)
        `)
        .bind(
          userId,
          "user",
          message
        )
        .run();


        const lower =
          message.toLowerCase();


        /* ====================================================
           УДАЛЕНИЕ ЗАДАЧИ
        ==================================================== */

        if (
          lower.startsWith("удали задачу") ||
          lower.startsWith("удали напоминание") ||
          lower.startsWith("удали событие")
        ) {

          const title =
            message
              .replace(
                /^удали\s+(задачу|напоминание|событие)\s*/i,
                ""
              )
              .trim();


          if (title) {

            const result =
              await env.DB.prepare(`
                DELETE FROM tasks
                WHERE user_id = ?
                AND title LIKE ?
                AND status = 'active'
              `)
              .bind(
                userId,
                `%${title}%`
              )
              .run();


            const deleted =
              result.meta?.changes || 0;


            const reply =
              deleted
                ? `Задачу «${title}» удалил.`
                : `Активную задачу «${title}» не нашёл.`;


            await saveAssistantMessage(
              env,
              userId,
              reply
            );


            return json({
              ok: true,
              reply,
              action: "delete_task"
            });

          }

        }


        /* ====================================================
           ЗАВЕРШЕНИЕ ЗАДАЧИ
        ==================================================== */

        if (
          lower.startsWith("выполни ") ||
          lower.startsWith("заверши ") ||
          lower.startsWith("отметь выполненной ")
        ) {

          const title =
            message
              .replace(
                /^(выполни|заверши|отметь выполненной)\s+/i,
                ""
              )
              .trim();


          if (title) {

            const result =
              await env.DB.prepare(`
                UPDATE tasks
                SET status = 'completed'
                WHERE user_id = ?
                AND title LIKE ?
                AND status = 'active'
              `)
              .bind(
                userId,
                `%${title}%`
              )
              .run();


            const changed =
              result.meta?.changes || 0;


            const reply =
              changed
                ? `Готово. Задачу «${title}» отметил выполненной.`
                : `Активную задачу «${title}» не нашёл.`;


            await saveAssistantMessage(
              env,
              userId,
              reply
            );


            return json({
              ok: true,
              reply,
              action: "complete_task"
            });

          }

        }


        /* ====================================================
           СПИСОК ЗАДАЧ
        ==================================================== */

        if (
          lower === "задачи" ||
          lower === "мои задачи" ||
          lower === "список задач" ||
          lower.includes("какие у меня задачи")
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
                repeat_rule
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


          const tasks =
            result.results || [];


          let reply;


          if (!tasks.length) {

            reply =
              "Активных задач сейчас нет.";

          } else {

            reply =
              "Вот твои активные задачи:\n\n" +
              tasks
                .map(
                  (task, index) => {

                    let line =
                      `${index + 1}. ${task.title}`;


                    if (task.task_date) {
                      line +=
                        ` — ${task.task_date}`;
                    }


                    if (task.task_time) {
                      line +=
                        ` в ${task.task_time}`;
                    }


                    if (task.repeat_rule) {
                      line +=
                        ` · ${formatRepeatRule(task.repeat_rule)}`;
                    }


                    return line;

                  }
                )
                .join("\n");

          }


          await saveAssistantMessage(
            env,
            userId,
            reply
          );


          return json({
            ok: true,
            reply,
            action: "list_tasks",
            tasks
          });

        }


        /* ====================================================
           СОЗДАНИЕ ЗАДАЧИ
        ==================================================== */

        const parsedTask =
          parseTaskMessage(message);


        if (parsedTask) {

          const existing =
            await env.DB.prepare(`
              SELECT id
              FROM tasks
              WHERE user_id = ?
              AND title = ?
              AND status = 'active'
              AND (
                task_date = ?
                OR (
                  task_date IS NULL
                  AND ? IS NULL
                )
              )
              LIMIT 1
            `)
            .bind(
              userId,
              parsedTask.title,
              parsedTask.task_date,
              parsedTask.task_date
            )
            .first();


          if (!existing) {

            const insert =
              await env.DB.prepare(`
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
                parsedTask.title,
                parsedTask.task_date,
                parsedTask.task_time,
                parsedTask.task_type,
                parsedTask.repeat_rule
              )
              .run();


            const id =
              insert.meta?.last_row_id ||
              null;


            let reply =
              `Готово. Добавил ${getTaskTypeWord(parsedTask.task_type)} «${parsedTask.title}»`;


            if (parsedTask.task_date) {

              reply +=
                ` на ${formatRussianDate(parsedTask.task_date)}`;

            }


            if (parsedTask.task_time) {

              reply +=
                ` в ${parsedTask.task_time}`;

            }


            if (parsedTask.repeat_rule) {

              reply +=
                ` · ${formatRepeatRule(parsedTask.repeat_rule)}`;

            }


            reply += ".";


            await saveAssistantMessage(
              env,
              userId,
              reply
            );


            return json({
              ok: true,
              reply,
              action: "create_task",
              task_id: id,
              task: parsedTask
            });

          }

        }


        /* ====================================================
           ПОЛУЧАЕМ ИСТОРИЮ
        ==================================================== */

        const historyResult =
          await env.DB.prepare(`
            SELECT
              role,
              content
            FROM memory
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 30
          `)
          .bind(userId)
          .all();


        const history =
          (historyResult.results || [])
            .reverse();


        /* ====================================================
           ПОЛУЧАЕМ ФАКТЫ
        ==================================================== */

        const factsResult =
          await env.DB.prepare(`
            SELECT
              category,
              fact
            FROM facts
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT 30
          `)
          .bind(userId)
          .all();


        const facts =
          factsResult.results || [];


        /* ====================================================
           СОЗДАЁМ MESSAGES
        ==================================================== */

        const messages = [
          {
            role: "system",
            content: SYSTEM_PROMPT
          }
        ];


        if (facts.length) {

          messages.push({
            role: "system",
            content:
              "Известные факты о пользователе:\n" +
              facts
                .map(
                  item =>
                    `- ${item.category}: ${item.fact}`
                )
                .join("\n")
          });

        }


        for (
          const item of history
        ) {

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


        /* ====================================================
           ПРОВЕРЯЕМ AI
        ==================================================== */

        if (!env.AI) {

          return json({
            ok: false,
            error:
              "Workers AI binding AI не найден."
          }, 500);

        }


        /* ====================================================
           ВЫЗОВ AI
        ==================================================== */

        let aiResult;


        try {

          aiResult =
            await env.AI.run(
              AI_MODEL,
              {
                messages
              }
            );

        } catch (error) {

          console.log(
            "JARVIS AI ERROR:",
            error?.stack ||
            error?.message ||
            String(error)
          );


          return json({
            ok: false,
            error:
              "Ошибка при обращении к Workers AI.",
            details:
              error?.message ||
              String(error)
          }, 500);

        }


        /* ====================================================
           ПОЛУЧАЕМ ТЕКСТ
        ==================================================== */

        let reply =
          extractAIText(aiResult);


        /* ====================================================
           ЕСЛИ НЕ НАШЛИ
        ==================================================== */

        if (!reply) {

          console.log(
            "JARVIS AI RAW RESPONSE:",
            JSON.stringify(aiResult)
          );


          return json({
            ok: false,
            error:
              "Workers AI вернул данные, но текст ответа не найден.",
            ai_response:
              aiResult
          }, 500);

        }


        reply =
          String(reply).trim();


        /* ====================================================
           СОХРАНЯЕМ AI ОТВЕТ
        ==================================================== */

        await saveAssistantMessage(
          env,
          userId,
          reply
        );


        return json({
          ok: true,
          reply,
          action: "chat"
        });

      }


      /* ======================================================
         404
      ====================================================== */

      return json({
        ok: false,
        error: "Not found",
        version: VERSION
      }, 404);


    } catch (error) {

      console.log(
        "JARVIS WORKER ERROR:",
        error?.stack ||
        error?.message ||
        String(error)
      );


      return json({
        ok: false,
        error:
          error?.message ||
          "Внутренняя ошибка сервера.",
        version: VERSION
      }, 500);

    }

  }

};


/* ============================================================
   ИЗВЛЕЧЕНИЕ ТЕКСТА ИЗ AI
============================================================ */

function extractAIText(value, depth = 0) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  if (depth > 10) {
    return null;
  }


  /* ----------------------------------------------------------
     Строка
  ---------------------------------------------------------- */

  if (
    typeof value === "string"
  ) {

    const text =
      value.trim();

    return text || null;

  }


  /* ----------------------------------------------------------
     Массив
  ---------------------------------------------------------- */

  if (
    Array.isArray(value)
  ) {

    for (
      const item of value
    ) {

      const result =
        extractAIText(
          item,
          depth + 1
        );


      if (result) {
        return result;
      }

    }


    return null;

  }


  /* ----------------------------------------------------------
     Объект
  ---------------------------------------------------------- */

  if (
    typeof value === "object"
  ) {

    /*
      Проверяем наиболее вероятные поля
      в правильном порядке.
    */

    const priorityKeys = [

      "response",

      "text",

      "output_text",

      "generated_text",

      "content",

      "message",

      "output",

      "result",

      "choices"

    ];


    for (
      const key of priorityKeys
    ) {

      if (
        Object.prototype.hasOwnProperty.call(
          value,
          key
        )
      ) {

        const result =
          extractAIText(
            value[key],
            depth + 1
          );


        if (result) {
          return result;
        }

      }

    }


    /*
      Если структура неизвестная —
      рекурсивно ищем строку.
    */

    for (
      const key of Object.keys(value)
    ) {

      const result =
        extractAIText(
          value[key],
          depth + 1
        );


      if (result) {
        return result;
      }

    }

  }


  return null;

}


/* ============================================================
   СОХРАНЕНИЕ ОТВЕТА
============================================================ */

async function saveAssistantMessage(
  env,
  userId,
  reply
) {

  await env.DB.prepare(`
    INSERT INTO memory (
      user_id,
      role,
      content
    )
    VALUES (?, ?, ?)
  `)
  .bind(
    userId,
    "assistant",
    reply
  )
  .run();

}


/* ============================================================
   JSON
============================================================ */

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
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );

}


/* ============================================================
   ПАРСЕР ЗАДАЧ
============================================================ */

function parseTaskMessage(message) {

  const text =
    message
      .replace(/\s+/g, " ")
      .trim();


  const lower =
    text.toLowerCase();


  /* ----------------------------------------------------------
     ТИП
  ---------------------------------------------------------- */

  let task_type =
    "task";


  if (
    lower.includes("напоминание") ||
    lower.startsWith("напомни")
  ) {

    task_type =
      "reminder";

  }


  if (
    lower.includes("событие") ||
    lower.includes("мероприятие")
  ) {

    task_type =
      "event";

  }


  /* ----------------------------------------------------------
     ВРЕМЯ
  ---------------------------------------------------------- */

  let task_time =
    null;


  let timeMatch =
    lower.match(
      /(?:в|на)\s+(\d{1,2})(?::(\d{2}))?\s*(час(?:а|ов)?|ч)?\s*(утра|дня|вечера|ночи)?/i
    );


  if (timeMatch) {

    let hour =
      Number(timeMatch[1]);


    const minute =
      timeMatch[2]
        ? Number(timeMatch[2])
        : 0;


    const period =
      (
        timeMatch[4] || ""
      ).toLowerCase();


    if (
      period === "вечера" &&
      hour < 12
    ) {

      hour += 12;

    }


    if (
      period === "дня" &&
      hour < 12
    ) {

      hour += 12;

    }


    if (
      period === "ночи" &&
      hour === 12
    ) {

      hour = 0;

    }


    if (
      period === "утра" &&
      hour === 12
    ) {

      hour = 0;

    }


    if (
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {

      task_time =
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    }

  }


  /* ----------------------------------------------------------
     HH:MM
  ---------------------------------------------------------- */

  if (!task_time) {

    const directTime =
      lower.match(
        /\b(\d{1,2}):(\d{2})\b/
      );


    if (directTime) {

      const hour =
        Number(directTime[1]);


      const minute =
        Number(directTime[2]);


      if (
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59
      ) {

        task_time =
          `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

      }

    }

  }


  /* ----------------------------------------------------------
     ПРОСТО "В 10"
  ---------------------------------------------------------- */

  if (!task_time) {

    const simpleTime =
      lower.match(
        /\bв\s+(\d{1,2})\b/
      );


    if (simpleTime) {

      const hour =
        Number(simpleTime[1]);


      if (
        hour >= 0 &&
        hour <= 23
      ) {

        task_time =
          `${String(hour).padStart(2, "0")}:00`;

      }

    }

  }


  /* ----------------------------------------------------------
     ПОЛДЕНЬ
  ---------------------------------------------------------- */

  if (
    !task_time &&
    lower.includes("полдень")
  ) {

    task_time =
      "12:00";

  }


  /* ----------------------------------------------------------
     ПОЛНОЧЬ
  ---------------------------------------------------------- */

  if (
    !task_time &&
    lower.includes("полночь")
  ) {

    task_time =
      "00:00";

  }


  /* ----------------------------------------------------------
     ДАТА
  ---------------------------------------------------------- */

  let task_date =
    null;


  if (
    lower.includes("послезавтра")
  ) {

    task_date =
      addDays(
        getLocalDate(),
        2
      );

  }

  else if (
    lower.includes("завтра")
  ) {

    task_date =
      addDays(
        getLocalDate(),
        1
      );

  }

  else if (
    lower.includes("сегодня")
  ) {

    task_date =
      getLocalDate();

  }


  /* ----------------------------------------------------------
     ДНИ НЕДЕЛИ
  ---------------------------------------------------------- */

  const weekdays = {

    "понедельник": 1,
    "понедельнику": 1,

    "вторник": 2,
    "вторнику": 2,

    "среда": 3,
    "среду": 3,

    "четверг": 4,
    "четвергу": 4,

    "пятница": 5,
    "пятницу": 5,

    "суббота": 6,
    "субботу": 6,

    "воскресенье": 0

  };


  let weekdayFound =
    null;


  for (
    const [
      name,
      dayNumber
    ]
    of Object.entries(weekdays)
  ) {

    if (
      lower.includes(name)
    ) {

      weekdayFound =
        dayNumber;

      break;

    }

  }


  if (
    weekdayFound !== null &&
    !task_date
  ) {

    task_date =
      nextWeekday(
        getLocalDate(),
        weekdayFound
      );

  }


  /* ----------------------------------------------------------
     ПОВТОР
  ---------------------------------------------------------- */

  let repeat_rule =
    null;


  if (
    lower.includes("каждый день") ||
    lower.includes("ежедневно")
  ) {

    repeat_rule =
      "daily";

  }

  else if (
    lower.includes("по будням") ||
    lower.includes("каждый будний день")
  ) {

    repeat_rule =
      "weekdays";

  }

  else if (
    lower.includes("каждую неделю") ||
    lower.includes("еженедельно")
  ) {

    repeat_rule =
      "weekly";

  }

  else if (
    lower.includes("каждый месяц") ||
    lower.includes("ежемесячно")
  ) {

    repeat_rule =
      "monthly";

  }

  else if (
    weekdayFound !== null &&
    lower.includes("каждый")
  ) {

    repeat_rule =
      `weekly:${weekdayFound}`;

  }


  /* ----------------------------------------------------------
     ИНДИКАТОРЫ ЗАДАЧ
  ---------------------------------------------------------- */

  const taskIndicators = [

    "сделать",
    "подготовить",
    "купить",
    "позвонить",
    "написать",
    "отправить",
    "проверить",
    "сдать",
    "выучить",
    "начать",
    "закончить",
    "посмотреть",
    "встретиться",
    "заняться",
    "подготовка",
    "напомни",
    "напомнить",
    "напоминание",
    "запланируй",
    "поставь задачу",
    "добавь задачу"

  ];


  const hasIndicator =
    taskIndicators.some(
      indicator =>
        lower.includes(indicator)
    );


  const hasDate =
    lower.includes("сегодня") ||
    lower.includes("завтра") ||
    lower.includes("послезавтра") ||
    weekdayFound !== null;


  const hasTime =
    !!task_time;


  if (
    !hasIndicator &&
    !hasDate &&
    !hasTime
  ) {

    return null;

  }


  /* ----------------------------------------------------------
     НАЗВАНИЕ
  ---------------------------------------------------------- */

  let title =
    text
      .replace(
        /^(запиши|добавь|создай|поставь|запланируй)\s+/i,
        ""
      );


  title =
    title
      .replace(
        /^задачу\s*/i,
        ""
      )
      .replace(
        /^напоминание\s*/i,
        ""
      )
      .replace(
        /^событие\s*/i,
        ""
      );


  title =
    title
      .replace(
        /\b(сегодня|завтра|послезавтра)\b/gi,
        ""
      );


  title =
    title
      .replace(
        /\b(в|на)\s+\d{1,2}(?::\d{2})?\s*(час(?:а|ов)?|ч)?\s*(утра|дня|вечера|ночи)?/gi,
        ""
      );


  title =
    title
      .replace(
        /\b\d{1,2}:\d{2}\b/g,
        ""
      );


  title =
    title
      .replace(
        /\b(каждый день|ежедневно|по будням|каждую неделю|еженедельно|каждый месяц|ежемесячно)\b/gi,
        ""
      );


  title =
    title
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  if (!title) {

    return null;

  }


  return {

    title,

    task_date,

    task_time,

    task_type,

    repeat_rule

  };

}


/* ============================================================
   ДАТА
============================================================ */

function getLocalDate() {

  const now =
    new Date();


  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    )
    .formatToParts(now);


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


  return (
    `${values.year}-${values.month}-${values.day}`
  );

}


/* ============================================================
   ДОБАВИТЬ ДНИ
============================================================ */

function addDays(
  dateString,
  days
) {

  const date =
    new Date(
      `${dateString}T12:00:00`
    );


  date.setDate(
    date.getDate() + days
  );


  return [

    date.getFullYear(),

    String(
      date.getMonth() + 1
    ).padStart(2, "0"),

    String(
      date.getDate()
    ).padStart(2, "0")

  ].join("-");

}


/* ============================================================
   СЛЕДУЮЩИЙ ДЕНЬ НЕДЕЛИ
============================================================ */

function nextWeekday(
  dateString,
  targetDay
) {

  const date =
    new Date(
      `${dateString}T12:00:00`
    );


  const current =
    date.getDay();


  let diff =
    targetDay - current;


  if (diff <= 0) {
    diff += 7;
  }


  date.setDate(
    date.getDate() + diff
  );


  return [

    date.getFullYear(),

    String(
      date.getMonth() + 1
    ).padStart(2, "0"),

    String(
      date.getDate()
    ).padStart(2, "0")

  ].join("-");

}


/* ============================================================
   ФОРМАТ ДАТЫ
============================================================ */

function formatRussianDate(
  dateString
) {

  const date =
    new Date(
      `${dateString}T12:00:00`
    );


  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      day: "numeric",
      month: "long"
    }
  ).format(date);

}


/* ============================================================
   ТИП ЗАДАЧИ
============================================================ */

function getTaskTypeWord(
  type
) {

  if (
    type === "reminder"
  ) {

    return "напоминание";

  }


  if (
    type === "event"
  ) {

    return "событие";

  }


  return "задачу";

}


/* ============================================================
   ПОВТОР
============================================================ */

function formatRepeatRule(
  rule
) {

  if (
    rule === "daily"
  ) {

    return "каждый день";

  }


  if (
    rule === "weekdays"
  ) {

    return "по будням";

  }


  if (
    rule === "weekly"
  ) {

    return "каждую неделю";

  }


  if (
    rule === "monthly"
  ) {

    return "каждый месяц";

  }


  if (
    rule?.startsWith("weekly:")
  ) {

    const day =
      Number(
        rule.split(":")[1]
      );


    const names = [

      "воскресенье",

      "понедельник",

      "вторник",

      "среду",

      "четверг",

      "пятницу",

      "субботу"

    ];


    return (
      `каждую неделю, ${names[day] || ""}`
    );

  }


  return rule;

}


/* ============================================================
   HTML
============================================================ */

const HTML_PAGE = `

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

  -webkit-tap-highlight-color: transparent;

}


html,
body {

  margin: 0;

  padding: 0;

  width: 100%;

  height: 100%;

  background: #05070a;

  color: #f2f4f7;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "Segoe UI",
    sans-serif;

}


body {

  overflow: hidden;

}


.app {

  width: 100%;

  height: 100%;

  display: flex;

  flex-direction: column;

  background:
    radial-gradient(
      circle at top,
      rgba(100,120,140,.15),
      transparent 45%
    ),
    #05070a;

}


/* HEADER */

.header {

  height: 68px;

  flex-shrink: 0;

  display: flex;

  align-items: center;

  justify-content: space-between;

  padding:
    env(safe-area-inset-top)
    18px
    0
    18px;

  border-bottom:
    1px solid rgba(255,255,255,.07);

  background:
    rgba(5,7,10,.92);

  backdrop-filter:
    blur(20px);

}


.brand {

  display: flex;

  flex-direction: column;

}


.brand-title {

  font-size: 19px;

  font-weight: 600;

  letter-spacing: 2px;

}


.brand-subtitle {

  margin-top: 3px;

  font-size: 10px;

  color: #7e8995;

  letter-spacing: 1px;

}


.status {

  display: flex;

  align-items: center;

  gap: 7px;

  font-size: 11px;

  color: #89939d;

}


.status-dot {

  width: 7px;

  height: 7px;

  border-radius: 50%;

  background: #6ee7b7;

  box-shadow:
    0 0 10px rgba(110,231,183,.7);

}


/* CHAT */

.chat {

  flex: 1;

  overflow-y: auto;

  -webkit-overflow-scrolling: touch;

  padding:
    24px
    16px
    120px;

  scroll-behavior: smooth;

}


.welcome {

  min-height: 100%;

  display: flex;

  flex-direction: column;

  align-items: center;

  justify-content: center;

  text-align: center;

  padding: 30px;

}


.arc {

  width: 74px;

  height: 74px;

  border-radius: 50%;

  border:
    1px solid rgba(255,255,255,.25);

  box-shadow:
    0 0 30px rgba(255,255,255,.08),
    inset 0 0 25px rgba(255,255,255,.04);

  display: flex;

  align-items: center;

  justify-content: center;

  margin-bottom: 24px;

}


.arc::before {

  content: "";

  width: 32px;

  height: 32px;

  border-radius: 50%;

  border:
    2px solid rgba(255,255,255,.7);

  box-shadow:
    0 0 18px rgba(255,255,255,.25);

}


.welcome h1 {

  margin: 0;

  font-size: 27px;

  font-weight: 500;

  letter-spacing: 3px;

}


.welcome p {

  margin-top: 10px;

  color: #7d8791;

  font-size: 14px;

  line-height: 1.5;

}


/* MESSAGES */

.message-row {

  display: flex;

  margin-bottom: 18px;

}


.message-row.user {

  justify-content: flex-end;

}


.message-row.assistant {

  justify-content: flex-start;

}


.message {

  max-width: 82%;

  padding:
    12px
    15px;

  border-radius: 17px;

  font-size: 15px;

  line-height: 1.5;

  white-space: pre-wrap;

  word-wrap: break-word;

}


.message.user {

  background: #20252b;

  border-bottom-right-radius: 5px;

  color: #f4f5f6;

}


.message.assistant {

  background:
    rgba(255,255,255,.055);

  border:
    1px solid rgba(255,255,255,.06);

  border-bottom-left-radius: 5px;

  color: #e9edf0;

}


/* TYPING */

.typing {

  display: flex;

  gap: 5px;

  padding:
    14px
    17px;

  width: 64px;

  border-radius: 17px;

  background:
    rgba(255,255,255,.055);

}


.typing span {

  width: 5px;

  height: 5px;

  border-radius: 50%;

  background: #9ba4ad;

  animation:
    typing 1.2s infinite ease-in-out;

}


.typing span:nth-child(2) {

  animation-delay: .15s;

}


.typing span:nth-child(3) {

  animation-delay: .3s;

}


@keyframes typing {

  0%,
  60%,
  100% {

    transform: translateY(0);

    opacity: .4;

  }

  30% {

    transform: translateY(-4px);

    opacity: 1;

  }

}


/* INPUT */

.input-area {

  position: fixed;

  left: 0;

  right: 0;

  bottom: 0;

  padding:
    10px
    12px
    calc(10px + env(safe-area-inset-bottom));

  background:
    linear-gradient(
      to top,
      #05070a 70%,
      transparent
    );

}


.input-box {

  display: flex;

  align-items: flex-end;

  gap: 8px;

  max-width: 900px;

  margin: auto;

  padding:
    6px
    6px
    6px
    14px;

  border:
    1px solid rgba(255,255,255,.09);

  border-radius: 23px;

  background:
    rgba(24,28,33,.94);

  backdrop-filter:
    blur(20px);

}


textarea {

  flex: 1;

  min-height: 40px;

  max-height: 130px;

  resize: none;

  border: none;

  outline: none;

  background: transparent;

  color: #f3f4f5;

  font: inherit;

  font-size: 15px;

  line-height: 1.45;

  padding:
    9px
    0;

}


textarea::placeholder {

  color: #707a84;

}


.send {

  width: 40px;

  height: 40px;

  flex-shrink: 0;

  border: none;

  border-radius: 50%;

  background: #f0f1f2;

  color: #080a0d;

  font-size: 17px;

  display: flex;

  align-items: center;

  justify-content: center;

}


.send:active {

  transform: scale(.94);

}


.send:disabled {

  opacity: .4;

}


@media (min-width: 700px) {

  .chat {

    padding-left: 24px;

    padding-right: 24px;

  }


  .message {

    max-width: 680px;

  }


  .input-area {

    padding-left: 24px;

    padding-right: 24px;

  }

}

</style>

</head>


<body>


<div class="app">


<header class="header">


<div class="brand">

<div class="brand-title">
J.A.R.V.I.S.
</div>


<div class="brand-subtitle">
JUST A RATHER VERY INTELLIGENT SYSTEM
</div>

</div>


<div class="status">

<span class="status-dot"></span>

<span>ONLINE</span>

</div>


</header>


<main
  id="chat"
  class="chat"
>


<div
  id="welcome"
  class="welcome"
>


<div class="arc"></div>


<h1>
Добрый день.
</h1>


<p>
J.A.R.V.I.S. готов к работе.
</p>


</div>


</main>


<div class="input-area">


<div class="input-box">


<textarea
  id="input"
  placeholder="Сообщение J.A.R.V.I.S..."
  rows="1"
></textarea>


<button
  id="send"
  class="send"
  aria-label="Отправить"
>
↑
</button>


</div>


</div>


</div>


<script>

const chat =
  document.getElementById("chat");


const input =
  document.getElementById("input");


const send =
  document.getElementById("send");


const welcome =
  document.getElementById("welcome");


const USER_ID =
  localStorage.getItem(
    "jarvis_user_id"
  ) ||
  "default";


let messages =
  JSON.parse(
    localStorage.getItem(
      "jarvis_chat"
    ) ||
    "[]"
  );


function saveMessages() {

  localStorage.setItem(
    "jarvis_chat",
    JSON.stringify(
      messages.slice(-100)
    )
  );

}


function scrollBottom() {

  requestAnimationFrame(
    () => {

      chat.scrollTop =
        chat.scrollHeight;

    }
  );

}


function addMessage(
  role,
  text,
  save = true
) {

  if (welcome) {

    welcome.remove();

  }


  const row =
    document.createElement(
      "div"
    );


  row.className =
    "message-row " +
    role;


  const bubble =
    document.createElement(
      "div"
    );


  bubble.className =
    "message " +
    role;


  bubble.textContent =
    text;


  row.appendChild(
    bubble
  );


  chat.appendChild(
    row
  );


  if (save) {

    messages.push({
      role,
      text
    });


    saveMessages();

  }


  scrollBottom();

}


function showTyping() {

  const row =
    document.createElement(
      "div"
    );


  row.id =
    "typing-row";


  row.className =
    "message-row assistant";


  row.innerHTML = \`
    <div class="typing">
      <span></span>
      <span></span>
      <span></span>
    </div>
  \`;


  chat.appendChild(
    row
  );


  scrollBottom();

}


function hideTyping() {

  const element =
    document.getElementById(
      "typing-row"
    );


  if (element) {

    element.remove();

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


  send.disabled =
    true;


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
              user_id:
                USER_ID,

              message:
                text
            })
        }
      );


    const data =
      await response.json();


    hideTyping();


    console.log(
      "JARVIS RESPONSE:",
      data
    );


    if (
      data &&
      data.reply
    ) {

      addMessage(
        "assistant",
        data.reply
      );

    } else {

      let errorText =
        data?.error ||
        "Не удалось получить ответ.";


      if (
        data?.details
      ) {

        errorText +=
          "\n\nТехническая информация:\n" +
          data.details;

      }


      addMessage(
        "assistant",
        errorText
      );

    }


  } catch (error) {

    hideTyping();


    console.error(
      "JARVIS FETCH ERROR:",
      error
    );


    addMessage(
      "assistant",
      "Не удалось связаться с J.A.R.V.I.S."
    );

  }


  send.disabled =
    false;


  input.focus();

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


/* ==========================================================
   ИСТОРИЯ
========================================================== */

if (
  messages.length
) {

  if (welcome) {

    welcome.remove();

  }


  for (
    const message
    of messages
  ) {

    const row =
      document.createElement(
        "div"
      );


    row.className =
      "message-row " +
      message.role;


    const bubble =
      document.createElement(
        "div"
      );


    bubble.className =
      "message " +
      message.role;


    bubble.textContent =
      message.text;


    row.appendChild(
      bubble
    );


    chat.appendChild(
      row
    );

  }


  scrollBottom();

}


input.focus();

</script>


</body>

</html>

`;
