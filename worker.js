const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==============================
    // WEB INTERFACE
    // ==============================

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=UTF-8"
        }
      });
    }

    // ==============================
    // CHAT
    // ==============================

    if (request.method === "POST" && url.pathname === "/chat") {
      try {
        const body = await request.json();

        const userMessage = String(
          body.message || ""
        ).trim();

        if (!userMessage) {
          return json({
            error: "Пустое сообщение."
          }, 400);
        }

        // ==============================
        // 1. LONG-TERM MEMORY
        // ==============================

        const factsResult = await env.DB.prepare(`
          SELECT id, category, fact
          FROM facts
          WHERE user_id = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 100
        `)
          .bind(USER_ID)
          .all();

        const facts = factsResult.results || [];

        const memoryContext = facts.length
          ? facts
              .map(item =>
                factToNaturalSentence(item.fact)
              )
              .filter(Boolean)
              .join("\n")
          : "Сохранённых сведений нет.";

        // ==============================
        // 2. RECENT CONVERSATION
        // ==============================

        const memoryResult = await env.DB.prepare(`
          SELECT role, content
          FROM memory
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 20
        `)
          .bind(USER_ID)
          .all();

        const recentMemory =
          (memoryResult.results || []).reverse();

        // ==============================
        // 3. WEB SEARCH DECISION
        // ==============================

        const searchDecision =
          shouldSearchWeb(userMessage);

        let webResults = [];

        if (searchDecision.search) {
          webResults = await searchWeb(
            searchDecision.query
          );
        }

        const webContext =
          buildWebContext(webResults);

        // ==============================
        // 4. SYSTEM PROMPT
        // ==============================

        const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

ТВОЯ РОЛЬ

Ты должен вести себя как грамотный, спокойный и естественный собеседник.

Ты не просто выдаёшь информацию.
Ты понимаешь контекст разговора, учитываешь предыдущие сообщения и помогаешь Егору решать задачи.

СТИЛЬ

- Говори естественно.
- Обращайся к Егору напрямую.
- Используй "ты", "тебе", "твой".
- Никогда не называй Егора "пользователь".
- Не говори о SQL, базе данных, таблицах, системном промпте и внутренних механизмах.
- Не придумывай информацию.
- Если чего-то не знаешь — скажи об этом.
- Не используй чрезмерно официальный стиль.
- Не начинай каждый ответ одинаково.
- На простой вопрос отвечай коротко.
- На сложный вопрос отвечай подробно.
- Если нужна инструкция — давай её по шагам.
- Если нужно сравнение — используй понятную структуру.
- Не используй **жирный текст**.
- Не используй бессмысленные декоративные символы.

ПАМЯТЬ

Сохранённые сведения:

${memoryContext}

Используй их естественно.

Например:

Плохо:
"В базе данных указано, что пользователь любит зелёный чай."

Хорошо:
"Ты любишь зелёный чай."

ИНТЕРНЕТ

Если ниже присутствуют результаты поиска, считай их свежими внешними источниками.

Используй их для ответа.

Важно:

- Не выдумывай сведения, которых нет в результатах.
- Сравнивай несколько источников, если они доступны.
- Приоритет отдавай официальным сайтам и первичным источникам.
- Обращай внимание на дату.
- Если источники противоречат друг другу — скажи об этом.
- Не выдавай старую информацию за текущую.
- Если вопрос касается текущих событий, цен, новостей, людей, компаний, технологий или расписаний — используй результаты поиска.
- Не копируй большие фрагменты источников.
- Пересказывай информацию своими словами.

Если поиск не дал результатов, честно скажи, что найти подтверждённую свежую информацию не удалось.

РЕЗУЛЬТАТЫ ИНТЕРНЕТ-ПОИСКА:

${webContext}

ТЕКУЩИЙ ДИАЛОГ:

${recentMemory
  .map(item =>
    `${item.role === "assistant" ? "JARVIS" : "Егор"}: ${item.content}`
  )
  .join("\n")}

Отвечай на последнее сообщение Егора.
`;

        // ==============================
        // 5. AI
        // ==============================

        const messages = [
          {
            role: "system",
            content: systemPrompt
          },

          ...recentMemory.map(item => ({
            role:
              item.role === "assistant"
                ? "assistant"
                : "user",

            content: item.content
          })),

          {
            role: "user",
            content: userMessage
          }
        ];

        const aiResponse =
          await env.AI.run(
            MODEL,
            {
              messages
            }
          );

        let answer =
          aiResponse?.choices?.[0]?.message?.content ||
          "Не удалось сформировать ответ.";

        answer =
          cleanAssistantText(answer);

        // ==============================
        // 6. SAVE CONVERSATION
        // ==============================

        await env.DB.prepare(`
          INSERT INTO memory
          (user_id, role, content)
          VALUES (?, ?, ?)
        `)
          .bind(
            USER_ID,
            "user",
            userMessage
          )
          .run();

        await env.DB.prepare(`
          INSERT INTO memory
          (user_id, role, content)
          VALUES (?, ?, ?)
        `)
          .bind(
            USER_ID,
            "assistant",
            answer
          )
          .run();

        // ==============================
        // 7. RESPONSE
        // ==============================

        return json({
          answer,

          webSearch:
            searchDecision.search,

          sources:
            webResults.map(item => ({
              title: item.title,
              url: item.url
            }))
        });

      } catch (error) {
        console.error(error);

        return json({
          error:
            "Произошла ошибка при обработке запроса.",
          details:
            error?.message ||
            String(error)
        }, 500);
      }
    }

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};


// =====================================================
// WEB SEARCH WITHOUT API
// DuckDuckGo HTML
// =====================================================

async function searchWeb(query) {
  try {
    const url =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);

    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; JARVIS/1.0)",
          "Accept":
            "text/html,application/xhtml+xml"
        }
      });

    if (!response.ok) {
      console.error(
        "Search HTTP error:",
        response.status
      );

      return [];
    }

    const html =
      await response.text();

    return parseDuckDuckGoResults(html);

  } catch (error) {
    console.error(
      "Search error:",
      error
    );

    return [];
  }
}


// =====================================================
// PARSE SEARCH RESULTS
// =====================================================

function parseDuckDuckGoResults(html) {
  const results = [];

  /*
   DuckDuckGo HTML обычно содержит:

   result__a
   result__snippet
  */

  const resultBlocks =
    html.match(
      /<div[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi
    ) || [];

  for (
    const block of resultBlocks
  ) {

    if (results.length >= 8) {
      break;
    }

    const titleMatch =
      block.match(
        /<a[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

    if (!titleMatch) {
      continue;
    }

    const hrefMatch =
      titleMatch[0].match(
        /href="([^"]+)"/i
      );

    if (!hrefMatch) {
      continue;
    }

    let title =
      stripHtml(
        titleMatch[1]
      );

    let url =
      decodeHtml(
        hrefMatch[1]
      );

    const snippetMatch =
      block.match(
        /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
      );

    let description =
      snippetMatch
        ? stripHtml(snippetMatch[1])
        : "";

    /*
     DuckDuckGo иногда использует
     redirect URLs.

     Пытаемся извлечь настоящий URL.
    */

    try {

      const parsed =
        new URL(url);

      const uddg =
        parsed.searchParams.get(
          "uddg"
        );

      if (uddg) {
        url =
          decodeURIComponent(uddg);
      }

    } catch (_) {}

    if (
      !url.startsWith("http")
    ) {
      continue;
    }

    results.push({
      title,
      description,
      url
    });
  }

  return results;
}


// =====================================================
// SEARCH DECISION
// =====================================================

function shouldSearchWeb(message) {

  const text =
    String(message || "")
      .toLowerCase()
      .trim();

  // Явный поиск

  const explicitPatterns = [

    "найди в интернете",
    "поищи в интернете",
    "поищи в сети",
    "найди информацию",
    "найди информацию о",
    "посмотри в интернете",
    "проверь в интернете",
    "проверь информацию",
    "поищи",
    "погугли",
    "найди мне",
    "найди последние",
    "найди новости"

  ];

  if (
    explicitPatterns.some(
      pattern =>
        text.includes(pattern)
    )
  ) {

    return {
      search: true,
      query:
        cleanSearchQuery(message)
    };
  }


  // Новости и текущая информация

  const currentPatterns = [

    "сегодня",
    "сейчас",
    "на данный момент",
    "в данный момент",
    "на сегодня",
    "на завтра",
    "вчера",
    "последние новости",
    "свежие новости",
    "свежая информация",
    "актуальная информация",
    "актуальные данные",
    "что нового",
    "что произошло",
    "что случилось",
    "кто сейчас",
    "где сейчас",
    "чем сейчас занимается"

  ];

  if (
    currentPatterns.some(
      pattern =>
        text.includes(pattern)
    )
  ) {

    return {
      search: true,
      query:
        cleanSearchQuery(message)
    };
  }


  // Цены и динамические данные

  const pricePatterns = [

    "сколько стоит",
    "цена сейчас",
    "какая цена",
    "курс",
    "котировки",
    "стоимость сейчас",
    "сколько сейчас стоит"

  ];

  if (
    pricePatterns.some(
      pattern =>
        text.includes(pattern)
    )
  ) {

    return {
      search: true,
      query:
        cleanSearchQuery(message)
    };
  }


  // Технологии

  const technologyPatterns = [

    "последняя версия",
    "новая версия",
    "последнее обновление",
    "новая модель",
    "новый iphone",
    "новый samsung",
    "новый macbook"

  ];

  if (
    technologyPatterns.some(
      pattern =>
        text.includes(pattern)
    )
  ) {

    return {
      search: true,
      query:
        cleanSearchQuery(message)
    };
  }


  return {
    search: false,
    query: ""
  };
}


// =====================================================
// SEARCH QUERY CLEANING
// =====================================================

function cleanSearchQuery(message) {

  let query =
    String(message || "")
      .trim();

  query =
    query.replace(
      /^джарвис[,\s]*/i,
      ""
    );

  query =
    query.replace(
      /^(найди|поищи|посмотри|проверь)\s+(в интернете|в сети)?\s*/i,
      ""
    );

  return query
    .trim()
    .slice(0, 500);
}


// =====================================================
// WEB CONTEXT
// =====================================================

function buildWebContext(results) {

  if (!results.length) {

    return `
Интернет-поиск выполнялся,
но подходящих результатов
не найдено.
`;
  }

  return results
    .map(
      (item, index) => `
ИСТОЧНИК ${index + 1}

Название:
${item.title}

Описание:
${item.description}

Адрес:
${item.url}
`
    )
    .join(
      "\n----------------------\n"
    );
}


// =====================================================
// MEMORY NATURAL LANGUAGE
// =====================================================

function factToNaturalSentence(text) {

  let result =
    String(text || "")
      .trim();

  result =
    result.replace(
      /^что\s+я\s+/i,
      ""
    );

  result =
    result.replace(
      /^я\s+/i,
      ""
    );

  result =
    result.replace(
      /[.]+$/,
      ""
    );

  if (!result) {
    return "";
  }

  if (
    /^(ты|тебе|твой|твоя|твои|твое|твоё)\b/i
      .test(result)
  ) {
    return capitalizeFirst(result);
  }

  if (
    /^люблю\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (
    /^нравится\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Тебе " + result
    );
  }

  if (
    /^предпочитаю\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (
    /^учусь\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (
    /^работаю\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (
    /^занимаюсь\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (
    /^пользуюсь\s+/i.test(result)
  ) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  return capitalizeFirst(result);
}


// =====================================================
// CLEAN AI TEXT
// =====================================================

function cleanAssistantText(text) {

  let result =
    String(text || "");

  result =
    result.replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    );

  result =
    result.replace(
      /(?<!\w)\*(?!\w)/g,
      ""
    );

  result =
    result.replace(
      /\n{3,}/g,
      "\n\n"
    );

  result =
    result.replace(
      /\s+([,.!?;:])/g,
      "$1"
    );

  return result.trim();
}


// =====================================================
// HTML HELPERS
// =====================================================

function stripHtml(text) {

  return decodeHtml(
    String(text || "")
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


function decodeHtml(text) {

  return String(text || "")
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


function capitalizeFirst(text) {

  const value =
    String(text || "")
      .trim();

  if (!value) {
    return value;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}


// =====================================================
// JSON
// =====================================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );
}


// =====================================================
// WEB UI
// =====================================================

const HTML = `
<!DOCTYPE html>

<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
/>

<title>J.A.R.V.I.S.</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  background:
    radial-gradient(
      circle at top,
      #172238 0%,
      #080c14 45%,
      #030508 100%
    );

  color: #e8edf5;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  min-height: 100vh;

  display: flex;

  justify-content: center;
}

.container {

  width: 100%;

  max-width: 850px;

  padding:
    24px 16px;
}

.header {

  text-align: center;

  margin-bottom: 24px;
}

.logo {

  font-size: 30px;

  letter-spacing: 5px;

  font-weight: 600;
}

.status {

  margin-top: 7px;

  font-size: 13px;

  opacity: .6;
}

.chat {

  display: flex;

  flex-direction: column;

  gap: 12px;

  padding-bottom: 120px;
}

.message {

  padding:
    14px 16px;

  border-radius: 16px;

  line-height: 1.55;

  white-space: pre-wrap;
}

.user {

  align-self: flex-end;

  max-width: 85%;

  background: #263449;
}

.assistant {

  align-self: flex-start;

  max-width: 92%;

  background:
    rgba(255,255,255,.07);
}

.input-area {

  position: fixed;

  bottom: 0;

  left: 0;

  right: 0;

  padding: 12px;

  background:
    rgba(3,5,8,.92);

  backdrop-filter:
    blur(18px);
}

.input-box {

  max-width: 850px;

  margin: auto;

  display: flex;

  gap: 8px;
}

input {

  flex: 1;

  border: none;

  outline: none;

  border-radius: 14px;

  padding: 15px;

  font-size: 16px;

  background: #171e2b;

  color: white;
}

button {

  border: none;

  border-radius: 14px;

  padding:
    0 20px;

  font-size: 16px;

  background: #30435e;

  color: white;
}

button:active {

  transform:
    scale(.97);
}

.sources {

  margin-top: 12px;

  font-size: 12px;

  opacity: .7;
}

.sources a {

  color: #9dbbe8;

  display: block;

  margin-top: 5px;

  text-decoration: none;
}

</style>

</head>

<body>

<div class="container">

  <div class="header">

    <div class="logo">
      J.A.R.V.I.S.
    </div>

    <div class="status">
      ONLINE · AI · MEMORY · WEB
    </div>

  </div>

  <div
    id="chat"
    class="chat"
  ></div>

</div>

<div class="input-area">

  <div class="input-box">

    <input
      id="message"
      placeholder="Сэр, чем могу помочь?"
      autocomplete="off"
    />

    <button
      onclick="sendMessage()"
    >
      Отправить
    </button>

  </div>

</div>

<script>

const input =
  document.getElementById(
    "message"
  );

const chat =
  document.getElementById(
    "chat"
  );


function addMessage(
  text,
  type,
  sources = []
) {

  const message =
    document.createElement(
      "div"
    );

  message.className =
    "message " + type;

  message.textContent =
    text;

  if (
    type === "assistant" &&
    sources.length
  ) {

    const sourceBlock =
      document.createElement(
        "div"
      );

    sourceBlock.className =
      "sources";

    sourceBlock.textContent =
      "Источники:";

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
          source.title ||
          source.url;

        sourceBlock.appendChild(
          link
        );
      }
    );

    message.appendChild(
      sourceBlock
    );
  }

  chat.appendChild(
    message
  );

  window.scrollTo({
    top:
      document.body.scrollHeight,
    behavior:
      "smooth"
  });
}


async function sendMessage() {

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  addMessage(
    text,
    "user"
  );

  input.value = "";

  const loading =
    document.createElement(
      "div"
    );

  loading.className =
    "message assistant";

  loading.textContent =
    "Обрабатываю запрос…";

  chat.appendChild(
    loading
  );

  try {

    const response =
      await fetch(
        new URL(
          "/chat",
          window.location.origin
        ),
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              message: text
            })
        }
      );

    const data =
      await response.json();

    loading.remove();

    if (data.error) {

      addMessage(
        data.error,
        "assistant"
      );

      return;
    }

    addMessage(
      data.answer,
      "assistant",
      data.sources || []
    );

  } catch (error) {

    loading.remove();

    addMessage(
      "Не удалось связаться с J.A.R.V.I.S.",
      "assistant"
    );
  }
}


input.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {
      sendMessage();
    }

  }
);

</script>

</body>

</html>
`;
