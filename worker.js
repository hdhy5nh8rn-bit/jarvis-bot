export default {
  async fetch(request, env) {
    try {
      // Главная страница J.A.R.V.I.S.
      if (request.method === "GET") {
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
      min-height: 100vh;
      background: #05070a;
      color: #ffffff;
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .container {
      width: 90%;
      max-width: 600px;
      text-align: center;
    }

    h1 {
      font-size: 42px;
      margin-bottom: 10px;
      letter-spacing: 4px;
    }

    .status {
      margin-bottom: 30px;
      opacity: 0.7;
    }

    .chat {
      min-height: 250px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #333;
      border-radius: 15px;
      text-align: left;
      overflow-y: auto;
    }

    .user {
      margin-bottom: 15px;
    }

    .jarvis {
      margin-bottom: 20px;
      opacity: 0.9;
    }

    input {
      width: 70%;
      padding: 15px;
      border-radius: 10px;
      border: 1px solid #444;
      background: #11151a;
      color: white;
      font-size: 16px;
    }

    button {
      padding: 15px 20px;
      margin-left: 5px;
      border: none;
      border-radius: 10px;
      background: #ffffff;
      color: #000000;
      font-weight: bold;
    }

    button:active {
      transform: scale(0.97);
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
    <div class="jarvis">
      <strong>J.A.R.V.I.S.:</strong><br>
      Разумеется. Система готова к работе.
    </div>
  </div>

  <div>
    <input
      id="message"
      type="text"
      placeholder="Введите сообщение..."
      autocomplete="off"
    >

    <button onclick="sendMessage()">
      ОТПРАВИТЬ
    </button>
  </div>

</div>

<script>
async function sendMessage() {

  const input = document.getElementById("message");
  const chat = document.getElementById("chat");

  const message = input.value.trim();

  if (!message) return;

  chat.innerHTML +=
    '<div class="user">' +
    '<strong>Вы:</strong><br>' +
    escapeHtml(message) +
    '</div>';

  input.value = "";

  chat.innerHTML +=
    '<div id="loading" class="jarvis">' +
    '<strong>J.A.R.V.I.S.:</strong><br>' +
    'Обрабатываю запрос...' +
    '</div>';

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

    document.getElementById("loading").remove();

    const answer =
      data.response ||
      data.error ||
      "Не удалось получить ответ.";

    chat.innerHTML +=
      '<div class="jarvis">' +
      '<strong>J.A.R.V.I.S.:</strong><br>' +
      escapeHtml(answer) +
      '</div>';

    chat.scrollTop = chat.scrollHeight;

  } catch (error) {

    document.getElementById("loading").remove();

    chat.innerHTML +=
      '<div class="jarvis">' +
      '<strong>J.A.R.V.I.S.:</strong><br>' +
      'Произошла ошибка соединения.' +
      '</div>';
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document
  .getElementById("message")
  .addEventListener("keydown", function(event) {

    if (event.key === "Enter") {
      sendMessage();
    }

  });
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
      if (request.method === "POST") {

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
                  "Помогай пользователю думать, учиться, планировать, принимать решения " +
                  "и выполнять задачи. " +
                  "Не выдавай себя за человека."
              },
              {
                role: "user",
                content: userMessage
              }
            ]
          }
        );

        return new Response(
          JSON.stringify({
            success: true,
            assistant: "J.A.R.V.I.S.",
            response: result.response ?? result
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            }
          }
        );
      }

      return new Response("Method Not Allowed", {
        status: 405
      });

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
