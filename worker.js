const MODEL = "@cf/zai-org/glm-4.7-flash";

const USER_ID = "egor";

const MAX_HISTORY = 10;
const MAX_FACTS = 30;
const MAX_SEARCH_RESULTS = 5;


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    try {

      // ========================================================
      // ГЛАВНАЯ СТРАНИЦА
      // ========================================================

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return new Response(
          getHTML(),
          {
            status: 200,

            headers: {
              "Content-Type":
                "text/html; charset=UTF-8",

              "Cache-Control":
                "no-store, no-cache, must-revalidate",

              "Pragma": "no-cache",

              "Expires": "0"
            }
          }
        );
      }


      // ========================================================
      // PING
      // ========================================================

      if (
        request.method === "GET" &&
        url.pathname === "/ping"
      ) {

        return json({

          ok: true,

          service:
            "J.A.R.V.I.S.",

          message:
            "Worker работает.",

          time:
            new Date().toISOString()

        });
      }


      // ========================================================
      // HEALTH
      // ========================================================

      if (
        request.method === "GET" &&
        url.pathname === "/health"
      ) {

        const checks = {

          worker: true,

          database: false,

          ai: false

        };


        let databaseError = null;

        let aiError = null;

        let aiAnswer = null;

        let aiRaw = null;


        // ------------------------------------------------------
        // DATABASE
        // ------------------------------------------------------

        try {

          await env.DB
            .prepare(
              "SELECT 1 AS ok"
            )
            .first();

          checks.database = true;

        } catch (error) {

          databaseError =
            error?.message ||
            String(error);

        }


        // ------------------------------------------------------
        // AI
        // ------------------------------------------------------

        try {

          const result =
            await env.AI.run(
              MODEL,
              {

                messages: [

                  {
                    role: "system",

                    content:
                      "Ты тестовый модуль J.A.R.V.I.S. Отвечай кратко."
                  },

                  {
                    role: "user",

                    content:
                      "Ответь одним словом: готов"
                  }

                ],

                max_tokens: 20,

                temperature: 0

              }
            );


          aiRaw = result;


          aiAnswer =
            extractAIText(result);


          if (aiAnswer) {

            checks.ai = true;

          } else {

            aiError =
              "Workers AI вернул ответ, но текст не найден.";

          }

        } catch (error) {

          aiError =
            error?.message ||
            String(error);

        }


        return json({

          ok:
            checks.worker &&
            checks.database &&
            checks.ai,

          checks,

          databaseError,

          aiError,

          aiAnswer,

          aiRaw,

          model: MODEL,

          time:
            new Date().toISOString()

        });
      }


      // ========================================================
      // CHAT
      // ========================================================

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {

        let body;

        try {

          body =
            await request.json();

        } catch {

          return json(
            {
              ok: false,

              error:
                "Некорректный JSON."
            },
            400
          );
        }


        const message =
          String(
            body?.message || ""
          ).trim();


        if (!message) {

          return json(
            {
              ok: false,

              error:
                "Сообщение пустое."
            },
            400
          );
        }


        try {

          // ==================================================
          // ПАМЯТЬ — СОХРАНИТЬ
          // ==================================================

          if (
            isRememberCommand(message)
          ) {

            const fact =
              extractRememberFact(
                message
              );


            if (!fact) {

              return json({

                ok: true,

                answer:
                  "Скажи, что именно мне нужно запомнить."

              });
            }


            const normalized =
              normalizeFact(fact);


            await saveFact(
              env,
              USER_ID,
              "preference",
              normalized
            );


            return json({

              ok: true,

              answer:
                "Запомнил. Буду иметь в виду."

            });
          }


          // ==================================================
          // ПАМЯТЬ — ПОКАЗАТЬ
          // ==================================================

          if (
            isRecallCommand(message)
          ) {

            const facts =
              await getFacts(
                env,
                USER_ID
              );


            if (!facts.length) {

              return json({

                ok: true,

                answer:
                  "Пока у меня нет сохранённых фактов о тебе."

              });
            }


            const list =
              facts
                .map(
                  (item, index) =>
                    `${index + 1}. ${item.fact}`
                )
                .join("\n");


            return json({

              ok: true,

              answer:
                "Вот что я помню:\n" +
                list

            });
          }


          // ==================================================
          // ПАМЯТЬ — ЗАБЫТЬ
          // ==================================================

          if (
            isForgetCommand(message)
          ) {

            const fact =
              extractForgetFact(
                message
              );


            if (!fact) {

              return json({

                ok: true,

                answer:
                  "Уточни, что именно мне забыть."

              });
            }


            const deleted =
              await deleteFact(
                env,
                USER_ID,
                fact
              );


            return json({

              ok: true,

              answer:
                deleted
                  ? "Хорошо. Я это забыл."
                  : "Я не нашёл такого факта в памяти."

            });
          }


          // ==================================================
          // ОЧИСТИТЬ ПРЕДПОЧТЕНИЯ
          // ==================================================

          if (
            isClearPreferencesCommand(
              message
            )
          ) {

            await env.DB
              .prepare(
                `
                DELETE FROM facts
                WHERE user_id = ?
                AND category = 'preference'
                `
              )
              .bind(USER_ID)
              .run();


            return json({

              ok: true,

              answer:
                "Хорошо. Сохранённые предпочтения очищены."

            });
          }


          // ==================================================
          // ОЧИСТИТЬ ВСЮ ПАМЯТЬ
          // ==================================================

          if (
            isClearMemoryCommand(
              message
            )
          ) {

            await env.DB
              .prepare(
                `
                DELETE FROM facts
                WHERE user_id = ?
                `
              )
              .bind(USER_ID)
              .run();


            await env.DB
              .prepare(
                `
                DELETE FROM memory
                WHERE user_id = ?
                `
              )
              .bind(USER_ID)
              .run();


            return json({

              ok: true,

              answer:
                "Память полностью очищена."

            });
          }


          // ==================================================
          // КОНТЕКСТ
          // ==================================================

          const facts =
            await getFacts(
              env,
              USER_ID
            );


          const history =
            await getHistory(
              env,
              USER_ID,
              MAX_HISTORY
            );


          // ==================================================
          // ИНТЕРНЕТ
          // ==================================================

          let webResults = [];


          if (
            shouldSearch(message)
          ) {

            try {

              webResults =
                await searchDuckDuckGo(
                  message,
                  MAX_SEARCH_RESULTS
                );

            } catch (error) {

              console.log(
                "SEARCH ERROR:",
                error?.message ||
                String(error)
              );

              webResults = [];
            }
          }


          // ==================================================
          // SYSTEM PROMPT
          // ==================================================

          const systemPrompt =
            buildSystemPrompt(
              facts,
              history,
              webResults
            );


          // ==================================================
          // MESSAGES
          // ==================================================

          const messages = [

            {
              role: "system",

              content:
                systemPrompt
            }

          ];


          for (
            const item of history
          ) {

            if (
              item.role === "user" ||
              item.role === "assistant"
            ) {

              messages.push({

                role:
                  item.role,

                content:
                  item.content

              });
            }
          }


          messages.push({

            role: "user",

            content: message

          });


          // ==================================================
          // СОХРАНЯЕМ СООБЩЕНИЕ
          // ==================================================

          await saveMemory(
            env,
            USER_ID,
            "user",
            message
          );


          // ==================================================
          // AI
          // ==================================================

          const answer =
            await askAI(
              env,
              messages
            );


          // ==================================================
          // СОХРАНЯЕМ ОТВЕТ
          // ==================================================

          await saveMemory(
            env,
            USER_ID,
            "assistant",
            answer
          );


          // ==================================================
          // ОТВЕТ
          // ==================================================

          return json({

            ok: true,

            answer,

            sources:
              webResults.map(
                item => ({

                  title:
                    item.title,

                  url:
                    item.url

                })
              )

          });


        } catch (error) {

          console.log(
            "CHAT ERROR:",
            error?.stack ||
            error?.message ||
            String(error)
          );


          return json(
            {

              ok: false,

              error:
                error?.message ||
                "Внутренняя ошибка J.A.R.V.I.S."

            },
            500
          );
        }
      }


      // ========================================================
      // 404
      // ========================================================

      return json(
        {

          ok: false,

          error:
            "Маршрут не найден."

        },
        404
      );


    } catch (error) {

      console.log(
        "WORKER ERROR:",
        error?.stack ||
        error?.message ||
        String(error)
      );


      return json(
        {

          ok: false,

          error:
            error?.message ||
            "Критическая ошибка Worker."

        },
        500
      );
    }
  }
};


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {

      status,

      headers: {

        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"

      }

    }
  );
}


