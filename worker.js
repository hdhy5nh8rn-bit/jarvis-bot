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

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(HTML, {
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
          },
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
        } catch {
          return json(
            {
              ok: false,
              error: "Некорректный запрос.",
            },
            400
          );
        }

        const message = String(
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

        const result = await handleMessage(
          message,
          env
        );

        return json({
          ok: true,
          answer: result.answer,
          sources: result.sources || [],
        });
      }

      // ==========================================
      // HEALTH CHECK
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

      return new Response("Not Found", {
        status: 404,
      });

    } catch (error) {
      console.error(
        "GLOBAL ERROR:",
        error
      );

      return json(
        {
          ok: false,
          error:
            "Внутренняя ошибка J.A.R.V.I.S.",
        },
        500
      );
    }
  },
};


// ======================================================
// MAIN MESSAGE HANDLER
// ======================================================

async function handleMessage(
  message,
  env
) {

  // ==========================================
  // MEMORY: SAVE
  // ==========================================

  const factToSave =
    extractSaveFact(message);

  if (factToSave) {

    const fact =
      normalizeFact(factToSave);

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
  // MEMORY: FORGET
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
  // MEMORY: CLEAR PREFERENCES
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
  // MEMORY: CLEAR EVERYTHING
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
  // MEMORY: RECALL
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
  // LOAD CONTEXT
  // ==========================================

  const facts =
    await getFacts(env);

  const history =
    await getHistory(env);


  // ==========================================
  // INTERNET SEARCH
  // ==========================================

  let webResults = [];

  if (
    needsWebSearch(message)
  ) {

    try {
      webResults =
        await searchWeb(message);
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
        "Техническая причина: " +
        (error?.message ||
          "неизвестная ошибка"),
      sources: [],
    };
  }


  // ==========================================
  // CLEAN
  // ==========================================

  answer =
    cleanAnswer(answer);


  // ==========================================
  // SAVE ASSISTANT RESPONSE
  // ==========================================

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
          title: item.title,
          url: item.url,
        })
      ),
  };
}


// ======================================================
// AI ENGINE
// ======================================================

