const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

const MAX_HISTORY = 10;
const MAX_FACTS = 30;
const MAX_SEARCH_RESULTS = 5;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // ==========================================
      // MAIN PAGE
      // ==========================================

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return new Response(HTML, {
          status: 200,
          headers: {
            "Content-Type":
              "text/html; charset=UTF-8",
            "Cache-Control":
              "no-store",
          },
        });
      }

      // ==========================================
      // HEALTH
      // ==========================================

      if (
        request.method === "GET" &&
        url.pathname === "/health"
      ) {
        return json({
          ok: true,
          service: "J.A.R.V.I.S.",
          status: "online",
          model: MODEL,
        });
      }

      // ==========================================
      // CHAT
      // ==========================================

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {
        let body;

        try {
          body = await request.json();
        } catch (error) {
          return json(
            {
              ok: false,
              error: "Некорректный JSON-запрос.",
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
              error: "Сообщение пустое.",
            },
            400
          );
        }

        const result =
          await handleMessage(
            message,
            env
          );

        return json({
          ok: true,
          answer:
            result.answer || "",
          sources:
            result.sources || [],
        });
      }

      return new Response(
        "Not Found",
        {
          status: 404,
        }
      );

    } catch (error) {
      console.error(
        "GLOBAL ERROR:",
        error
      );

      return json(
        {
          ok: false,
          error:
            error?.message ||
            "Внутренняя ошибка J.A.R.V.I.S.",
        },
        500
      );
    }
  },
};


// ======================================================
// MESSAGE HANDLER
// ======================================================

async function handleMessage(
  message,
  env
) {

  // ==========================================
  // SAVE MEMORY
  // ==========================================

  const factToSave =
    extractSaveFact(message);

  if (factToSave) {

    const fact =
      normalizeFact(
        factToSave
      );

    await saveFact(
      env,
      fact
    );

    await saveMemory(
      env,
      "user",
      message
    );

    const answer =
      "Запомнил. Буду иметь в виду.";

    await saveMemory(
      env,
      "assistant",
      answer
    );

    return {
      answer,
      sources: [],
    };
  }


  // ==========================================
  // FORGET MEMORY
  // ==========================================

  const factToForget =
    extractForgetFact(message);

  if (factToForget) {

    await deleteFact(
      env,
      factToForget
    );

    await saveMemory(
      env,
      "user",
      message
    );

    const answer =
      "Хорошо. Я больше не буду это учитывать.";

    await saveMemory(
      env,
      "assistant",
      answer
    );

    return {
      answer,
      sources: [],
    };
  }


  // ==========================================
  // CLEAR PREFERENCES
  // ==========================================

  if (
    isClearPreferences(message)
  ) {

    await env.DB
      .prepare(`
        DELETE FROM facts
        WHERE user_id = ?
        AND category = 'preference'
      `)
      .bind(USER_ID)
      .run();

    await saveMemory(
      env,
      "user",
      message
    );

    const answer =
      "Готово. Сохранённые предпочтения удалены.";

    await saveMemory(
      env,
      "assistant",
      answer
    );

    return {
      answer,
      sources: [],
    };
  }


  // ==========================================
  // CLEAR ALL MEMORY
  // ==========================================

  if (
    isClearAllMemory(message)
  ) {

    await env.DB
      .prepare(`
        DELETE FROM facts
        WHERE user_id = ?
      `)
      .bind(USER_ID)
      .run();

    await env.DB
      .prepare(`
        DELETE FROM memory
        WHERE user_id = ?
      `)
      .bind(USER_ID)
      .run();

    return {
      answer:
        "Готово. Память очищена.",
      sources: [],
    };
  }


  // ==========================================
  // RECALL MEMORY
  // ==========================================

  if (
    isRecallMemory(message)
  ) {

    const facts =
      await getFacts(env);

    const answer =
      formatFactsForUser(facts);

    await saveMemory(
      env,
      "user",
      message
    );

    await saveMemory(
      env,
      "assistant",
      answer
    );

    return {
      answer,
      sources: [],
    };
  }


  // ==========================================
  // SAVE USER MESSAGE
  // ==========================================

  await saveMemory(
    env,
    "user",
    message
  );


  // ==========================================
  // LOAD MEMORY
  // ==========================================

  const facts =
    await getFacts(env);

  const history =
    await getHistory(env);


  // ==========================================
  // INTERNET
  // ==========================================

  let webResults = [];

  if (
    needsWebSearch(message)
  ) {

    try {

      webResults =
        await searchWeb(
          message
        );

    } catch (error) {

      console.error(
        "SEARCH ERROR:",
        error
      );

      webResults = [];
    }
  }


  // ==========================================
  // AI
  // ==========================================

  let answer;

  try {

    answer =
      await askAI(
        env,
        message,
        facts,
        history,
        webResults
      );

  } catch (error) {

    console.error(
      "AI ERROR:",
      error
    );

    return {
      answer:
        "Не удалось получить ответ от интеллектуального модуля.\n\n" +
        "Причина: " +
        (
          error?.message ||
          "неизвестная ошибка"
        ),
      sources: [],
    };
  }


  answer =
    cleanAnswer(answer);


  await saveMemory(
    env,
    "assistant",
    answer
  );


  return {
    answer,
    sources:
      webResults.map(
        item => ({
          title:
            item.title,
          url:
            item.url,
        })
      ),
  };
}


