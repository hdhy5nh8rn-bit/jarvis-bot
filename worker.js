export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================
      // WEB INTERFACE
      // =========================
      if (request.method === "GET" && url.pathname === "/") {
        const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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

const input = document.getElementById("message");
const button = document.getElementById("send");
const chat = document.getElementById("chat");

function addMessage(author, text, className) {

  const div = document.createElement("div");
  div.className = "message " + className;

  const strong = document.createElement("strong");
  strong.textContent = author;

  const br = document.createElement("br");

  const content = document.createTextNode(text);

  div.appendChild(strong);
  div.appendChild(br);
  div.appendChild(content);

  chat.appendChild(div);

  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {

  const message = input.value.trim();

  if (!message) return;

  input.value = "";

  addMessage("Вы", message, "user");

  button.disabled = true;
  input.disabled = true;

  const loading = document.createElement("div");

  loading.className = "message jarvis";

  loading.innerHTML =
    "<strong>J.A.R.V.I.S.</strong><br>Обрабатываю запрос...";

  chat.appendChild(loading);

  chat.scrollTop = chat.scrollHeight;

  try {

    const response = await fetch(
      new URL("/chat", window.location.origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message
        })
      }
    );

    const data = await response.json();

    loading.remove();

    if (!response.ok || data.success === false) {

      addMessage(
        "J.A.R.V.I.S.",
        "Ошибка: " + (data.error || "Неизвестная ошибка"),
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
      "Ошибка соединения: " + error.message,
      "jarvis"
    );

  }

  button.disabled = false;
  input.disabled = false;
  input.focus();
}

button.addEventListener("click", sendMessage);

input.addEventListener("keydown", function(event) {

  if (event.key === "Enter") {
    sendMessage();
  }

});

</script>

</body>
</html>
`;

        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=UTF-8"
          }
        });
      }


      // =========================
      // CHAT
      // =========================
      if (request.method === "POST" && url.pathname === "/chat") {

        const body = await request.json();

        const userMessage =
          typeof body.message === "string"
            ? body.message.trim()
            : "";

        if (!userMessage) {

          return new Response(
            JSON.stringify({
              success: false,
              error: "Сообщение не должно быть пустым."
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


        // =========================
        // USER ID
        // =========================
        const userId = "egor";


        // =========================
        // LOAD LONG-TERM FACTS
        // =========================
        const factsResult = await env.DB.prepare(`
          SELECT category, fact
          FROM facts
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 50
        `)
        .bind(userId)
        .all();


        const facts = factsResult.results || [];


        let factsText = "";

        if (facts.length > 0) {

          factsText =
            "\n\nДОЛГОВРЕМЕННАЯ ПАМЯТЬ ПОЛЬЗОВАТЕЛЯ:\n" +
            facts
              .reverse()
              .map(
                item =>
                  `- [${item.category}] ${item.fact}`
              )
              .join("\n");

        }


        // =========================
        // LOAD RECENT CHAT HISTORY
        // =========================
        const memoryResult = await env.DB.prepare(`
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


        // =========================
        // SYSTEM PROMPT
        // =========================
        const systemMessage = {

          role: "system",

          content:

            "Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент пользователя. " +

            "Отвечай на русском языке. " +

            "Будь спокойным, уверенным, умным, внимательным и естественным. " +

            "Помогай пользователю думать, учиться, планировать, принимать решения и выполнять задачи. " +

            "Учитывай текущий разговор и долговременную память. " +

            "Не выдавай себя за человека. " +

            "Не придумывай факты о пользователе. " +

            "Долговременная память содержит только сведения, которые были явно сохранены пользователем или системой. " +

            "Если пользователь говорит 'запомни', 'сохрани', 'учти на будущее' или аналогичную фразу, определи информацию, которую нужно сохранить. " +

            "Если пользователь просит забыть определённую информацию, эту информацию нужно удалить из долговременной памяти. " +

            "Если пользователь спрашивает, что ты о нём знаешь, перечисли сохранённые факты. " +

            "Не утверждай, что информация сохранена или удалена, если операция действительно не была выполнена." +

            factsText

        };


        // =========================
        // ASK AI
        // =========================
        const messages = [

          systemMessage,

          ...previousMessages,

          {
            role: "user",
            content: userMessage
          }

        ];


        const result = await env.AI.run(
          "@cf/zai-org/glm-4.7-flash",
          {
            messages: messages
          }
        );


        const answer =
          result?.choices?.[0]?.message?.content ||
          "Не удалось получить текст ответа от модели.";


        // =========================
        // MEMORY OF CONVERSATION
        // =========================
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


        // =========================
        // LONG-TERM MEMORY COMMANDS
        // =========================

        const lowerMessage =
          userMessage.toLowerCase();


        // SAVE MEMORY
        if (
          lowerMessage.includes("запомни") ||
          lowerMessage.includes("сохрани") ||
          lowerMessage.includes("учти на будущее")
        ) {

          let fact = userMessage
            .replace(/^.*?(запомни|сохрани|учти на будущее)\s*/i, "")
            .trim();

          if (fact) {

            let category = "general";

            if (
              lowerMessage.includes("люблю") ||
              lowerMessage.includes("нравится") ||
              lowerMessage.includes("предпочитаю")
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

        }


        // =========================
        // FORGET MEMORY
        // =========================
        if (
          lowerMessage.includes("забудь") ||
          lowerMessage.includes("удали из памяти") ||
          lowerMessage.includes("не запоминай")
        ) {

          let searchText = userMessage
            .replace(/^.*?(забудь|удали из памяти|не запоминай)\s*/i, "")
            .trim();


          if (searchText) {

            await env.DB.prepare(`
              DELETE FROM facts
              WHERE user_id = ?
              AND fact LIKE ?
            `)
            .bind(
              userId,
              "%" + searchText + "%"
            )
            .run();

          }

        }


        // =========================
        // SHOW MEMORY
        // =========================
        if (
          lowerMessage.includes("что ты обо мне знаешь") ||
          lowerMessage.includes("покажи мою память") ||
          lowerMessage.includes("что ты запомнил")
        ) {

          const currentFacts =
            await env.DB.prepare(`
              SELECT category, fact
              FROM facts
              WHERE user_id = ?
              ORDER BY id ASC
            `)
            .bind(userId)
            .all();


          const savedFacts =
            currentFacts.results || [];


          if (savedFacts.length === 0) {

            // AI answer is already returned,
            // but there are currently no saved facts.

          }

        }


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


      // =========================
      // TEST AI
      // =========================
      if (
        request.method === "GET" &&
        url.pathname === "/test-ai"
      ) {

        const result = await env.AI.run(
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
