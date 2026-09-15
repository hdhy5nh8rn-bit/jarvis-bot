const VERSION = "v5.3";
const TIME_ZONE = "Europe/Moscow";

const SYSTEM_PROMPT = `
Ты — J.A.R.V.I.S., персональный интеллектуальный ассистент пользователя.

Твоя роль:
- помогать пользователю планировать дела;
- помнить важную информацию;
- управлять задачами;
- помогать с учебой, работой и личными делами;
- отвечать естественно, спокойно и уверенно;
- быть полезным, но не навязчивым.

Общайся на русском языке, если пользователь не попросил другой язык.

Стиль:
- уверенный;
- естественный;
- краткий, когда вопрос простой;
- подробный, когда требуется объяснение;
- без лишних повторов;
- как персональный интеллектуальный ассистент.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

      /* =====================================================
         CHAT INTERFACE
         ===================================================== */

      if (request.method === "GET" && url.pathname === "/") {
        return html(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width,
      initial-scale=1,
      maximum-scale=1,
      viewport-fit=cover">

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
  overflow: hidden;
  background: #05070b;
  color: #f1f5f9;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "SF Pro Display",
    "SF Pro Text",
    Arial,
    sans-serif;
}

/* =====================================================
   APP
   ===================================================== */

.app {
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(
      circle at 50% -10%,
      rgba(34, 120, 255, 0.16),
      transparent 35%
    ),
    #05070b;
}

/* =====================================================
   HEADER
   ===================================================== */

.header {
  flex: 0 0 auto;

  padding:
    calc(env(safe-area-inset-top) + 12px)
    18px
    12px;

  border-bottom: 1px solid rgba(255,255,255,0.07);

  background: rgba(5,7,11,0.82);

  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);

  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 42px;
  height: 42px;

  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 19px;
  font-weight: 700;

  color: #ffffff;

  background:
    radial-gradient(
      circle at 35% 30%,
      #6eb4ff,
      #1677ff 45%,
      #063b9e
    );

  box-shadow:
    0 0 18px rgba(30,130,255,0.55),
    inset 0 0 10px rgba(255,255,255,0.25);
}

.header-info {
  min-width: 0;
  flex: 1;
}

.title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.status {
  margin-top: 2px;

  display: flex;
  align-items: center;
  gap: 6px;

  font-size: 12px;
  color: #8995a7;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #36d477;

  box-shadow: 0 0 8px rgba(54,212,119,0.8);
}

.version {
  font-size: 11px;
  color: #566173;
}

/* =====================================================
   CHAT
   ===================================================== */

.chat {
  flex: 1;

  overflow-y: auto;
  overflow-x: hidden;

  padding: 18px 14px 20px;

  scroll-behavior: smooth;

  overscroll-behavior: contain;
}

.chat-inner {
  max-width: 760px;
  margin: 0 auto;

  display: flex;
  flex-direction: column;

  gap: 12px;
}

/* =====================================================
   WELCOME
   ===================================================== */

.welcome {
  text-align: center;

  padding:
    35px
    20px
    25px;

  color: #8490a2;
}

.welcome-logo {
  width: 72px;
  height: 72px;

  margin: 0 auto 15px;

  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 27px;
  font-weight: 700;

  color: white;

  background:
    radial-gradient(
      circle at 35% 30%,
      #6eb4ff,
      #1677ff 45%,
      #063b9e
    );

  box-shadow:
    0 0 35px rgba(25,120,255,0.35),
    inset 0 0 15px rgba(255,255,255,0.18);
}

.welcome-title {
  color: #eef4ff;
  font-size: 22px;
  font-weight: 700;
}

.welcome-text {
  margin-top: 7px;
  font-size: 14px;
  line-height: 1.5;
}

/* =====================================================
   MESSAGES
   ===================================================== */

.message-row {
  display: flex;
  width: 100%;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message {
  max-width: min(82%, 620px);

  padding: 11px 14px;

  border-radius: 18px;

  font-size: 16px;
  line-height: 1.45;

  white-space: pre-wrap;
  word-wrap: break-word;

  animation: messageIn 0.18s ease-out;
}

@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.user {
  background:
    linear-gradient(
      135deg,
      #187cff,
      #075bd4
    );

  color: white;

  border-bottom-right-radius: 5px;

  box-shadow:
    0 4px 15px rgba(0,80,210,0.18);
}

.message.assistant {
  background: #151a23;

  color: #e9edf5;

  border: 1px solid rgba(255,255,255,0.06);

  border-bottom-left-radius: 5px;
}

.message-time {
  font-size: 10px;
  opacity: 0.45;

  margin-top: 5px;

  text-align: right;
}

/* =====================================================
   TYPING
   ===================================================== */

.typing {
  display: flex;
  align-items: center;
  gap: 5px;

  padding: 13px 15px;

  width: fit-content;

  background: #151a23;

  border: 1px solid rgba(255,255,255,0.06);

  border-radius: 18px;
  border-bottom-left-radius: 5px;
}

.typing span {
  width: 6px;
  height: 6px;

  border-radius: 50%;

  background: #7c8798;

  animation: typing 1.2s infinite ease-in-out;
}

.typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.45;
  }

  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* =====================================================
   INPUT AREA
   ===================================================== */

.input-area {
  flex: 0 0 auto;

  padding:
    8px
    12px
    calc(env(safe-area-inset-bottom) + 10px);

  background: rgba(5,7,11,0.9);

  border-top: 1px solid rgba(255,255,255,0.07);

  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.input-wrapper {
  max-width: 760px;
  margin: 0 auto;

  display: flex;
  align-items: flex-end;

  gap: 8px;

  background: #111620;

  border: 1px solid #252d3a;

  border-radius: 24px;

  padding: 6px 6px 6px 15px;

  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.input-wrapper:focus-within {
  border-color: rgba(30,130,255,0.65);

  box-shadow:
    0 0 0 3px rgba(30,130,255,0.08);
}

textarea {
  flex: 1;

  width: 100%;

  resize: none;

  border: 0;
  outline: 0;

  background: transparent;

  color: #f4f7fb;

  font-family: inherit;

  font-size: 16px;

  line-height: 1.4;

  padding: 7px 0;

  max-height: 120px;
}

textarea::placeholder {
  color: #657184;
}

.send-button {
  flex: 0 0 auto;

  width: 43px;
  height: 43px;

  border: 0;

  border-radius: 50%;

  background:
    linear-gradient(
      145deg,
      #3294ff,
      #0766e6
    );

  color: white;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 19px;

  cursor: pointer;

  box-shadow:
    0 3px 12px rgba(0,100,230,0.3);

  transition:
    transform 0.1s,
    opacity 0.2s;
}

.send-button:active {
  transform: scale(0.91);
}

.send-button:disabled {
  opacity: 0.4;
}

/* =====================================================
   DESKTOP
   ===================================================== */

@media (min-width: 800px) {

  .chat {
    padding-left: 30px;
    padding-right: 30px;
  }

  .message {
    font-size: 15px;
  }

}

</style>
</head>

<body>

<div class="app">

  <!-- HEADER -->

  <header class="header">

    <div class="avatar">
      J
    </div>

    <div class="header-info">

      <div class="title">
        J.A.R.V.I.S.
      </div>

      <div class="status">
        <span class="status-dot"></span>
        В сети
      </div>

    </div>

    <div class="version">
      ${VERSION}
    </div>

  </header>


  <!-- CHAT -->

  <main class="chat" id="chat">

    <div class="chat-inner" id="chatInner">

      <div class="welcome" id="welcome">

        <div class="welcome-logo">
          J
        </div>

        <div class="welcome-title">
          Добрый день.
        </div>

        <div class="welcome-text">
          J.A.R.V.I.S. готов к работе.<br>
          Чем могу помочь?
        </div>

      </div>

    </div>

  </main>


  <!-- INPUT -->

  <div class="input-area">

    <div class="input-wrapper">

      <textarea
        id="messageInput"
        rows="1"
        placeholder="Сообщение J.A.R.V.I.S..."
        autocomplete="off"
        autocorrect="on"
        spellcheck="true"
      ></textarea>

      <button
        class="send-button"
        id="sendButton"
        onclick="sendMessage()"
        aria-label="Отправить"
      >
        ↑
      </button>

    </div>

  </div>

</div>


<script>

const USER_ID = "egor";

const chat = document.getElementById("chat");
const chatInner = document.getElementById("chatInner");
const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

let typingElement = null;


/* =====================================================
   LOCAL HISTORY
   ===================================================== */

function loadHistory() {

  try {

    const saved =
      localStorage.getItem("jarvis_chat");

    if (!saved) {
      return;
    }

    const history =
      JSON.parse(saved);

    if (!Array.isArray(history)) {
      return;
    }

    const welcome =
      document.getElementById("welcome");

    if (welcome) {
      welcome.remove();
    }

    for (const item of history) {

      addMessage(
        item.text,
        item.role,
        item.time,
        false
      );

    }

  } catch (error) {

    console.log(
      "History error:",
      error
    );

  }

}


/* =====================================================
   SAVE HISTORY
   ===================================================== */

function saveMessage(
  text,
  role,
  time
) {

  try {

    const saved =
      localStorage.getItem("jarvis_chat");

    const history =
      saved ? JSON.parse(saved) : [];

    history.push({
      text,
      role,
      time
    });

    /*
     * Храним последние 100 сообщений.
     */

    const limited =
      history.slice(-100);

    localStorage.setItem(
      "jarvis_chat",
      JSON.stringify(limited)
    );

  } catch (error) {

    console.log(
      "Save error:",
      error
    );

  }

}


/* =====================================================
   ADD MESSAGE
   ===================================================== */

function addMessage(
  text,
  role,
  time = null,
  save = true
) {

  const welcome =
    document.getElementById("welcome");

  if (welcome) {
    welcome.remove();
  }

  const row =
    document.createElement("div");

  row.className =
    "message-row " + role;

  const bubble =
    document.createElement("div");

  bubble.className =
    "message " + role;

  bubble.textContent =
    text;

  if (time) {

    const timeElement =
      document.createElement("div");

    timeElement.className =
      "message-time";

    timeElement.textContent =
      time;

    bubble.appendChild(
      timeElement
    );

  }

  row.appendChild(bubble);

  chatInner.appendChild(row);

  scrollToBottom();

  if (save) {

    saveMessage(
      text,
      role,
      time
    );

  }

}


/* =====================================================
   TIME
   ===================================================== */

function currentTime() {

  return new Date()
    .toLocaleTimeString(
      "ru-RU",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

}


/* =====================================================
   TYPING
   ===================================================== */

function showTyping() {

  hideTyping();

  const row =
    document.createElement("div");

  row.className =
    "message-row assistant";

  typingElement =
    document.createElement("div");

  typingElement.className =
    "typing";

  typingElement.innerHTML =
    "<span></span><span></span><span></span>";

  row.appendChild(
    typingElement
  );

  chatInner.appendChild(row);

  scrollToBottom();

}


function hideTyping() {

  if (
    typingElement &&
    typingElement.parentElement
  ) {

    typingElement.parentElement.remove();

  }

  typingElement = null;

}


/* =====================================================
   SCROLL
   ===================================================== */

function scrollToBottom() {

  requestAnimationFrame(() => {

    chat.scrollTop =
      chat.scrollHeight;

  });

}


/* =====================================================
   SEND
   ===================================================== */

async function sendMessage() {

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  /*
   * Заблокировать кнопку
   */

  sendButton.disabled = true;

  /*
   * Сообщение пользователя
   */

  addMessage(
    text,
    "user",
    currentTime()
  );

  /*
   * Очистить поле
   */

  input.value = "";

  resizeTextarea();

  /*
   * Показать печать JARVIS
   */

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

          body: JSON.stringify({
            user_id: USER_ID,
            message: text
          })
        }
      );

    const data =
      await response.json();

    hideTyping();

    if (
      data &&
      data.ok &&
      data.reply
    ) {

      addMessage(
        data.reply,
        "assistant",
        currentTime()
      );

    } else {

      addMessage(
        data.error ||
        "Не удалось получить ответ от J.A.R.V.I.S.",
        "assistant",
        currentTime()
      );

    }

  } catch (error) {

    hideTyping();

    addMessage(
      "Соединение с J.A.R.V.I.S. потеряно. Проверь подключение к интернету.",
      "assistant",
      currentTime()
    );

    console.error(error);

  }

  sendButton.disabled = false;

  input.focus();

}


/* =====================================================
   TEXTAREA
   ===================================================== */

function resizeTextarea() {

  input.style.height =
    "auto";

  input.style.height =
    Math.min(
      input.scrollHeight,
      120
    ) + "px";

}


input.addEventListener(
  "input",
  resizeTextarea
);


/* =====================================================
   ENTER
   ===================================================== */

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


/* =====================================================
   START
   ===================================================== */

loadHistory();

input.focus();

</script>

</body>
</html>`);
      }


      /* =====================================================
         PING
         ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/ping"
      ) {

        return json({
          ok: true,
          version: VERSION,
          timezone: TIME_ZONE,
          service: "J.A.R.V.I.S."
        });

      }


      /* =====================================================
         HEALTH
         ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/health"
      ) {

        return json({
          ok: true,
          status: "healthy",
          version: VERSION,
          timezone: TIME_ZONE
        });

      }


      /* =====================================================
         TASKS
         ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/tasks"
      ) {

        const userId =
          url.searchParams.get("user_id") ||
          "egor";

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
              task_date,
              task_time,
              id
          `)
          .bind(userId)
          .all();

        return json({
          ok: true,
          tasks:
            result.results || []
        });

      }


      /* =====================================================
         CHAT API
         ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {

        const body =
          await request.json();

        const userId =
          body.user_id || "egor";

        const message =
          String(
            body.message || ""
          ).trim();

        if (!message) {

          return json({
            ok: false,
            error: "Пустое сообщение"
          }, 400);

        }


        /* DELETE */

        const deleteResult =
          await tryDeleteTask(
            env,
            userId,
            message
          );

        if (deleteResult) {

          return json({
            ok: true,
            reply:
              deleteResult.reply,
            action:
              deleteResult.action,
            task:
              deleteResult.task || null
          });

        }


        /* COMPLETE */

        const completeResult =
          await tryCompleteTask(
            env,
            userId,
            message
          );

        if (completeResult) {

          return json({
            ok: true,
            reply:
              completeResult.reply,
            action:
              completeResult.action,
            task:
              completeResult.task || null
          });

        }


        /* LIST */

        const listResult =
          await tryListTasks(
            env,
            userId,
            message
          );

        if (listResult) {

          return json({
            ok: true,
            reply:
              listResult.reply,
            action: "list_tasks",
            tasks:
              listResult.tasks
          });

        }


        /* CREATE TASK */

        const parsedTask =
          parseTask(message);

        if (parsedTask) {

          const created =
            await createTask(
              env,
              userId,
              parsedTask
            );

          return json({
            ok: true,
            reply:
              buildTaskReply(created),
            action: "create_task",
            task: created
          });

        }


        /* MEMORY */

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


        /* HISTORY */

        const memoryResult =
          await env.DB.prepare(`
            SELECT
              role,
              content
            FROM memory
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 20
          `)
          .bind(userId)
          .all();


        const messages = [
          {
            role: "system",
            content: SYSTEM_PROMPT
          }
        ];


        const history =
          (memoryResult.results || [])
          .reverse()
          .map(row => ({
            role:
              row.role === "assistant"
                ? "assistant"
                : "user",

            content:
              row.content
          }));


        for (
          const item of history
        ) {

          messages.push(item);

        }


        /* AI */

        const aiResult =
          await env.AI.run(
            "@cf/zai-org/glm-4.7-flash",
            {
              messages
            }
          );


        const reply =
          aiResult?.response ||
          aiResult?.result?.response ||
          "Не удалось получить ответ.";


        /* SAVE AI */

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


        return json({
          ok: true,
          reply,
          action: "chat"
        });

      }


      return json({
        ok: false,
        error: "Not found"
      }, 404);


    } catch (error) {

      return json({
        ok: false,
        error: error.message,
        version: VERSION
      }, 500);

    }

  }
};


