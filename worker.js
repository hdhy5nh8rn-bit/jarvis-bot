export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // Веб-интерфейс
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
  color: #ffffff;
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
  opacity: 0.5;
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
Разумеется. Система готова к работе.
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

  addMessage(
    "Вы",
    message,
    "user"
  );

  button.disabled = true;
  input.disabled = true;

  const loading = document.createElement("div");

  loading.className = "message jarvis";
  loading.id = "loading";

  loading.innerHTML =
    "<strong>J.A.R.V.I.S.</strong><br>Обрабатываю запрос...";

  chat.appendChild(loading);

  chat.scrollTop = chat.scrollHeight;

  try {

    const response = await fetch("/", {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        message: message
      })

    });

    const data = await response.json();

    loading.remove();

    if (!response.ok || data.success === false) {

      addMessage(
        "J.A.R.V.I.S.",
        "Ошибка: " +
        (data.error || "Неизвестная ошибка"),
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

        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=UTF-8"
          }
        });
      }

      // Запрос к AI
      if (
        request.method === "POST" &&
        url.pathname === "/"
      ) {

        const body = await request.json();

        const userMessage =
          body.message ||
          "Привет, Джарвис.";

        const result = await env.AI.run(
          "@cf/zai-org/glm-4.7-flash",
          {
            messages: [
              {
                role: "system",
                content:
                  "Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент пользователя. " +
                  "Отвечай на русском языке. " +
                  "Будь спокойным, уверенным, умным, вежливым и естественным. " +
                  "Помогай пользователю думать, учиться, планировать, принимать решения и выполнять задачи. " +
                  "Не выдавай себя за человека."
              },
              {
                role: "user",
                content: userMessage
              }
            ]
          }
        );

        const answer =
          result?.choices?.[0]?.message?.content ||
          "Не удалось получить текст ответа от модели.";

        return new Response(
          JSON.stringify({
            success: true,
            assistant: "J.A.R.V.I.S.",
            response: answer
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            }
          }
        );
      }

      return new Response(
        "Not Found",
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=UTF-8"
          }
        }
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
          }
        }
      );
    }
  }
};