async function askAI(
  env,
  message,
  facts,
  history,
  webResults
) {

  const memoryText =
    facts.length > 0
      ? facts
          .map(
            fact =>
              `- ${fact.fact}`
          )
          .join("\n")
      : "Пока ничего не сохранено.";


  const historyText =
    history.length > 0
      ? history
          .reverse()
          .map(item => {

            const role =
              item.role === "user"
                ? "Егор"
                : "J.A.R.V.I.S.";

            return (
              `${role}: ${item.content}`
            );
          })
          .join("\n")
      : "История отсутствует.";


  const webText =
    webResults.length > 0
      ? webResults
          .map(
            (item, index) =>
              `${index + 1}. ${item.title}
${item.snippet || ""}
${item.url}`
          )
          .join("\n\n")
      : "Поиск не выполнялся.";


  const systemPrompt = `
Ты — J.A.R.V.I.S.

Ты являешься персональным интеллектуальным ассистентом Егора.

Твоя задача — быть не просто чат-ботом, а постоянным умным собеседником и помощником.

ОБРАЩЕНИЕ

Обращайся к Егору на "ты".

Используй:
- ты;
- тебе;
- тебя;
- твой;
- твоя;
- твоё.

Никогда не называй Егора "пользователь".

Никогда не говори:
"пользователь хочет";
"пользователь спросил";
"как пользователь".

Говори:
"ты хочешь";
"ты спрашиваешь";
"тебе нужно".

СТИЛЬ

Отвечай естественно.

Ты должен звучать как умный живой собеседник.

Будь:
- спокойным;
- грамотным;
- уверенным;
- внимательным;
- рациональным;
- дружелюбным;
- ненавязчивым.

Не используй канцелярит.

Не повторяй постоянно одинаковые вступления.

Не начинай каждый ответ с:
"Конечно!";
"Разумеется!";
"С удовольствием!".

Если вопрос простой — отвечай коротко.

Если вопрос сложный — объясняй подробно.

Не задавай вопрос в конце каждого сообщения.

ПРИВЕТСТВИЯ

Если Егор пишет:

"Джарвис привет"

ответ должен быть примерно:

"Привет, Егор. Я на связи."

Если:

"Джарвис, доброе утро"

можно ответить:

"Доброе утро, Егор. Я на связи."

Не нужно после приветствия автоматически перечислять свои возможности.

ПАМЯТЬ

Ты можешь использовать сохранённую информацию о Егоре.

Используй её естественно.

Например, если сохранено:

"Я люблю чай"

можно сказать:

"Помню, ты любишь чай."

Никогда не говори:

"В базе данных сохранён факт..."

Не раскрывай техническую реализацию памяти без прямого вопроса.

ГРАММАТИКА

Особенно внимательно следи за русским согласованием.

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

Если автоматическое преобразование фразы может привести к ошибке, переформулируй её естественно.

КОНТЕКСТ

Используй историю разговора.

Если Егор сначала спрашивает:

"Расскажи про Home Assistant."

а потом:

"А как подключить это к айфону?"

понимай, что "это" относится к Home Assistant.

Не пересказывай историю разговора без необходимости.

ИНТЕРНЕТ

Если предоставлены результаты поиска, используй их для актуальной информации.

Не утверждай, что что-либо найдено в интернете, если результатов поиска нет.

Для текущих данных ориентируйся на свежие результаты поиска.

НЕ ПРИДУМЫВАЙ

Если информации недостаточно — скажи об этом.

Не выдумывай источники.

Не выдумывай факты.

Не выдавай предположение за установленный факт.

ФОРМАТ

Не используй Markdown bold.

Не используй:

**текст**

Используй обычный текст, абзацы и списки.

Не добавляй лишние технические пояснения.

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
              content: systemPrompt,
            },
            {
              role: "user",
              content: message,
            },
          ],

          max_tokens: 700,

          temperature: 0.6,

          chat_template_kwargs: {
            enable_thinking: false,
          },
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


  // ==========================================
  // FORMAT 1
  // ==========================================

  if (
    result &&
    typeof result.response === "string" &&
    result.response.trim()
  ) {

    return result.response.trim();
  }


  // ==========================================
  // FORMAT 2
  // ==========================================

  if (
    result &&
    result.choices &&
    result.choices[0] &&
    result.choices[0].message &&
    typeof result.choices[0].message.content ===
      "string"
  ) {

    return result
      .choices[0]
      .message
      .content
      .trim();
  }


  // ==========================================
  // FORMAT 3
  // ==========================================

  if (
    result &&
    typeof result.text === "string" &&
    result.text.trim()
  ) {

    return result.text.trim();
  }


  // ==========================================
  // EMPTY / UNKNOWN
  // ==========================================

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
      `%${text}%`
    )
    .run();
}


// ======================================================
// FACT PROCESSING
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
      message.match(pattern);

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
      message.match(pattern);

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
      .replace(/\s+/g, " ")
      .replace(/[.!?]+$/, "");


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


  // Сохраняем информацию от первого лица.
  if (
    !/^я\b/i.test(fact)
  ) {

    fact =
      "Я " + fact;
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
      .replace(/[?!.,]/g, "")
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
      text.includes(pattern)
  );
}


function isClearPreferences(
  message
) {

  const text =
    message
      .toLowerCase()
      .replace(/[?!.,]/g, "")
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
      .replace(/[?!.,]/g, "")
      .trim();


  return (

    text.includes("забудь всё") ||

    text.includes("забудь все") ||

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
      /^нравится\b/i,
      "Тебе нравится"
    ],

    [
      /^мне нравится\b/i,
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
    const [
      pattern,
      replacement
    ] of replacements
  ) {

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
          `• ${naturalizeFact(
            fact.fact
          )}`
      )
      .join("\n");


  return (
    "Вот что я сейчас помню о тебе:\n\n" +
    lines
  );
}


// ======================================================
// WEB SEARCH DECISION
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
      text.includes(pattern)
  );
}


// ======================================================
// DUCKDUCKGO SEARCH
// ======================================================

async function searchWeb(
  query
) {

  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);


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
      `DuckDuckGo HTTP ${response.status}`
    );
  }


  const html =
    await response.text();


  const results = [];


  const regex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;


  let match;


  while (
    (match = regex.exec(html)) &&
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


  // ==========================================
  // SNIPPETS
  // ==========================================

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
// HTML HELPERS
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
// ANSWER CLEANING
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
// JSON
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
  content="width=device-width, initial-scale=1.0"
/>

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

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
}

textarea::placeholder {

  color: #718096;
}

button {

  width: 46px;

  height: 46px;

  border: 0;

  border-radius: 14px;

  background:
    #2563eb;

  color: white;

  font-size: 20px;

  cursor: pointer;
}

button:disabled {

  opacity: .45;
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
  placeholder="Напиши J.A.R.V.I.S..."
></textarea>

<button
  id="send"
  onclick="sendMessage()"
>
↑
</button>

</div>

</div>

</div>


<script>

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


input.addEventListener(
  "keydown",
  function(event) {

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
  function() {

    this.style.height =
      "auto";

    this.style.height =
      Math.min(
        this.scrollHeight,
        130
      ) + "px";
  }
);


function addMessage(
  text,
  role,
  sources = []
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
    sources &&
    sources.length
  ) {

    const sourceBox =
      document.createElement(
        "div"
      );

    sourceBox.className =
      "sources";


    sources.forEach(
      source => {

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


function addTyping() {

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.id =
    "typing";

  wrapper.className =
    "message assistant";


  wrapper.innerHTML =
    '<div class="bubble typing">J.A.R.V.I.S. думает…</div>';


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


    removeTyping();


    if (!response.ok) {

      throw new Error(
        data?.error ||
        "HTTP " +
        response.status
      );
    }


    if (!data.ok) {

      throw new Error(
        data?.error ||
        "Неизвестная ошибка"
      );
    }


    addMessage(
      data.answer ||
        "Я не получил ответа.",
      "assistant",
      data.sources || []
    );


  } catch (error) {

    removeTyping();


    addMessage(
      "Ошибка связи с J.A.R.V.I.S.\n\n" +
      (
        error?.message ||
        "Неизвестная ошибка"
      ),
      "assistant"
    );


  } finally {

    send.disabled =
      false;

    input.focus();
  }
}

</script>

</body>

</html>
`;