/* =========================================================
   DATE
   ========================================================= */

function getLocalDate() {

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    );

  const parts =
    formatter.formatToParts(
      new Date()
    );

  const values = {};

  for (const part of parts) {

    if (part.type !== "literal") {
      values[part.type] =
        part.value;
    }

  }

  return `${values.year}-${values.month}-${values.day}`;
}


function parseDateFromNaturalLanguage(text) {

  const normalized =
    text.toLowerCase();

  const now =
    new Date(
      new Date().toLocaleString(
        "en-US",
        {
          timeZone: TIME_ZONE
        }
      )
    );


  if (
    normalized.includes(
      "послезавтра"
    )
  ) {

    now.setDate(
      now.getDate() + 2
    );

    return formatDate(now);

  }


  if (
    normalized.includes("завтра")
  ) {

    now.setDate(
      now.getDate() + 1
    );

    return formatDate(now);

  }


  if (
    normalized.includes("сегодня") ||
    normalized.includes("сейчас")
  ) {

    return formatDate(now);

  }


  const weekdays = {

    "понедельник": 1,
    "вторник": 2,
    "среду": 3,
    "среда": 3,
    "четверг": 4,
    "пятницу": 5,
    "пятница": 5,
    "субботу": 6,
    "суббота": 6,
    "воскресенье": 0

  };


  for (
    const [word, day]
    of Object.entries(weekdays)
  ) {

    if (
      normalized.includes(word)
    ) {

      const currentDay =
        now.getDay();

      let difference =
        day - currentDay;

      if (difference <= 0) {
        difference += 7;
      }

      now.setDate(
        now.getDate() + difference
      );

      return formatDate(now);

    }

  }

  return null;
}