// ======================================================
// AI
// ======================================================

async function askAI(
  env,
  message,
  facts,
  history,
  webResults
) {

  const memoryText =
    facts.length
      ? facts
          .map(
            fact =>
              "- " + fact.fact
          )
          .join("\n")
      : "Пока ничего не сохранено.";


  const orderedHistory =
    [...history]
      .reverse();


  const historyText =
    orderedHistory.length
      ? orderedHistory
          .map(item => {

            const role =
              item.role === "user"
                ? "Егор"
                : "J.A.R.V.I.S.";

            return (
              role +
              ": " +
              item.content
            );
          })
          .join("\n")
      : "История отсутствует.";


  const webText =
    webResults.length
      ? webResults
          .map(
            (item, index) =>
              (
                index + 1
              ) +
              ". " +
              item.title +
              "\n" +
              (
                item.snippet ||
                ""
              ) +
              "\n" +
              item.url
          )
          .join("\n\n")
      : "Поиск не выполнялся.";


  const systemPrompt = `
Ты — J.A.R.V.I.S.

Ты персональный интеллектуальный ассистент Егора.

Твоя задача — быть умным, естественным и внимательным собеседником, который помогает Егору думать, искать информацию, планировать задачи, учиться и решать проблемы.

ОБРАЩЕНИЕ

Обращайся к Егору на "ты".

Используй:
ты;
тебе;
тебя;
твой;
твоя;
твоё.

Никогда не называй Егора "пользователь".

Не используй фразы:
"пользователь хочет";
"пользователь спросил";
"как пользователь".

Используй:
"ты хочешь";
"ты спрашиваешь";
"тебе нужно".

СТИЛЬ

Говори естественно.

Ты должен звучать как грамотный живой собеседник.

Будь:
спокойным;
уверенным;
внимательным;
рациональным;
дружелюбным;
ненавязчивым.

Не используй канцелярит.

Не начинай каждый ответ с:
"Конечно!";
"Разумеется!";
"С удовольствием!".

Не повторяй одинаковые фразы.

Если вопрос простой — отвечай коротко.

Если вопрос сложный — объясняй подробно и структурированно.

Не задавай вопрос в конце каждого ответа.

ПРИВЕТСТВИЯ

Если Егор пишет:
"Джарвис привет"

можно ответить:

"Привет, Егор. Я на связи."

Если Егор пишет:
"Джарвис, доброе утро"

можно ответить:

"Доброе утро, Егор. Я на связи."

После приветствия не перечисляй автоматически свои возможности.

ПАМЯТЬ

Используй сохранённую информацию естественно.

Если известно, что Егор любит чай, можно сказать:

"Помню, ты любишь чай."

Не говори:
"В базе данных сохранён факт..."

Не раскрывай техническую реализацию памяти без прямого вопроса.

ГРАММАТИКА

Всегда следи за правильным русским языком.

Неправильно:
"Ты люблю чай."

Правильно:
"Ты любишь чай."

Неправильно:
"Ты предпочитаю кофе."

Правильно:
"Ты предпочитаешь кофе."

Неправильно:
"Ты учусь в университете."

Правильно:
"Ты учишься в университете."

Не копируй механически грамматическую форму сохранённого факта.

КОНТЕКСТ

Используй историю разговора.

Если Егор спрашивает:
"Расскажи про Home Assistant."

а затем:
"А как подключить это к айфону?"

понимай, что "это" относится к Home Assistant.

Не пересказывай историю без необходимости.

ИНТЕРНЕТ

Если предоставлены результаты поиска, используй их.

Для актуальной информации опирайся на результаты поиска.

Не утверждай, что информация найдена в интернете, если результатов поиска нет.

НЕ ПРИДУМЫВАЙ

Не выдумывай факты.

Не выдумывай источники.

Не выдавай предположение за установленный факт.

Если информации недостаточно — честно скажи об этом.

ФОРМАТ

Не используй Markdown bold.

Не используй:

**текст**

Можно использовать:
обычные абзацы;
нумерованные списки;
маркированные списки;
короткие заголовки.

ТВОЯ ПАМЯТЬ О ЕГОРЕ:

${memoryText}

ИСТОРИЯ ДИАЛОГА:

${historyText}

РЕЗУЛЬТАТЫ ПОИСКА:

${webText}
`;


  let result;

  try {

    result =
      await env.AI.run(
        MODEL,
        {
          messages: [
            {
              role: "system",
              content:
                systemPrompt,
            },
            {
              role: "user",
              content:
                message,
            },
          ],

          max_tokens: 700,

          temperature: 0.6,
        }
      );

  } catch (error) {

    console.error(
      "WORKERS AI REQUEST ERROR:",
      error
    );

    throw new Error(
      "Workers AI не выполнил запрос: " +
      (
        error?.message ||
        String(error)
      )
    );
  }


  console.log(
    "WORKERS AI RESULT:",
    JSON.stringify(result)
  );


  if (
    result &&
    typeof result.response ===
      "string" &&
    result.response.trim()
  ) {
    return result.response.trim();
  }


  if (
    result &&
    Array.isArray(
      result.choices
    ) &&
    result.choices[0] &&
    result.choices[0].message &&
    typeof
      result.choices[0].message.content ===
        "string"
  ) {

    return result
      .choices[0]
      .message
      .content
      .trim();
  }


  if (
    result &&
    typeof result.text ===
      "string" &&
    result.text.trim()
  ) {
    return result.text.trim();
  }


  console.error(
    "UNKNOWN AI RESULT:",
    JSON.stringify(result)
  );

  throw new Error(
    "Workers AI вернул пустой или неизвестный формат ответа."
  );
}