// ============================================================
// AI
// ============================================================

async function askAI(
  env,
  messages
) {

  const result =
    await env.AI.run(
      MODEL,
      {

        messages,

        max_tokens: 700,

        temperature: 0.65

      }
    );


  const answer =
    extractAIText(
      result
    );


  if (!answer) {

    console.log(
      "AI RAW RESULT:",
      JSON.stringify(result)
    );


    throw new Error(
      "Workers AI не вернул текстовый ответ."
    );
  }


  return cleanAIAnswer(
    answer
  );
}


// ============================================================
// EXTRACT AI TEXT
// ============================================================

function extractAIText(
  result
) {

  if (
    result === null ||
    result === undefined
  ) {

    return "";
  }


  // ----------------------------------------------------------
  // Строка
  // ----------------------------------------------------------

  if (
    typeof result === "string"
  ) {

    return result.trim();
  }


  // ----------------------------------------------------------
  // response
  // ----------------------------------------------------------

  if (
    typeof result.response === "string" &&
    result.response.trim()
  ) {

    return result.response.trim();
  }


  // ----------------------------------------------------------
  // choices
  // ----------------------------------------------------------

  if (
    Array.isArray(
      result.choices
    ) &&
    result.choices.length > 0
  ) {

    const choice =
      result.choices[0];


    if (
      choice?.message &&
      typeof
        choice.message.content ===
        "string"
    ) {

      return
        choice.message.content.trim();
    }


    if (
      typeof choice?.text ===
      "string"
    ) {

      return
        choice.text.trim();
    }
  }


  // ----------------------------------------------------------
  // text
  // ----------------------------------------------------------

  if (
    typeof result.text ===
    "string" &&
    result.text.trim()
  ) {

    return result.text.trim();
  }


  // ----------------------------------------------------------
  // content
  // ----------------------------------------------------------

  if (
    typeof result.content ===
    "string" &&
    result.content.trim()
  ) {

    return result.content.trim();
  }


  // ----------------------------------------------------------
  // output_text
  // ----------------------------------------------------------

  if (
    typeof result.output_text ===
    "string" &&
    result.output_text.trim()
  ) {

    return result.output_text.trim();
  }


  // ----------------------------------------------------------
  // message.content
  // ----------------------------------------------------------

  if (
    result.message &&
    typeof result.message.content ===
      "string"
  ) {

    return
      result.message.content.trim();
  }


  // ----------------------------------------------------------
  // content в массиве
  // ----------------------------------------------------------

  if (
    Array.isArray(result.content)
  ) {

    const parts =
      result.content
        .map(
          item => {

            if (
              typeof item ===
              "string"
            ) {
              return item;
            }

            if (
              typeof item?.text ===
              "string"
            ) {
              return item.text;
            }

            return "";
          }
        )
        .filter(Boolean);


    if (parts.length) {

      return parts.join("\n").trim();
    }
  }


  // ----------------------------------------------------------
  // output
  // ----------------------------------------------------------

  if (
    Array.isArray(result.output)
  ) {

    const parts =
      result.output
        .map(
          item => {

            if (
              typeof item ===
              "string"
            ) {
              return item;
            }

            if (
              typeof item?.text ===
              "string"
            ) {
              return item.text;
            }

            if (
              typeof item?.content ===
              "string"
            ) {
              return item.content;
            }

            return "";
          }
        )
        .filter(Boolean);


    if (parts.length) {

      return parts.join("\n").trim();
    }
  }


  // ----------------------------------------------------------
  // Диагностика
  // ----------------------------------------------------------

  console.log(
    "UNRECOGNIZED AI RESULT:",
    JSON.stringify(result)
  );


  return "";
}