function formatDate(date) {

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/* =========================================================
   TIME
   ========================================================= */

function parseTime(text) {

  const normalized =
    text.toLowerCase();


  if (
    normalized.includes("полдень") ||
    normalized.includes("12 дня")
  ) {

    return "12:00";

  }


  if (
    normalized.includes("полночь") ||
    normalized.includes("12 ночи")
  ) {

    return "00:00";

  }


  let match =
    normalized.match(
      /(?:в|на|к)\s*(\d{1,2})(?::(\d{2}))?\s*(утра|дня|вечера|ночи)?/
    );


  if (!match) {

    match =
      normalized.match(
        /\b(\d{1,2})(?::(\d{2}))?\s*(утра|дня|вечера|ночи)?/
      );

  }


  if (!match) {
    return null;
  }


  let hour =
    Number(match[1]);

  let minute =
    Number(match[2] || 0);

  const period =
    match[3];


  if (
    period === "утра" &&
    hour === 12
  ) {

    hour = 0;

  }


  if (
    (
      period === "дня" ||
      period === "вечера" ||
      period === "ночи"
    ) &&
    hour < 12
  ) {

    hour += 12;

  }


  if (
    hour > 23 ||
    minute > 59
  ) {

    return null;

  }


  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}


/* =========================================================
   TASK TYPE
   ========================================================= */

function parseTaskType(text) {

  const normalized =
    text.toLowerCase();


  if (
    normalized.includes(
      "напоминание"
    ) ||
    normalized.includes(
      "напомни"
    )
  ) {

    return "reminder";

  }


  if (
    normalized.includes("событие") ||
    normalized.includes("мероприятие")
  ) {

    return "event";

  }


  return "task";
}


/* =========================================================
   REPEAT
   ========================================================= */

function parseRepeatRule(text) {

  const normalized =
    text.toLowerCase();


  if (
    normalized.includes(
      "каждый день"
    ) ||
    normalized.includes(
      "ежедневно"
    ) ||
    normalized.includes(
      "ежедневный"
    )
  ) {

    return "daily";

  }


  if (
    normalized.includes(
      "по будням"
    ) ||
    normalized.includes(
      "каждый будний день"
    )
  ) {

    return "weekdays";

  }


  if (
    normalized.includes(
      "каждую неделю"
    ) ||
    normalized.includes(
      "еженедельно"
    )
  ) {

    return "weekly";

  }


  if (
    normalized.includes(
      "каждый месяц"
    ) ||
    normalized.includes(
      "ежемесячно"
    )
  ) {

    return "monthly";

  }


  const weekdayMap = {

    "понедельник":
      "monday",

    "вторник":
      "tuesday",

    "среду":
      "wednesday",

    "среда":
      "wednesday",

    "четверг":
      "thursday",

    "пятницу":
      "friday",

    "пятница":
      "friday",

    "субботу":
      "saturday",

    "суббота":
      "saturday",

    "воскресенье":
      "sunday"

  };


  for (
    const [word, day]
    of Object.entries(weekdayMap)
  ) {

    if (
      normalized.includes(
        `каждый ${word}`
      ) ||
      normalized.includes(
        `по ${word}`
      )
    ) {

      return `weekly:${day}`;

    }

  }


  return "none";
}


/* =========================================================
   TASK TITLE
   ========================================================= */

function cleanTaskTitle(text) {

  let title =
    text.trim();


  title =
    title.replace(
      /(?:сегодня|завтра|послезавтра)/gi,
      ""
    );


  title =
    title.replace(
      /(?:в|на|к)\s*\d{1,2}(?::\d{2})?\s*(?:утра|дня|вечера|ночи)?/gi,
      ""
    );


  title =
    title.replace(
      /\b\d{1,2}:\d{2}\b/g,
      ""
    );


  title =
    title.replace(
      /(?:полдень|полночь)/gi,
      ""
    );


  title =
    title.replace(
      /(?:каждый день|ежедневно|по будням|каждую неделю|еженедельно|каждый месяц|ежемесячно)/gi,
      ""
    );


  title =
    title.replace(
      /(?:напомни|напоминание|напомнить|задача|задачу|событие|мероприятие)/gi,
      ""
    );


  title =
    title.replace(
      /\s+/g,
      " "
    );


  title =
    title
      .replace(
        /^[\s,.:;-]+/,
        ""
      )
      .replace(
        /[\s,.:;-]+$/,
        ""
      );


  if (!title) {
    title = text.trim();
  }


  return title;
}


/* =========================================================
   PARSE TASK
   ========================================================= */

function parseTask(text) {

  const normalized =
    text.toLowerCase();


  const hasTaskWords =
    normalized.includes("сделать") ||
    normalized.includes("подготовить") ||
    normalized.includes("купить") ||
    normalized.includes("позвонить") ||
    normalized.includes("написать") ||
    normalized.includes("отправить") ||
    normalized.includes("проверить") ||
    normalized.includes("встретиться") ||
    normalized.includes("напомни") ||
    normalized.includes("напоминание") ||
    normalized.includes("задача") ||
    normalized.includes("событие") ||
    normalized.includes("мероприятие") ||
    normalized.includes("подготовка");


  const hasDate =
    normalized.includes("сегодня") ||
    normalized.includes("завтра") ||
    normalized.includes("послезавтра") ||
    normalized.includes("понедельник") ||
    normalized.includes("вторник") ||
    normalized.includes("среда") ||
    normalized.includes("среду") ||
    normalized.includes("четверг") ||
    normalized.includes("пятница") ||
    normalized.includes("пятницу") ||
    normalized.includes("суббота") ||
    normalized.includes("субботу") ||
    normalized.includes("воскресенье");


  const repeat =
    parseRepeatRule(
      normalized
    );


  if (
    !hasTaskWords &&
    !hasDate &&
    repeat === "none"
  ) {

    return null;

  }


  const taskDate =
    parseDateFromNaturalLanguage(
      normalized
    );


  const taskTime =
    parseTime(
      normalized
    );


  const title =
    cleanTaskTitle(
      text
    );


  if (!title) {
    return null;
  }


  return {

    title,

    task_date:
      taskDate,

    task_time:
      taskTime,

    task_type:
      parseTaskType(
        normalized
      ),

    repeat_rule:
      repeat

  };

}


/* =========================================================
   CREATE TASK
   ========================================================= */

async function createTask(
  env,
  userId,
  task
) {

  const result =
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
      VALUES (
        ?,
        ?,
        ?,
        ?,
        'active',
        ?,
        ?
      )
      RETURNING
        id,
        title,
        task_date,
        task_time,
        status,
        task_type,
        repeat_rule,
        created_at
    `)
    .bind(
      userId,
      task.title,
      task.task_date,
      task.task_time,
      task.task_type,
      task.repeat_rule
    )
    .first();


  return result;
}


/* =========================================================
   TASK REPLY
   ========================================================= */

function buildTaskReply(task) {

  let reply =
    "Задача создана.";


  if (task.task_date) {

    reply +=
      ` Дата: ${formatHumanDate(task.task_date)}.`;

  }


  if (task.task_time) {

    reply +=
      ` Время: ${task.task_time}.`;

  }


  if (
    task.repeat_rule &&
    task.repeat_rule !== "none"
  ) {

    reply +=
      ` Повтор: ${formatRepeat(task.repeat_rule)}.`;

  }


  return reply;
}


function formatHumanDate(date) {

  const [
    year,
    month,
    day
  ] =
    date.split("-");


  return `${day}.${month}.${year}`;
}


function formatRepeat(rule) {

  const map = {

    daily:
      "каждый день",

    weekdays:
      "по будням",

    weekly:
      "каждую неделю",

    monthly:
      "каждый месяц",

    "weekly:monday":
      "каждый понедельник",

    "weekly:tuesday":
      "каждый вторник",

    "weekly:wednesday":
      "каждую среду",

    "weekly:thursday":
      "каждый четверг",

    "weekly:friday":
      "каждую пятницу",

    "weekly:saturday":
      "каждую субботу",

    "weekly:sunday":
      "каждое воскресенье"

  };


  return (
    map[rule] ||
    rule
  );
}


/* =========================================================
   DELETE
   ========================================================= */

async function tryDeleteTask(
  env,
  userId,
  text
) {

  const normalized =
    text.toLowerCase();


  const isDelete =
    normalized.includes("удали") ||
    normalized.includes("удалить") ||
    normalized.includes("отмени задачу") ||
    normalized.includes("отменить задачу");


  if (!isDelete) {
    return null;
  }


  const title =
    extractTaskReference(
      text
    );


  if (!title) {

    return {

      reply:
        "Уточни, какую именно задачу удалить.",

      action:
        "delete_task"

    };

  }


  const task =
    await env.DB.prepare(`
      SELECT *
      FROM tasks
      WHERE user_id = ?
        AND status = 'active'
        AND LOWER(title) LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(
      userId,
      `%${title.toLowerCase()}%`
    )
    .first();


  if (!task) {

    return {

      reply:
        `Активную задачу «${title}» не нашёл.`,

      action:
        "delete_task"

    };

  }


  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'deleted'
    WHERE id = ?
  `)
  .bind(task.id)
  .run();


  return {

    reply:
      `Задача «${task.title}» удалена.`,

    action:
      "delete_task",

    task

  };

}


/* =========================================================
   COMPLETE
   ========================================================= */

async function tryCompleteTask(
  env,
  userId,
  text
) {

  const normalized =
    text.toLowerCase();


  const isComplete =
    normalized.includes("выполнил") ||
    normalized.includes("выполнила") ||
    normalized.includes("выполнено") ||
    normalized.includes("выполнить") ||
    normalized.includes("завершил") ||
    normalized.includes("завершила") ||
    normalized.includes("готово") ||
    normalized.includes("сделал") ||
    normalized.includes("сделала");


  if (!isComplete) {
    return null;
  }


  const title =
    extractTaskReference(
      text
    );


  if (!title) {

    return {

      reply:
        "Уточни, какую задачу отметить выполненной.",

      action:
        "complete_task"

    };

  }


  const task =
    await env.DB.prepare(`
      SELECT *
      FROM tasks
      WHERE user_id = ?
        AND status = 'active'
        AND LOWER(title) LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(
      userId,
      `%${title.toLowerCase()}%`
    )
    .first();


  if (!task) {

    return {

      reply:
        `Активную задачу «${title}» не нашёл.`,

      action:
        "complete_task"

    };

  }


  await env.DB.prepare(`
    UPDATE tasks
    SET status = 'completed'
    WHERE id = ?
  `)
  .bind(task.id)
  .run();


  return {

    reply:
      `Задача «${task.title}» отмечена как выполненная.`,

    action:
      "complete_task",

    task

  };

}


/* =========================================================
   LIST
   ========================================================= */

async function tryListTasks(
  env,
  userId,
  text
) {

  const normalized =
    text.toLowerCase();


  const isList =
    normalized.includes("мои задачи") ||
    normalized.includes("список задач") ||
    normalized.includes("покажи задачи") ||
    normalized.includes("какие у меня задачи") ||
    normalized === "задачи" ||
    normalized.includes("что запланировано");


  if (!isList) {
    return null;
  }


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
        task_date,
        task_time,
        id
    `)
    .bind(userId)
    .all();


  const tasks =
    result.results || [];


  if (!tasks.length) {

    return {

      reply:
        "Активных задач сейчас нет.",

      tasks: []

    };

  }


  const lines =
    tasks.map(
      (task, index) => {

        let line =
          `${index + 1}. ${task.title}`;


        if (task.task_date) {

          line +=
            ` — ${formatHumanDate(task.task_date)}`;

        }


        if (task.task_time) {

          line +=
            ` в ${task.task_time}`;

        }


        if (
          task.repeat_rule &&
          task.repeat_rule !== "none"
        ) {

          line +=
            ` (${formatRepeat(task.repeat_rule)})`;

        }


        return line;

      }
    );


  return {

    reply:
      "Твои активные задачи:\n\n" +
      lines.join("\n"),

    tasks

  };

}


/* =========================================================
   EXTRACT REFERENCE
   ========================================================= */

function extractTaskReference(text) {

  let value =
    text.trim();


  value =
    value.replace(
      /^(удали|удалить|отмени задачу|отменить задачу|выполнил|выполнила|выполнено|выполнить|завершил|завершила|готово|сделал|сделала)\s*/i,
      ""
    );


  value =
    value.replace(
      /^(задачу|задача)\s*/i,
      ""
    );


  return value.trim() || null;
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

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
        "Content-Type":
          "application/json; charset=utf-8",

        "Access-Control-Allow-Origin":
          "*"
      }
    }
  );

}


function html(
  content,
  status = 200
) {

  return new Response(
    content,
    {
      status,

      headers: {
        "Content-Type":
          "text/html; charset=utf-8"
      }
    }
  );

}