// ======================================================
// MEMORY
// ======================================================

async function saveMemory(
  env,
  role,
  content
) {

  await env.DB
    .prepare(`
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


async function saveFact(
  env,
  fact
) {

  const existing =
    await env.DB
      .prepare(`
        SELECT id
        FROM facts
        WHERE user_id = ?
        AND category = ?
        AND LOWER(fact) = LOWER(?)
        LIMIT 1
      `)
      .bind(
        USER_ID,
        fact.category,
        fact.fact
      )
      .first();


  if (existing) {

    await env.DB
      .prepare(`
        UPDATE facts
        SET updated_at =
          CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        existing.id
      )
      .run();

    return;
  }


  await env.DB
    .prepare(`
      INSERT INTO facts
      (user_id, category, fact)
      VALUES (?, ?, ?)
    `)
    .bind(
      USER_ID,
      fact.category,
      fact.fact
    )
    .run();
}


async function getFacts(env) {

  const result =
    await env.DB
      .prepare(`
        SELECT
          id,
          category,
          fact,
          created_at,
          updated_at
        FROM facts
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .bind(
        USER_ID,
        MAX_FACTS
      )
      .all();

  return result.results || [];
}


async function getHistory(env) {

  const result =
    await env.DB
      .prepare(`
        SELECT
          id,
          role,
          content,
          created_at
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

  return result.results || [];
}


async function deleteFact(
  env,
  text
) {

  await env.DB
    .prepare(`
      DELETE FROM facts
      WHERE user_id = ?
      AND LOWER(fact) LIKE LOWER(?)
    `)
    .bind(
      USER_ID,
      "%" +
      text +
      "%"
    )
    .run();
}


// ======================================================
// FACT EXTRACTION
// ======================================================

function extractSaveFact(
  message
) {

  const patterns = [
    /^запомни[, ]+(?:что )?(.+)$/i,
    /^запиши[, ]+(?:что )?(.+)$/i,
    /^сохрани[, ]+(?:что )?(.+)$/i,
    /^учти[, ]+(?:что )?(.+)$/i,
    /^имей в виду[, ]+(?:что )?(.+)$/i,
    /^не забывай[, ]+(?:что )?(.+)$/i,
  ];


  for (
    const pattern of patterns
  ) {

    const match =
      message.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {

      return match[1].trim();
    }
  }


  return null;
}


function extractForgetFact(
  message
) {

  const patterns = [
    /^забудь[, ]+(?:что )?(.+)$/i,
    /^удали[, ]+(?:что )?(.+)$/i,
    /^не учитывай[, ]+(?:что )?(.+)$/i,
  ];


  for (
    const pattern of patterns
  ) {

    const match =
      message.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {

      return match[1].trim();
    }
  }


  return null;
}


function normalizeFact(
  rawFact
) {

  let fact =
    rawFact
      .trim()
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /[.!?]+$/,
        ""
      );


  let category =
    "general";


  const lower =
    fact.toLowerCase();


  if (
    lower.includes("люблю") ||
    lower.includes("нравится") ||
    lower.includes("предпочитаю") ||
    lower.includes("любимый") ||
    lower.includes("любимая") ||
    lower.includes("любимое")
  ) {

    category =
      "preference";
  }


  if (
    lower.includes("учусь") ||
    lower.includes("университет") ||
    lower.includes("учеб")
  ) {

    category =
      "education";
  }


  if (
    lower.includes("работаю") ||
    lower.includes("работа") ||
    lower.includes("проект")
  ) {

    category =
      "work";
  }


  if (
    lower.includes("живу") ||
    lower.includes("нахожусь")
  ) {

    category =
      "location";
  }


  if (
    !/^я\b/i.test(fact)
  ) {

    fact =
      "Я " +
      fact;
  }


  return {
    category,
    fact,
  };
}