// ============================================================
// CLEAN AI
// ============================================================

function cleanAIAnswer(
  text
) {

  return String(text)

    .replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    )

    .replace(
      /__(.*?)__/g,
      "$1"
    )

    .replace(
      /\r/g,
      ""
    )

    .trim();
}


// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(
  facts,
  history,
  webResults
) {

  const factsText =
    facts.length

      ? facts
          .map(
            item =>
              `- ${item.fact}`
          )
          .join("\n")

      : "Нет сохранённых фактов.";


  const historyText =
    history.length

      ? history
          .map(
            item =>
              `${item.role}: ${item.content}`
          )
          .join("\n")

      : "Истории пока нет.";


  const webText =
    webResults.length

      ? webResults
          .map(
            (item, index) =>
              `${index + 1}. ${item.title}
${item.url}
${item.snippet}`
          )
          .join("\n\n")

      : "Интернет-поиск не выполнялся.";


  return `

Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент.

Ты разговариваешь с человеком естественно, грамотно и спокойно.

ТВОЙ СТИЛЬ:

- русский язык;
- естественный разговор;
- грамотные формулировки;
- уверенный тон;
- без роботизированных фраз;
- без постоянного "Конечно";
- без постоянного "Разумеется";
- без обращения "пользователь";
- обращайся на "ты";
- не задавай вопрос в конце каждого ответа;
- не повторяй одну и ту же формулировку;
- простые вопросы — короткий ответ;
- сложные вопросы — подробный ответ;
- если человек просит решить задачу — решай;
- если информации недостаточно — скажи об этом;
- не выдумывай факты;
- используй контекст предыдущего разговора;
- используй сохранённую память;
- если ниже есть результаты интернет-поиска, используй их для актуальной информации.

ТЫ НЕ ДОЛЖЕН:

- говорить о себе как о "языковой модели";
- постоянно напоминать, что ты AI;
- говорить "как искусственный интеллект";
- использовать чрезмерно официальный стиль;
- повторять приветствие;
- заканчивать каждое сообщение вопросом;
- выдумывать сведения.

СОХРАНЁННАЯ ПАМЯТЬ:

${factsText}

ИСТОРИЯ РАЗГОВОРА:

${historyText}

РЕЗУЛЬТАТЫ ИНТЕРНЕТ-ПОИСКА:

${webText}

Отвечай непосредственно человеку.
`.trim();
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

  await env.DB

    .prepare(
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


// ============================================================
// HISTORY
// ============================================================

async function getHistory(
  env,
  userId,
  limit
) {

  const result =
    await env.DB

      .prepare(
        `
        SELECT
          role,
          content

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


  const rows =
    result.results || [];


  return rows.reverse();
}


// ============================================================
// FACTS
// ============================================================

async function getFacts(
  env,
  userId
) {

  const result =
    await env.DB

      .prepare(
        `
        SELECT
          id,
          category,
          fact

        FROM facts

        WHERE user_id = ?

        ORDER BY id DESC

        LIMIT ?
        `
      )

      .bind(
        userId,
        MAX_FACTS
      )

      .all();


  return result.results || [];
}


// ============================================================
// SAVE FACT
// ============================================================

async function saveFact(
  env,
  userId,
  category,
  fact
) {

  const existing =
    await env.DB

      .prepare(
        `
        SELECT id

        FROM facts

        WHERE user_id = ?

        AND category = ?

        AND lower(fact) = lower(?)

        LIMIT 1
        `
      )

      .bind(
        userId,
        category,
        fact
      )

      .first();


  if (existing) {

    await env.DB

      .prepare(
        `
        UPDATE facts

        SET
          fact = ?,
          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `
      )

      .bind(
        fact,
        existing.id
      )

      .run();

    return;
  }


  await env.DB

    .prepare(
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


// ============================================================
// DELETE FACT
// ============================================================

async function deleteFact(
  env,
  userId,
  text
) {

  const result =
    await env.DB

      .prepare(
        `
        DELETE FROM facts

        WHERE user_id = ?

        AND lower(fact)
        LIKE lower(?)
        `
      )

      .bind(
        userId,
        `%${text}%`
      )

      .run();


  return (
    result.meta?.changes || 0
  ) > 0;
}


// ============================================================
// NORMALIZE FACT
// ============================================================

function normalizeFact(
  text
) {

  let fact =
    String(text)

      .trim()

      .replace(
        /[.!?]+$/,
        ""
      )

      .trim();


  fact =
    fact.replace(
      /^я\s+люблю\s+/i,
      "Ты любишь "
    );


  fact =
    fact.replace(
      /^я\s+предпочитаю\s+/i,
      "Ты предпочитаешь "
    );


  fact =
    fact.replace(
      /^я\s+не\s+люблю\s+/i,
      "Ты не любишь "
    );


  fact =
    fact.replace(
      /^мне\s+нравится\s+/i,
      "Тебе нравится "
    );


  fact =
    fact.replace(
      /^мне\s+не\s+нравится\s+/i,
      "Тебе не нравится "
    );


  fact =
    fact.replace(
      /^я\s+хочу\s+/i,
      "Ты хочешь "
    );


  fact =
    fact.replace(
      /^я\s+выбираю\s+/i,
      "Ты выбираешь "
    );


  return fact;
}


// ============================================================
// MEMORY COMMANDS
// ============================================================

function isRememberCommand(
  message
) {

  return /^(джарвис[,\s]*)?(запомни|запиши|сохрани|учти)\b/i
    .test(
      message.trim()
    );
}


function extractRememberFact(
  message
) {

  return message

    .trim()

    .replace(
      /^(джарвис[,\s]*)?(запомни|запиши|сохрани|учти)\s*/i,
      ""
    )

    .trim();
}


function isRecallCommand(
  message
) {

  return (

    /что я люблю/i.test(message) ||

    /что ты знаешь обо мне/i.test(message) ||

    /что ты обо мне помнишь/i.test(message) ||

    /что ты помнишь/i.test(message) ||

    /что у тебя в памяти/i.test(message) ||

    /покажи память/i.test(message)

  );
}


function isForgetCommand(
  message
) {

  return /^(джарвис[,\s]*)?(забудь|удали из памяти)\b/i
    .test(
      message.trim()
    );
}


function extractForgetFact(
  message
) {

  return message

    .trim()

    .replace(
      /^(джарвис[,\s]*)?(забудь|удали из памяти)\s*/i,
      ""
    )

    .trim();
}


function isClearPreferencesCommand(
  message
) {

  return (

    /очисти предпочтения/i.test(message) ||

    /удали все предпочтения/i.test(message)

  );
}


function isClearMemoryCommand(
  message
) {

  return (

    /очисти всю память/i.test(message) ||

    /забудь всё/i.test(message) ||

    /удали всю память/i.test(message)

  );
}


// ============================================================
// SEARCH DECISION
// ============================================================

function shouldSearch(
  message
) {

  const text =
    message.toLowerCase();


  const triggers = [

    "сегодня",

    "сейчас",

    "последние новости",

    "новости",

    "актуальный",

    "актуальная",

    "актуальные",

    "текущий",

    "текущая",

    "текущие",

    "2026",

    "цена",

    "стоимость",

    "курс",

    "погода",

    "расписание",

    "найди в интернете",

    "поищи в интернете",

    "найди",

    "поищи"

  ];


  return triggers.some(
    trigger =>
      text.includes(trigger)
  );
}


// ============================================================
// DUCKDUCKGO
// ============================================================

async function searchDuckDuckGo(
  query,
  limit = 5
) {

  const searchUrl =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);


  const response =
    await fetch(
      searchUrl,
      {

        headers: {

          "User-Agent":
            "Mozilla/5.0 JARVIS/1.0"

        }

      }
    );


  if (!response.ok) {

    throw new Error(
      `DuckDuckGo HTTP ${response.status}`
    );
  }


  const html =
    await response.text();


  const results = [];


  const blocks =
    html.split(
      /result__body/
    );


  for (

    let i = 1;

    i < blocks.length &&
    results.length < limit;

    i++

  ) {

    const block =
      blocks[i];


    const linkMatch =
      block.match(
        /class="result__a"[^>]*href="([^"]+)"/
      );


    if (!linkMatch) {
      continue;
    }


    const url =
      decodeHtml(
        linkMatch[1]
      );


    const titleMatch =
      block.match(
        /class="result__a"[^>]*>(.*?)<\/a>/
      );


    const snippetMatch =
      block.match(
        /class="result__snippet"[^>]*>(.*?)<\/a?>/
      );


    const title =
      stripHtml(
        titleMatch
          ? titleMatch[1]
          : "Результат"
      );


    const snippet =
      stripHtml(
        snippetMatch
          ? snippetMatch[1]
          : ""
      );


    if (!url) {
      continue;
    }


    results.push({

      title,

      url,

      snippet

    });
  }


  return results;
}


// ============================================================
// HTML HELPERS
// ============================================================

function stripHtml(
  text
) {

  return String(
    text || ""
  )

    .replace(
      /<[^>]*>/g,
      ""
    )

    .replace(
      /&nbsp;/g,
      " "
    )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      '"'
    )

    .replace(
      /&#39;/g,
      "'"
    )

    .trim();
}


function decodeHtml(
  text
) {

  return String(
    text || ""
  )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      '"'
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
    )

    .trim();
}


// ============================================================
// HTML
// ============================================================

function getHTML() {

return `<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
>

<meta
  name="theme-color"
  content="#070a10"
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

}


body {

  background:
    radial-gradient(
      circle at top,
      #1b263b 0%,
      #0b1019 45%,
      #05070b 100%
    );

  color: white;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  overflow: hidden;
}


.app {

  width: 100%;

  height: 100%;

  display: flex;

  flex-direction: column;
}


.header {

  flex-shrink: 0;

  padding:
    calc(
      env(safe-area-inset-top) + 18px
    )
    18px
    14px;

  text-align: center;

  background:
    rgba(5,8,14,.85);

  border-bottom:
    1px solid
    rgba(255,255,255,.08);
}


.logo {

  font-size: 22px;

  font-weight: 700;

  letter-spacing: 4px;

  color: #dce8ff;
}


.status {

  margin-top: 5px;

  font-size: 12px;

  color: #8090a8;
}


.messages {

  flex: 1;

  overflow-y: auto;

  padding: 18px;

  -webkit-overflow-scrolling:
    touch;
}


.message {

  max-width: 88%;

  margin-bottom: 14px;

  padding: 12px 15px;

  border-radius: 17px;

  white-space: pre-wrap;

  word-break: break-word;

  line-height: 1.45;

  font-size: 16px;
}


.user {

  margin-left: auto;

  background: #24334d;

  border-bottom-right-radius: 5px;
}


.assistant {

  margin-right: auto;

  background:
    rgba(255,255,255,.08);

  border:
    1px solid
    rgba(255,255,255,.06);

  border-bottom-left-radius: 5px;
}


.error {

  margin-right: auto;

  background:
    rgba(130,30,40,.4);

  border:
    1px solid
    rgba(255,100,110,.2);
}


.sources {

  margin-top: 10px;

  font-size: 12px;
}


.sources a {

  color: #8fb7ff;

  display: block;

  margin-top: 5px;

  text-decoration: none;
}


.bottom {

  flex-shrink: 0;

  padding:
    10px
    12px
    calc(
      env(safe-area-inset-bottom) + 12px
    );

  background:
    rgba(5,8,14,.94);

  border-top:
    1px solid
    rgba(255,255,255,.08);
}


form {

  display: flex;

  gap: 8px;

  align-items: flex-end;
}


textarea {

  flex: 1;

  resize: none;

  min-height: 46px;

  max-height: 130px;

  padding:
    12px
    14px;

  border: 0;

  outline: none;

  border-radius: 16px;

  background: #171e2b;

  color: white;

  font-size: 16px;

  font-family: inherit;
}


textarea::placeholder {

  color: #68758a;
}


button {

  width: 46px;

  height: 46px;

  flex-shrink: 0;

  border: 0;

  border-radius: 50%;

  background: #dce8ff;

  color: #10141c;

  font-size: 22px;

  font-weight: 700;

  display: flex;

  align-items: center;

  justify-content: center;
}


button:disabled {

  opacity: .5;
}


.debug {

  position: fixed;

  top: 7px;

  right: 7px;

  z-index: 100;

  padding: 4px 7px;

  border-radius: 7px;

  font-size: 9px;

  color: #8291aa;

  background:
    rgba(0,0,0,.35);
}

</style>

</head>


<body>


<div class="app">


  <header class="header">

    <div class="logo">
      J.A.R.V.I.S.
    </div>

    <div
      class="status"
      id="status"
    >
      На связи
    </div>

  </header>


  <main
    class="messages"
    id="messages"
  >

    <div class="message assistant">
      Привет. Я на связи.
    </div>

  </main>


  <div class="bottom">

    <form id="chatForm">

      <textarea
        id="input"
        placeholder="Напиши сообщение..."
        autocomplete="off"
        rows="1"
      ></textarea>


      <button
        id="send"
        type="submit"
        aria-label="Отправить"
      >
        ↑
      </button>

    </form>

  </div>

</div>


<div
  class="debug"
  id="debug"
>
  JARVIS
</div>


<script>

(function () {

  "use strict";


  const form =
    document.getElementById(
      "chatForm"
    );


  const input =
    document.getElementById(
      "input"
    );


  const send =
    document.getElementById(
      "send"
    );


  const messages =
    document.getElementById(
      "messages"
    );


  const status =
    document.getElementById(
      "status"
    );


  const debug =
    document.getElementById(
      "debug"
    );


  debug.textContent =
    "READY";


  function addMessage(
    text,
    type,
    sources
  ) {

    const element =
      document.createElement(
        "div"
      );


    element.className =
      "message " + type;


    element.textContent =
      text;


    if (
      Array.isArray(sources) &&
      sources.length
    ) {

      const sourceBox =
        document.createElement(
          "div"
        );


      sourceBox.className =
        "sources";


      sources.forEach(
        function (source) {

          const link =
            document.createElement(
              "a"
            );


          link.href =
            source.url;


          link.target =
            "_blank";


          link.rel =
            "noopener noreferrer";


          link.textContent =
            "↗ " +
            source.title;


          sourceBox.appendChild(
            link
          );
        }
      );


      element.appendChild(
        sourceBox
      );
    }


    messages.appendChild(
      element
    );


    messages.scrollTop =
      messages.scrollHeight;
  }


  async function sendMessage() {

    const message =
      input.value.trim();


    if (!message) {
      return;
    }


    debug.textContent =
      "CLICK";


    addMessage(
      message,
      "user"
    );


    input.value = "";

    input.style.height =
      "46px";


    send.disabled = true;

    input.disabled = true;


    status.textContent =
      "Думаю…";


    try {

      debug.textContent =
        "FETCH";


      const response =
        await fetch(
          "/chat",
          {

            method: "POST",

            headers: {

              "Content-Type":
                "application/json",

              "Accept":
                "application/json"

            },

            cache:
              "no-store",

            body:
              JSON.stringify({
                message:
                  message
              })

          }
        );


      const raw =
        await response.text();


      let data;


      try {

        data =
          JSON.parse(raw);

      } catch {

        throw new Error(
          "Worker вернул не JSON. HTTP " +
          response.status
        );
      }


      if (!response.ok) {

        throw new Error(
          data.error ||
          "HTTP " +
          response.status
        );
      }


      if (!data.ok) {

        throw new Error(
          data.error ||
          "J.A.R.V.I.S. не смог обработать запрос."
        );
      }


      addMessage(
        data.answer ||
        "Ответ пуст.",
        "assistant",
        data.sources || []
      );


      debug.textContent =
        "OK";


      status.textContent =
        "На связи";


    } catch (error) {

      console.error(
        error
      );


      addMessage(
        "Ошибка: " +
        (
          error.message ||
          "Не удалось выполнить запрос."
        ),
        "error"
      );


      debug.textContent =
        "ERROR";


      status.textContent =
        "Ошибка";


    } finally {

      send.disabled =
        false;

      input.disabled =
        false;

      input.focus();
    }
  }


  form.addEventListener(
    "submit",
    function (event) {

      event.preventDefault();

      sendMessage();

    }
  );


  input.addEventListener(
    "keydown",
    function (event) {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        form.requestSubmit();
      }
    }
  );


  input.addEventListener(
    "input",
    function () {

      input.style.height =
        "46px";


      input.style.height =
        Math.min(
          input.scrollHeight,
          130
        ) + "px";
    }
  );

})();

</script>


</body>

</html>`;
}
