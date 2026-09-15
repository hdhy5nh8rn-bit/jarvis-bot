export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const userId = "egor";

      // ============================================================
      // WEB INTERFACE
      // ============================================================

      if (request.method === "GET" && url.pathname === "/") {

        const html = `
<!DOCTYPE html>
<html lang="ru">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>J.A.R.V.I.S.</title>

<style>

body {
  margin: 0;
  background: #05070a;
  color: white;
  font-family: Arial, sans-serif;
}

.container {
  max-width: 700px;
  margin: auto;
  padding: 30px 20px;
}

h1 {
  text-align: center;
  letter-spacing: 5px;
  font-size: 36px;
}

.status {
  text-align: center;
  color: #7cff9e;
  margin-bottom: 25px;
}

.chat {
  min-height: 400px;
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid #333;
  border-radius: 15px;
  padding: 20px;
  background: #0b0f14;
}

.message {
  margin-bottom: 20px;
  line-height: 1.5;
}

.user {
  color: #8ab4ff;
}

.jarvis {
  color: white;
}

.input-area {
  display: flex;
  margin-top: 15px;
  gap: 8px;
}

input {
  flex: 1;
  padding: 15px;
  border-radius: 10px;
  border: 1px solid #444;
  background: #11161c;
  color: white;
  font-size: 16px;
}

button {
  padding: 15px 20px;
  border: none;
  border-radius: 10px;
  background: white;
  color: black;
  font-weight: bold;
}

button:disabled {
  opacity: .5;
}

</style>

</head>

<body>

<div class="container">

<h1>J.A.R.V.I.S.</h1>

<div class="status">
● Система активна
</div>

<div id="chat" class="chat">

<div class="message jarvis">

<strong>J.A.R.V.I.S.</strong><br>

Добрый день. Система готова к работе.

</div>

</div>

<div class="input-area">

<input
  id="message"
  type="text"
  placeholder="Введите сообщение..."
  autocomplete="off"
>

<button id="send">
Отправить
</button>

</div>

</div>

<script>

const input =
  document.getElementById("message");

const button =
  document.getElementById("send");

const chat =
  document.getElementById("chat");


function addMessage(author, text, className) {

  const div =
    document.createElement("div");

  div.className =
    "message " + className;

  const strong =
    document.createElement("strong");

  strong.textContent =
    author;

  const br =
    document.createElement("br");

  const content =
    document.createTextNode(text);

  div.appendChild(strong);

  div.appendChild(br);

  div.appendChild(content);

  chat.appendChild(div);

  chat.scrollTop =
    chat.scrollHeight;
}


async function sendMessage() {

  const message =
    input.value.trim();

  if (!message) return;

  input.value = "";

  addMessage(
    "Вы",
    message,
    "user"
  );

  button.disabled = true;

  input.disabled = true;

  const loading =
    document.createElement("div");

  loading.className =
    "message jarvis";

  loading.innerHTML =
    "<strong>J.A.R.V.I.S.</strong><br>" +
    "Обрабатываю запрос...";

  chat.appendChild(loading);

  chat.scrollTop =
    chat.scrollHeight;

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
            message: message
          })
        }
      );

    const data =
      await response.json();

    loading.remove();

    if (
      !response.ok ||
      data.success === false
    ) {

      addMessage(
        "J.A.R.V.I.S.",
        "Ошибка: " +
          (
            data.error ||
            "Неизвестная ошибка"
          ),
        "jarvis"
      );

    } else {

      addMessage(
        "J.A.R.V.I.S.",
        data.response,
        "jarvis"
      );

    }

  } catch (error) {

    loading.remove();

    addMessage(
      "J.A.R.V.I.S.",
      "Ошибка соединения: " +
        error.message,
      "jarvis"
    );

  }

  button.disabled = false;

  input.disabled = false;

  input.focus();

}


button.addEventListener(
  "click",
  sendMessage
);


input.addEventListener(
  "keydown",
  function(event) {

    if (event.key === "Enter") {
      sendMessage();
    }

  }
);

</script>

</body>

</html>
`;

        return new Response(
          html,
          {
            status: 200,

            headers: {
              "Content-Type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }


      // ============================================================
      // CHAT ENGINE
      // ============================================================

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {

        const body =
          await request.json();

        const userMessage =
          typeof body.message === "string"
            ? body.message.trim()
            : "";

        if (!userMessage) {

          return new Response(
            JSON.stringify({
              success: false,
              error:
                "Сообщение не должно быть пустым."
            }),
            {
              status: 400,

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              }
            }
          );

        }


        // ==========================================================
        // NORMALIZED USER MESSAGE
        // ==========================================================

        const lowerMessage =
          userMessage.toLowerCase();


        // ==========================================================
        // LOAD LONG-TERM MEMORY
        // ==========================================================

        const factsResult =
          await env.DB.prepare(`
            SELECT id, category, fact
            FROM facts
            WHERE user_id = ?
            ORDER BY id ASC
          `)
          .bind(userId)
          .all();

        const facts =
          factsResult.results || [];


        // ==========================================================
        // DETECT MEMORY ACTION
        // ==========================================================

        let action = "chat";


        if (
          lowerMessage.includes("запомни") ||
          lowerMessage.includes("сохрани") ||
          lowerMessage.includes("учти на будущее") ||
          lowerMessage.includes("запиши в память")
        ) {

          action = "save";

        }


        if (
          lowerMessage.includes("забудь") ||
          lowerMessage.includes("удали из памяти") ||
          lowerMessage.includes("не запоминай")
        ) {

          action = "forget";

        }


        if (
          lowerMessage.includes(
            "удали все данные о моих предпочтениях"
          ) ||
          lowerMessage.includes(
            "удали все мои предпочтения"
          ) ||
          lowerMessage.includes(
            "забудь все мои предпочтения"
          )
        ) {

          action = "clear_preferences";

        }


        if (
          lowerMessage.includes(
            "что ты обо мне знаешь"
          ) ||
          lowerMessage.includes(
            "что ты знаешь обо мне"
          ) ||
          lowerMessage.includes(
            "покажи мою память"
          ) ||
          lowerMessage.includes(
            "что ты запомнил"
          )
        ) {

          action = "recall";

        }


        // ==========================================================
        // SAVE
        // ==========================================================

        if (action === "save") {

          let fact =
            userMessage
              .replace(
                /^.*?(запомни|сохрани|учти на будущее|запиши в память)\s*/i,
                ""
              )
              .trim();


          if (!fact) {

            return new Response(
              JSON.stringify({
                success: true,
                assistant: "J.A.R.V.I.S.",
                response:
                  "Уточните, какую именно информацию мне следует сохранить."
              }),
              {
                status: 200,

                headers: {
                  "Content-Type":
                    "application/json; charset=UTF-8"
                }
              }
            );

          }


          // ----------------------------------------------
          // DETERMINE CATEGORY
          // ----------------------------------------------

          let category = "general";


          if (
            lowerMessage.includes("люблю") ||
            lowerMessage.includes("нравится") ||
            lowerMessage.includes("предпочитаю") ||
            lowerMessage.includes("любимый")
          ) {

            category = "preference";

          }


          if (
            lowerMessage.includes("учусь") ||
            lowerMessage.includes("университет") ||
            lowerMessage.includes("учёб") ||
            lowerMessage.includes("учеб")
          ) {

            category = "study";

          }


          if (
            lowerMessage.includes("работаю") ||
            lowerMessage.includes("работа")
          ) {

            category = "work";

          }


          if (
            lowerMessage.includes("проект")
          ) {

            category = "project";

          }


          // ----------------------------------------------
          // CHECK DUPLICATES
          // ----------------------------------------------

          const existingFacts =
            await env.DB.prepare(`
              SELECT id, fact
              FROM facts
              WHERE user_id = ?
              AND category = ?
            `)
            .bind(
              userId,
              category
            )
            .all();


          const existing =
            existingFacts.results || [];


          const normalizedFact =
            fact.toLowerCase();


          let duplicate = false;


          for (const item of existing) {

            if (
              String(item.fact)
                .toLowerCase() ===
              normalizedFact
            ) {

              duplicate = true;

              break;

            }

          }


          if (!duplicate) {

            await env.DB.prepare(`
              INSERT INTO facts
              (user_id, category, fact)
              VALUES (?, ?, ?)
            `)
            .bind(
              userId,
              category,
              fact
            )
            .run();

          }


          // ----------------------------------------------
          // CONFIRM ONLY AFTER DATABASE OPERATION
          // ----------------------------------------------

          return new Response(
            JSON.stringify({
              success: true,
              assistant: "J.A.R.V.I.S.",
              response: duplicate
                ? "Эта информация уже находится в моей долговременной памяти."
                : "Принято. Информация успешно сохранена в моей долговременной памяти."
            }),
            {
              status: 200,

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              }
            }
          );

        }


        // ==========================================================
        // CLEAR ALL PREFERENCES
        // ==========================================================

        if (
          action === "clear_preferences"
        ) {

          await env.DB.prepare(`
            DELETE FROM facts
            WHERE user_id = ?
            AND category = 'preference'
          `)
          .bind(userId)
          .run();


          return new Response(
            JSON.stringify({
              success: true,
              assistant: "J.A.R.V.I.S.",
              response:
                "Готово. Все сохранённые данные из категории «предпочтения» удалены из долговременной памяти."
            }),
            {
              status: 200,

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              }
            }
          );

        }


        // ==========================================================
        // FORGET SPECIFIC FACT
        // ==========================================================

        if (action === "forget") {

          let searchText =
            userMessage
              .replace(
                /^.*?(забудь|удали из памяти|не запоминай)\s*/i,
                ""
              )
              .trim();


          if (!searchText) {

            return new Response(
              JSON.stringify({
                success: true,
                assistant: "J.A.R.V.I.S.",
                response:
                  "Уточните, какую информацию мне следует забыть."
              }),
              {
                status: 200,

                headers: {
                  "Content-Type":
                    "application/json; charset=UTF-8"
                }
              }
            );

          }


          const allFactsResult =
            await env.DB.prepare(`
              SELECT id, category, fact
              FROM facts
              WHERE user_id = ?
              ORDER BY id ASC
            `)
            .bind(userId)
            .all();


          const allFacts =
            allFactsResult.results || [];


          const normalizedSearch =
            searchText.toLowerCase();


          let deleted = 0;


          for (const item of allFacts) {

            const normalizedFact =
              String(item.fact)
                .toLowerCase();


            if (
              normalizedFact.includes(
                normalizedSearch
              ) ||
              normalizedSearch.includes(
                normalizedFact
              )
            ) {

              await env.DB.prepare(`
                DELETE FROM facts
                WHERE id = ?
                AND user_id = ?
              `)
              .bind(
                item.id,
                userId
              )
              .run();


              deleted++;

            }

          }


          if (deleted > 0) {

            return new Response(
              JSON.stringify({
                success: true,
                assistant: "J.A.R.V.I.S.",
                response:
                  "Готово. Указанная информация удалена из моей долговременной памяти."
              }),
              {
                status: 200,

                headers: {
                  "Content-Type":
                    "application/json; charset=UTF-8"
                }
              }
            );

          }


          return new Response(
            JSON.stringify({
              success: true,
              assistant: "J.A.R.V.I.S.",
              response:
                "Я не нашёл в долговременной памяти факта, соответствующего вашему запросу."
            }),
            {
              status: 200,

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              }
            }
          );

        }


        // ==========================================================
        // RECALL MEMORY
        // ==========================================================

        if (action === "recall") {

          const currentFactsResult =
            await env.DB.prepare(`
              SELECT category, fact
              FROM facts
              WHERE user_id = ?
              ORDER BY id ASC
            `)
            .bind(userId)
            .all();


          const currentFacts =
            currentFactsResult.results || [];


          if (currentFacts.length === 0) {

            return new Response(
              JSON.stringify({
                success: true,
                assistant: "J.A.R.V.I.S.",
                response:
                  "В моей долговременной памяти пока нет сохранённых сведений о вас."
              }),
              {
                status: 200,

                headers: {
                  "Content-Type":
                    "application/json; charset=UTF-8"
                }
              }
            );

          }


          const categoryNames = {
            preference: "Предпочтения",
            study: "Учёба",
            work: "Работа",
            project: "Проекты",
            general: "Общее"
          };


          const grouped = {};


          for (const item of currentFacts) {

            const category =
              categoryNames[item.category] ||
              item.category;


            if (!grouped[category]) {
              grouped[category] = [];
            }


            grouped[category].push(
              item.fact
            );

          }


          let response =
            "В моей долговременной памяти сейчас сохранено:\n\n";


          for (
            const category in grouped
          ) {

            response +=
              category + ":\n";

            for (
              const fact of grouped[category]
            ) {

              response +=
                "• " + fact + "\n";

            }

            response += "\n";

          }


          return new Response(
            JSON.stringify({
              success: true,
              assistant: "J.A.R.V.I.S.",
              response: response.trim()
            }),
            {
              status: 200,

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              }
            }
          );

        }


        // ==========================================================
        // NORMAL CHAT
        // ==========================================================

        const memoryResult =
          await env.DB.prepare(`
            SELECT role, content
            FROM memory
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 20
          `)
          .bind(userId)
          .all();


        const previousMessages =
          (memoryResult.results || [])
            .reverse()
            .map(row => ({
              role: row.role,
              content: row.content
            }));


        let factsText = "";


        if (facts.length > 0) {

          factsText =
            "\n\nДОЛГОВРЕМЕННАЯ ПАМЯТЬ:\n" +

            facts
              .map(
                item =>
                  `- [${item.category}] ${item.fact}`
              )
              .join("\n");

        }


        const systemMessage = {

          role: "system",

          content:

            "Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент пользователя. " +

            "Отвечай на русском языке. " +

            "Будь спокойным, уверенным, умным, внимательным и естественным. " +

            "Помогай пользователю думать, учиться, планировать, принимать решения и выполнять задачи. " +

            "Используй долговременную память только как источник фактов о пользователе. " +

            "Не придумывай сведения о пользователе. " +

            "Не утверждай, что что-либо сохранено или удалено, если соответствующая операция не была выполнена системой. " +

            factsText

        };


        const messages = [

          systemMessage,

          ...previousMessages,

          {
            role: "user",
            content: userMessage
          }

        ];


        const result =
          await env.AI.run(
            "@cf/zai-org/glm-4.7-flash",
            {
              messages
            }
          );


        const answer =
          result?.choices?.[0]?.message?.content ||
          "Не удалось получить текст ответа от модели.";


        // ==========================================================
        // SAVE CHAT HISTORY
        // ==========================================================

        await env.DB.prepare(`
          INSERT INTO memory
          (user_id, role, content)
          VALUES (?, ?, ?)
        `)
        .bind(
          userId,
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
          userId,
          "assistant",
          answer
        )
        .run();


        return new Response(
          JSON.stringify({
            success: true,
            assistant: "J.A.R.V.I.S.",
            response: answer
          }),
          {
            status: 200,

            headers: {
              "Content-Type":
                "application/json; charset=UTF-8"
            }
          }
        );

      }


      // ============================================================
      // AI DIAGNOSTIC
      // ============================================================

      if (
        request.method === "GET" &&
        url.pathname === "/test-ai"
      ) {

        const result =
          await env.AI.run(
            "@cf/zai-org/glm-4.7-flash",
            {
              messages: [
                {
                  role: "system",
                  content:
                    "Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент. Отвечай на русском языке."
                },
                {
                  role: "user",
                  content:
                    "Джарвис, представься одним предложением."
                }
              ]
            }
          );


        return new Response(
          JSON.stringify(
            {
              success: true,
              ai_response: result
            },
            null,
            2
          ),
          {
            status: 200,

            headers: {
              "Content-Type":
                "application/json; charset=UTF-8"
            }
          }
        );

      }


      return new Response(
        "Not Found",
        {
          status: 404
        }
      );


    } catch (error) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            error?.message ||
            "Неизвестная ошибка сервера."
        }),
        {
          status: 500,

          headers: {
            "Content-Type":
              "application/json; charset=UTF-8"
          }
        }
      );

    }

  }
};