// ======================================================
// MEMORY QUESTIONS
// ======================================================

function isRecallMemory(
  message
) {

  const text =
    message
      .toLowerCase()
      .replace(
        /[?!.,]/g,
        ""
      )
      .trim();


  const patterns = [
    "что ты знаешь обо мне",
    "что ты помнишь обо мне",
    "что ты обо мне помнишь",
    "что ты знаешь про меня",
    "что ты помнишь про меня",
    "покажи что ты помнишь",
    "расскажи что ты помнишь",
    "моя память",
    "мои сохраненные факты",
    "мои сохранённые факты",
  ];


  return patterns.some(
    pattern =>
      text.includes(
        pattern
      )
  );
}


function isClearPreferences(
  message
) {

  const text =
    message
      .toLowerCase()
      .replace(
        /[?!.,]/g,
        ""
      )
      .trim();


  return (
    text.includes(
      "очисти предпочтения"
    ) ||
    text.includes(
      "забудь мои предпочтения"
    ) ||
    text.includes(
      "удали предпочтения"
    ) ||
    text.includes(
      "очисти мои предпочтения"
    )
  );
}


function isClearAllMemory(
  message
) {

  const text =
    message
      .toLowerCase()
      .replace(
        /[?!.,]/g,
        ""
      )
      .trim();


  return (
    text.includes(
      "забудь всё"
    ) ||
    text.includes(
      "забудь все"
    ) ||
    text.includes(
      "очисти всю память"
    ) ||
    text.includes(
      "удали всю память"
    ) ||
    text.includes(
      "очисти память полностью"
    )
  );
}


// ======================================================
// NATURAL LANGUAGE MEMORY
// ======================================================

