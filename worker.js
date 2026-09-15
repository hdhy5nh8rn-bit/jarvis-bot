const MODEL = "@cf/zai-org/glm-4.7-flash";
const USER_ID = "egor";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: {
          "content-type": "text/html; charset=UTF-8"
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      try {
        const body = await request.json();
        const userMessage = String(body.message || "").trim();

        if (!userMessage) {
          return json({
            error: "Пустое сообщение"
          }, 400);
        }

        /*
        ==========================================
        1. ЗАГРУЖАЕМ ДОЛГОВРЕМЕННУЮ ПАМЯТЬ
        ==========================================
        */

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

        /*
        ==========================================
        2. ЗАГРУЖАЕМ НЕДАВНИЙ ДИАЛОГ
        ==========================================
        */

        const memoryResult = await env.DB.prepare(`
          SELECT role, content
          FROM memory
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 20
        `)
          .bind(USER_ID)
          .all();

        const recentMemory = (memoryResult.results || []).reverse();

        /*
        ==========================================
        3. ОПРЕДЕЛЯЕМ, НУЖЕН ЛИ ИНТЕРНЕТ
        ==========================================
        */

        const searchDecision = shouldSearchWeb(userMessage);

        let webResults = [];
        let webContext = "";

        if (searchDecision.search) {
          webResults = await searchWeb(
            searchDecision.query,
            env
          );

          webContext = buildWebContext(webResults);
        }

        /*
        ==========================================
        4. ФОРМИРУЕМ КОНТЕКСТ ПАМЯТИ
        ==========================================
        */

        const memoryContext = facts.length
          ? facts
              .map((item) => factToNaturalSentence(item.fact))
              .join("\n")
          : "Дополнительных сохранённых сведений о пользователе нет.";

        const conversationContext = recentMemory.length
          ? recentMemory
              .map(item => {
                const role =
                  item.role === "assistant"
                    ? "JARVIS"
                    : "Егор";

                return `${role}: ${item.content}`;
              })
              .join("\n")
          : "Предыдущих сообщений нет.";

        /*
        ==========================================
        5. СИСТЕМНЫЙ ПРОМПТ
        ==========================================
        */

        const systemPrompt = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент Егора.

Твоя задача — быть не просто справочником, а грамотным собеседником и помощником.

ОСНОВНОЙ СТИЛЬ:

- говори естественно;
- отвечай как живой интеллектуальный собеседник;
- обращайся к Егору напрямую: "ты", "тебе", "твой";
- не называй его "пользователь";
- не говори о базе данных, памяти, SQL, алгоритмах и внутренних механизмах;
- не придумывай факты;
- если информации недостаточно — прямо скажи об этом;
- если использовался интернет — используй найденные данные;
- не утверждай, что информация свежая, если поиск не выполнялся;
- отвечай на русском языке, если Егор не попросил другой язык;
- не используй Markdown-жирный текст;
- не злоупотребляй списками;
- не начинай каждый ответ одинаковой фразой;
- отвечай кратко на простой вопрос и подробно на сложный;
- если вопрос требует объяснения — объясняй простым языком;
- если пользователь просит инструкцию — давай пошаговую инструкцию;
- если пользователь просит сравнение — структурируй сравнение;
- если пользователь просит найти что-либо в интернете — используй результаты поиска.

ВАЖНО:

Ты должен отличать:
1. общеизвестные знания;
2. сведения из памяти о Егоре;
3. свежую информацию из интернета.

Нельзя выдавать сведения из памяти за результаты интернет-поиска.

ЕСЛИ ЕСТЬ РЕЗУЛЬТАТЫ ИНТЕРНЕТ-ПОИСКА:

- анализируй несколько результатов;
- отдавай предпочтение первичным и официальным источникам;
- учитывай дату публикации;
- не копируй длинные фрагменты;
- пересказывай информацию своими словами;
- если источники противоречат друг другу — сообщи об этом;
- не придумывай отсутствующие сведения;
- в конце ответа при необходимости дай короткий блок "Источники".

ИНФОРМАЦИЯ О ЕГОРЕ:

${memoryContext}

ПОСЛЕДНЯЯ ИСТОРИЯ ДИАЛОГА:

${conversationContext}

ИНФОРМАЦИЯ, ПОЛУЧЕННАЯ ИЗ ИНТЕРНЕТА:

${webContext || "Интернет-поиск для этого сообщения не выполнялся."}
`;

        /*
        ==========================================
        6. ОТПРАВЛЯЕМ ЗАПРОС В AI
        ==========================================
        */

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

        const aiResponse = await env.AI.run(
          MODEL,
          {
            messages
          }
        );

        let answer =
          aiResponse?.choices?.[0]?.message?.content ||
          "Не удалось получить ответ.";

        answer = cleanAssistantText(answer);

        /*
        ==========================================
        7. СОХРАНЯЕМ ДИАЛОГ
        ==========================================
        */

        await env.DB.prepare(`
          INSERT INTO memory (user_id, role, content)
          VALUES (?, ?, ?)
        `)
          .bind(USER_ID, "user", userMessage)
          .run();

        await env.DB.prepare(`
          INSERT INTO memory (user_id, role, content)
          VALUES (?, ?, ?)
        `)
          .bind(USER_ID, "assistant", answer)
          .run();

        /*
        ==========================================
        8. ВОЗВРАЩАЕМ ОТВЕТ
        ==========================================
        */

        return json({
          answer,
          webSearch: searchDecision.search,
          sources: webResults.map(item => ({
            title: item.title,
            url: item.url
          }))
        });

      } catch (error) {
        console.error(error);

        return json({
          error: "Произошла ошибка при обработке запроса.",
          details: error?.message || String(error)
        }, 500);
      }
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};


/*
==================================================
WEB SEARCH
==================================================
*/

async function searchWeb(query, env) {
  if (!env.BRAVE_API_KEY) {
    return [];
  }

  const url = new URL(
    "https://api.search.brave.com/res/v1/web/search"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("search_lang", "ru");
  url.searchParams.set("ui_lang", "ru-RU");
  url.searchParams.set("country", "DE");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": env.BRAVE_API_KEY
      }
    });

    if (!response.ok) {
      console.error(
        "Brave Search error:",
        response.status
      );

      return [];
    }

    const data = await response.json();

    const results =
      data?.web?.results ||
      [];

    return results
      .slice(0, 8)
      .map(item => ({
        title: item.title || "",
        description: item.description || "",
        url: item.url || "",
        age: item.age || "",
        published: item.published || ""
      }))
      .filter(item => item.url);

  } catch (error) {
    console.error(
      "Web search failed:",
      error
    );

    return [];
  }
}


/*
==================================================
ОПРЕДЕЛЕНИЕ НЕОБХОДИМОСТИ ПОИСКА
==================================================
*/

function shouldSearchWeb(message) {
  const text = message.toLowerCase().trim();

  /*
  Явный запрос на интернет
  */

  const explicitPatterns = [
    "найди в интернете",
    "поищи в интернете",
    "поищи в сети",
    "найди информацию",
    "найди информацию о",
    "посмотри в интернете",
    "проверь в интернете",
    "проверь информацию",
    "найди последние",
    "последние новости",
    "что нового",
    "актуальная информация",
    "актуальные данные",
    "свежие новости",
    "свежая информация",
    "найди новости",
    "погугли",
    "поищи"
  ];

  if (
    explicitPatterns.some(pattern =>
      text.includes(pattern)
    )
  ) {
    return {
      search: true,
      query: cleanSearchQuery(message)
    };
  }

  /*
  Текущие события
  */

  const currentPatterns = [
    "сегодня",
    "сейчас",
    "на данный момент",
    "в данный момент",
    "на сегодня",
    "на завтра",
    "вчера",
    "последний",
    "последняя",
    "последние",
    "новости",
    "текущая",
    "текущий",
    "актуальный",
    "актуальная",
    "актуальные",
    "сколько стоит",
    "цена сейчас",
    "курс",
    "котировки"
  ];

  if (
    currentPatterns.some(pattern =>
      text.includes(pattern)
    )
  ) {
    return {
      search: true,
      query: cleanSearchQuery(message)
    };
  }

  /*
  Имена людей + текущая информация
  */

  const dynamicPatterns = [
    "кто сейчас",
    "где сейчас",
    "чем сейчас занимается",
    "что сейчас происходит",
    "что произошло",
    "что случилось",
    "последний фильм",
    "новый фильм",
    "новый альбом",
    "новая модель",
    "новая версия"
  ];

  if (
    dynamicPatterns.some(pattern =>
      text.includes(pattern)
    )
  ) {
    return {
      search: true,
      query: cleanSearchQuery(message)
    };
  }

  /*
  Во всех остальных случаях
  считаем, что интернет не нужен.
  */

  return {
    search: false,
    query: ""
  };
}


/*
==================================================
ОЧИСТКА ПОИСКОВОГО ЗАПРОСА
==================================================
*/

function cleanSearchQuery(message) {
  let query = String(message || "").trim();

  query = query
    .replace(/^джарвис[,\s]*/i, "")
    .replace(/^джарвис[,\s]+/i, "")
    .trim();

  return query.slice(0, 600);
}


/*
==================================================
ФОРМИРОВАНИЕ КОНТЕКСТА ИЗ ПОИСКА
==================================================
*/

function buildWebContext(results) {
  if (!results.length) {
    return "Поиск в интернете не вернул результатов.";
  }

  return results
    .map((item, index) => {
      return `
Источник ${index + 1}

Название:
${item.title}

Описание:
${item.description}

Дата:
${item.published || item.age || "не указана"}

URL:
${item.url}
`;
    })
    .join("\n----------------------\n");
}


/*
==================================================
ПРЕОБРАЗОВАНИЕ ФАКТОВ В ЕСТЕСТВЕННЫЙ ЯЗЫК
==================================================
*/

function factToNaturalSentence(text) {
  let result = String(text || "").trim();

  result = result.replace(
    /^что\s+я\s+/i,
    ""
  );

  result = result.replace(
    /^я\s+/i,
    ""
  );

  result = result.replace(
    /[.]+$/,
    ""
  );

  if (!result) {
    return "";
  }

  if (
    /^(ты|тебе|твой|твоя|твои|твое|твоё)\b/i.test(result)
  ) {
    return capitalizeFirst(result);
  }

  if (/^люблю\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (/^нравится\s+/i.test(result)) {
    return capitalizeFirst(
      "Тебе " + result
    );
  }

  if (/^предпочитаю\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (/^учусь\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (/^работаю\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (/^занимаюсь\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  if (/^пользуюсь\s+/i.test(result)) {
    return capitalizeFirst(
      "Ты " + result
    );
  }

  return capitalizeFirst(result);
}


/*
==================================================
НОРМАЛИЗАЦИЯ ТЕКСТА
==================================================
*/

function cleanAssistantText(text) {
  let result = String(text || "");

  result = result.replace(
    /\*\*(.*?)\*\*/g,
    "$1"
  );

  result = result.replace(
    /(?<!\w)\*(?!\w)/g,
    ""
  );

  result = result.replace(
    /\n{3,}/g,
    "\n\n"
  );

  result = result.replace(
    /\s+([,.!?;:])/g,
    "$1"
  );

  return result.trim();
}


function capitalizeFirst(text) {
  const value =
    String(text || "").trim();

  if (!value) {
    return value;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}


/*
==================================================
JSON RESPONSE
==================================================
*/

function json(data, status = 200) {
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


/*
==================================================
WEB INTERFACE
==================================================
*/

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
  padding: 24px 16px;
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
  padding: 14px 16px;
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
  background: rgba(255,255,255,.07);
}

.input-area {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: rgba(3,5,8,.92);
  backdrop-filter: blur(18px);
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
  padding: 0 20px;
  font-size: 16px;
  background: #30435e;
  color: white;
}

button:active {
  transform: scale(.97);
}

.sources {
  margin-top: 10px;
  font-size: 12px;
  opacity: .7;
}

.sources a {
  color: #9dbbe8;
  display: block;
  margin-top: 4px;
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
  document.getElementById("message");

const chat =
  document.getElementById("chat");


function addMessage(
  text,
  type,
  sources = []
) {

  const message =
    document.createElement("div");

  message.className =
    "message " + type;

  message.textContent =
    text;

  if (
    type === "assistant" &&
    sources.length
  ) {

    const sourceBlock =
      document.createElement("div");

    sourceBlock.className =
      "sources";

    sourceBlock.textContent =
      "Источники:";

    sources.forEach(source => {

      const link =
        document.createElement("a");

      link.href =
        source.url;

      link.target =
        "_blank";

      link.rel =
        "noopener noreferrer";

      link.textContent =
        source.title ||
        source.url;

      sourceBlock.appendChild(link);

    });

    message.appendChild(
      sourceBlock
    );
  }

  chat.appendChild(message);

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: "smooth"
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
    document.createElement("div");

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

          body: JSON.stringify({
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