function naturalizeFact(
  fact
) {

  let text =
    fact.trim();


  text =
    text.replace(
      /^я\s+/i,
      ""
    );


  const replacements = [
    [
      /^люблю\b/i,
      "Ты любишь"
    ],
    [
      /^обожаю\b/i,
      "Ты обожаешь"
    ],
    [
      /^мне нравится\b/i,
      "Тебе нравится"
    ],
    [
      /^нравится\b/i,
      "Тебе нравится"
    ],
    [
      /^предпочитаю\b/i,
      "Ты предпочитаешь"
    ],
    [
      /^не люблю\b/i,
      "Ты не любишь"
    ],
    [
      /^ненавижу\b/i,
      "Ты не любишь"
    ],
    [
      /^хочу\b/i,
      "Ты хочешь"
    ],
    [
      /^изучаю\b/i,
      "Ты изучаешь"
    ],
    [
      /^учусь\b/i,
      "Ты учишься"
    ],
    [
      /^работаю\b/i,
      "Ты работаешь"
    ],
    [
      /^живу\b/i,
      "Ты живёшь"
    ],
    [
      /^нахожусь\b/i,
      "Ты находишься"
    ],
  ];


  for (
    const item of replacements
  ) {

    const pattern =
      item[0];

    const replacement =
      item[1];

    if (
      pattern.test(text)
    ) {

      return (
        text
          .replace(
            pattern,
            replacement
          )
          .replace(
            /[.!?]+$/,
            ""
          ) +
        "."
      );
    }
  }


  return (
    text
      .replace(
        /^./,
        char =>
          char.toUpperCase()
      )
      .replace(
        /[.!?]+$/,
        ""
      ) +
    "."
  );
}


function formatFactsForUser(
  facts
) {

  if (
    facts.length === 0
  ) {

    return (
      "Пока я ничего важного о тебе не сохранил."
    );
  }


  if (
    facts.length === 1
  ) {

    return (
      "Помню: " +
      naturalizeFact(
        facts[0].fact
      )
    );
  }


  const lines =
    facts
      .map(
        fact =>
          "• " +
          naturalizeFact(
            fact.fact
          )
      )
      .join("\n");


  return (
    "Вот что я сейчас помню о тебе:\n\n" +
    lines
  );
}


// ======================================================
// WEB SEARCH
// ======================================================

function needsWebSearch(
  message
) {

  const text =
    message.toLowerCase();


  const patterns = [
    "сегодня",
    "сейчас",
    "последние",
    "последняя",
    "последний",
    "новости",
    "актуальн",
    "текущ",
    "цена",
    "стоимость",
    "курс",
    "расписание",
    "открыт",
    "работает ли",
    "версия",
    "релиз",
    "обновление",
    "2026",
    "на данный момент",
    "найди в интернете",
    "поищи в интернете",
    "найди информацию",
    "поищи информацию",
    "что произошло",
    "что случилось",
    "как сейчас",
  ];


  return patterns.some(
    pattern =>
      text.includes(
        pattern
      )
  );
}


// ======================================================
// DUCKDUCKGO
// ======================================================

async function searchWeb(
  query
) {

  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(
      query
    );


  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JARVIS/1.0)",
          "Accept":
            "text/html,application/xhtml+xml",
        },
      }
    );


  if (!response.ok) {

    throw new Error(
      "DuckDuckGo HTTP " +
      response.status
    );
  }


  const html =
    await response.text();


  const results = [];


  const regex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;


  let match;


  while (
    (match =
      regex.exec(html)) &&
    results.length <
      MAX_SEARCH_RESULTS
  ) {

    let link =
      decodeHtml(
        match[1]
      );


    const title =
      stripHtml(
        match[2]
      );


    try {

      const parsed =
        new URL(link);

      const realUrl =
        parsed.searchParams.get(
          "uddg"
        );

      if (realUrl) {
        link =
          realUrl;
      }

    } catch {}


    if (
      !link.startsWith(
        "http://"
      ) &&
      !link.startsWith(
        "https://"
      )
    ) {
      continue;
    }


    results.push({
      title,
      url: link,
      snippet: "",
    });
  }


  const snippetRegex =
    /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;


  let snippetMatch;
  let index = 0;


  while (
    (snippetMatch =
      snippetRegex.exec(html)) &&
    index < results.length
  ) {

    results[index].snippet =
      stripHtml(
        snippetMatch[1]
      );

    index++;
  }


  return results;
}


// ======================================================
// HTML
// ======================================================

function stripHtml(
  text
) {

  return decodeHtml(
    text
      .replace(
        /<[^>]*>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}


function decodeHtml(
  text
) {

  return text
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
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&#x2F;/gi,
      "/"
    );
}


// ======================================================
// CLEAN ANSWER
// ======================================================

function cleanAnswer(
  answer
) {

  let text =
    String(
      answer || ""
    ).trim();


  text =
    text.replace(
      /\*\*/g,
      ""
    );


  text =
    text.replace(
      /```/g,
      ""
    );


  text =
    text.replace(
      /[ \t]+\n/g,
      "\n"
    );


  text =
    text.replace(
      /\n{3,}/g,
      "\n\n"
    );


  return text.trim();
}


// ======================================================
// JSON RESPONSE
// ======================================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          "no-store",
      },
    }
  );
}


// ======================================================
// WEB INTERFACE
// ======================================================

const HTML = `
<!DOCTYPE html>

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
}

body {

  min-height: 100vh;

  background:
    radial-gradient(
      circle at top,
      #162238 0%,
      #080b12 45%,
      #030408 100%
    );

  color: #f1f5f9;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  display: flex;

  justify-content: center;
}

.app {

  width: 100%;

  max-width: 850px;

  min-height: 100vh;

  display: flex;

  flex-direction: column;
}

.header {

  padding:
    20px 18px 14px;

  display: flex;

  align-items: center;

  justify-content: space-between;

  border-bottom:
    1px solid
    rgba(255,255,255,.08);

  background:
    rgba(3,6,12,.65);

  backdrop-filter:
    blur(15px);

  position: sticky;

  top: 0;

  z-index: 10;
}

.logo {

  font-size: 20px;

  font-weight: 700;

  letter-spacing: 2px;
}

.status {

  font-size: 12px;

  color: #7dd3fc;

  display: flex;

  align-items: center;

  gap: 7px;
}

.dot {

  width: 7px;

  height: 7px;

  border-radius: 50%;

  background: #4ade80;

  box-shadow:
    0 0 12px #4ade80;
}

.messages {

  flex: 1;

  padding:
    22px 16px 120px;

  overflow-y: auto;

  -webkit-overflow-scrolling: touch;
}

.message {

  display: flex;

  margin-bottom: 16px;
}

.message.user {

  justify-content:
    flex-end;
}

.bubble {

  max-width: 85%;

  padding:
    12px 15px;

  border-radius: 17px;

  line-height: 1.5;

  white-space: pre-wrap;

  word-break: break-word;

  font-size: 15px;
}

.user .bubble {

  background:
    #2563eb;

  border-bottom-right-radius:
    5px;
}

.assistant .bubble {

  background:
    rgba(255,255,255,.075);

  border:
    1px solid
    rgba(255,255,255,.08);

  border-bottom-left-radius:
    5px;
}

.sources {

  margin-top: 10px;

  font-size: 12px;
}

.sources a {

  color: #7dd3fc;

  text-decoration: none;

  display: block;

  margin-top: 6px;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;
}

.input-area {

  position: fixed;

  left: 0;

  right: 0;

  bottom: 0;

  padding:
    12px 12px
    calc(
      12px +
      env(safe-area-inset-bottom)
    );

  background:
    linear-gradient(
      transparent,
      rgba(3,4,8,.97) 30%
    );

  z-index: 20;
}

.input-wrap {

  max-width: 850px;

  margin: 0 auto;

  display: flex;

  gap: 8px;

  background:
    rgba(20,25,35,.95);

  border:
    1px solid
    rgba(255,255,255,.1);

  border-radius: 18px;

  padding: 8px;
}

textarea {

  flex: 1;

  resize: none;

  border: 0;

  outline: 0;

  background: transparent;

  color: white;

  font-size: 16px;

  padding: 10px 8px;

  max-height: 130px;

  font-family: inherit;

  min-width: 0;
}

textarea::placeholder {

  color: #718096;
}

button {

  width: 46px;

  min-width: 46px;

  height: 46px;

  border: 0;

  border-radius: 14px;

  background:
    #2563eb;

  color: white;

  font-size: 22px;

  cursor: pointer;

  -webkit-appearance: none;

  touch-action: manipulation;
}

button:active {

  transform:
    scale(.94);
}

button:disabled {

  opacity: .45;

  transform: none;
}

.typing {

  opacity: .6;

  font-style: italic;
}

</style>

</head>

<body>

<div class="app">

<header class="header">

<div class="logo">
J.A.R.V.I.S.
</div>

<div class="status">

<span class="dot"></span>

ONLINE

</div>

</header>


<main
  id="messages"
  class="messages"
>

<div class="message assistant">

<div class="bubble">
Привет, Егор. Я на связи.
</div>

</div>

</main>


<div class="input-area">

<div class="input-wrap">

<textarea
  id="input"
  rows="1"
  autocomplete="off"
  autocorrect="on"
  spellcheck="true"
  placeholder="Напиши J.A.R.V.I.S..."
></textarea>

<button
  id="send"
  type="button"
  aria-label="Отправить сообщение"
>
↑
</button>

</div>

</div>

</div>


<script>

(function () {

  const input =
    document.getElementById("input");

  const send =
    document.getElementById("send");

  const messages =
    document.getElementById("messages");


  // ========================================
  // SEND BUTTON
  // ========================================

  send.addEventListener(
    "click",
    sendMessage
  );


  // ========================================
  // ENTER
  // ========================================

  input.addEventListener(
    "keydown",
    function (event) {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        sendMessage();
      }
    }
  );


  // ========================================
  // TEXTAREA HEIGHT
  // ========================================

  input.addEventListener(
    "input",
    function () {

      this.style.height =
        "auto";

      this.style.height =
        Math.min(
          this.scrollHeight,
          130
        ) + "px";
    }
  );


  // ========================================
  // ADD MESSAGE
  // ========================================

  function addMessage(
    text,
    role,
    sources
  ) {

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.className =
      "message " + role;


    const bubble =
      document.createElement(
        "div"
      );

    bubble.className =
      "bubble";

    bubble.textContent =
      text;


    wrapper.appendChild(
      bubble
    );


    if (
      Array.isArray(sources) &&
      sources.length > 0
    ) {

      const sourceBox =
        document.createElement(
          "div"
        );

      sourceBox.className =
        "sources";


      sources.forEach(
        function (source) {

          if (
            !source ||
            !source.url
          ) {
            return;
          }


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
            (
              source.title ||
              source.url
            );


          sourceBox.appendChild(
            link
          );
        }
      );


      bubble.appendChild(
        sourceBox
      );
    }


    messages.appendChild(
      wrapper
    );


    messages.scrollTop =
      messages.scrollHeight;
  }


  // ========================================
  // TYPING
  // ========================================

  function addTyping() {

    removeTyping();


    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.id =
      "typing";

    wrapper.className =
      "message assistant";


    const bubble =
      document.createElement(
        "div"
      );

    bubble.className =
      "bubble typing";

    bubble.textContent =
      "J.A.R.V.I.S. думает…";


    wrapper.appendChild(
      bubble
    );

    messages.appendChild(
      wrapper
    );


    messages.scrollTop =
      messages.scrollHeight;
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


  // ========================================
  // SEND MESSAGE
  // ========================================

  async function sendMessage() {

    const message =
      input.value.trim();


    if (!message) {
      input.focus();
      return;
    }


    addMessage(
      message,
      "user",
      []
    );


    input.value =
      "";

    input.style.height =
      "auto";

    send.disabled =
      true;

    addTyping();


    try {

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

      } catch (parseError) {

        throw new Error(
          "Сервер вернул некорректный ответ: " +
          raw.slice(0, 200)
        );
      }


      removeTyping();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "Ошибка HTTP " +
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
          "Я не получил текст ответа.",
        "assistant",
        data.sources ||
          []
      );


    } catch (error) {

      removeTyping();


      addMessage(
        "Ошибка связи с J.A.R.V.I.S.\n\n" +
        (
          error &&
          error.message
            ? error.message
            : "Неизвестная ошибка."
        ),
        "assistant",
        []
      );

    } finally {

      send.disabled =
        false;

      input.focus();
    }
  }


  // ========================================
  // INITIAL FOCUS
  // ========================================

  setTimeout(
    function () {
      input.focus();
    },
    300
  );

})();

</script>

</body>

</html>
`;
