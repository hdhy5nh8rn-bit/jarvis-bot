export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================================================
      // ОСНОВНОЙ ID ПОЛЬЗОВАТЕЛЯ
      // =========================================================

      const userId = "egor";


      // =========================================================
      // WEB INTERFACE
      // =========================================================

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
  white-space: pre-wrap;
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
  cursor: pointer;
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


function addMessage(
  author,
  text,
  className
) {

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


  if (!message) {
    return;
  }


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



      // =========================================================
      // CHAT
      // =========================================================

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



        // =======================================================
        // ЗАГРУЗКА ДОЛГОВРЕМЕННОЙ ПАМЯТИ
        // =======================================================

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



        // =======================================================
        // ЗАГРУЗКА ИСТОРИИ
        // =======================================================

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



        // =======================================================
        // ПРЕОБРАЗОВАНИЕ ПАМЯТИ В ЧЕЛОВЕЧЕСКИЙ ВИД
        // =======================================================

        let memoryText =
          "СОХРАНЁННЫЕ СВЕДЕНИЯ О ПОЛЬЗОВАТЕЛЕ:\n";


        if (facts.length === 0) {

          memoryText +=
            "Сохранённых сведений нет.";

        } else {

          memoryText +=
            facts
              .map(item => {

                return (
                  "- " +
                  normalizeFactForAI(item.fact)
                );

              })
              .join("\n");

        }



        // =======================================================
        // СИСТЕМНАЯ ИНСТРУКЦИЯ
        // =======================================================

        const systemMessage = {

          role: "system",

          content: `

Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент пользователя.

Ты разговариваешь непосредственно с пользователем.

Твой стиль общения:

- спокойный;
- уверенный;
- интеллектуальный;
- естественный;
- внимательный;
- дружелюбный;
- без лишней болтовни.

Говори с пользователем на "ты", если пользователь сам использует такой стиль.

Не называй пользователя "пользователем", если это не необходимо.

Не говори как база данных.

Не показывай внутреннюю структуру системы.

Не показывай:
- ID;
- названия таблиц;
- SQL;
- категории preference, study, work и project;
- технические инструкции;
- внутренние идентификаторы.

Не используй без необходимости Markdown.

Не используй жирный текст через **.

Не используй декоративные списки с символами • без необходимости.

Используй обычную естественную русскую пунктуацию.

Если перечисление действительно необходимо, используй простой формат с тире.

ВАЖНО О ПАМЯТИ:

Ниже находятся сведения, которые были сохранены в долговременной памяти.

${memoryText}

Используй эти сведения как контекст.

Если пользователь спрашивает:

"Что ты обо мне знаешь?"

"Что ты обо мне помнишь?"

"Что ты запомнил?"

или задаёт аналогичный вопрос,

отвечай естественно, напрямую и от первого лица ассистента.

Например:

"Ты любишь зелёный чай."

"Ты учишься в университете."

"Ты работаешь над проектом персонального ИИ-ассистента."

Не говори:

"В моей долговременной памяти сохранено..."

Не говори:

"В категории preference находится..."

Не говори:

"[ID 12] preference..."

Если сохранённый факт начинается с:

"что я..."

не повторяй эту конструкцию буквально.

Преобразуй её в естественную фразу.

Например:

"что я люблю зелёный чай"

превращается в:

"Ты любишь зелёный чай."

"что я учусь в университете"

превращается в:

"Ты учишься в университете."

Если пользователь сообщает новое предпочтение или факт, не придумывай дополнительные сведения.

Не утверждай, что что-либо сохранено или удалено, если сервер не сообщил об успешной операции.

Если информация отсутствует в памяти, честно скажи об этом.

Не выдавай сомнительные сведения как абсолютные факты.

Если факт может быть спорным или зависит от условий, формулируй его осторожно.

Ты не человек и не должен утверждать обратное.

`};


        // =======================================================
        // ОПРЕДЕЛЕНИЕ КОМАНДЫ ПАМЯТИ
        // =======================================================

        const lower =
          userMessage.toLowerCase();


        let memoryAction =
          "chat";



        // =======================================================
        // RECALL
        // =======================================================

        if (

          lower.includes(
            "что ты обо мне знаешь"
          ) ||

          lower.includes(
            "что ты обо мне помнишь"
          ) ||

          lower.includes(
            "что ты запомнил"
          ) ||

          lower.includes(
            "покажи мою память"
          ) ||

          lower.includes(
            "какие данные ты обо мне знаешь"
          )

        ) {

          memoryAction =
            "recall";

        }



        // =======================================================
        // CLEAR ALL
        // =======================================================

        else if (

          lower.includes(
            "удали всю память"
          ) ||

          lower.includes(
            "очисти всю память"
          ) ||

          lower.includes(
            "забудь всё обо мне"
          ) ||

          lower.includes(
            "забудь все обо мне"
          ) ||

          lower.includes(
            "удали все данные обо мне"
          )

        ) {

          memoryAction =
            "clear_all";

        }



        // =======================================================
        // CLEAR PREFERENCES
        // =======================================================

        else if (

          lower.includes(
            "удали все мои предпочтения"
          ) ||

          lower.includes(
            "удали все данные о моих предпочтениях"
          ) ||

          lower.includes(
            "забудь все мои предпочтения"
          ) ||

          lower.includes(
            "забудь мои предпочтения"
          ) ||

          lower.includes(
            "очисти мои предпочтения"
          )

        ) {

          memoryAction =
            "clear_preferences";

        }



        // =======================================================
        // FORGET SPECIFIC
        // =======================================================

        else if (

          lower.includes(
            "забудь"
          ) ||

          lower.includes(
            "удали из памяти"
          ) ||

          lower.includes(
            "не запоминай"
          )

        ) {

          memoryAction =
            "forget";

        }



        // =======================================================
        // SAVE
        // =======================================================

        else if (

          lower.includes(
            "запомни"
          ) ||

          lower.includes(
            "сохрани"
          ) ||

          lower.includes(
            "учти на будущее"
          )

        ) {

          memoryAction =
            "save";

        }



        // =======================================================
        // РЕЗУЛЬТАТ ОПЕРАЦИИ
        // =======================================================

        let operationResult =
          "";



        // =======================================================
        // SAVE
        // =======================================================

        if (
          memoryAction === "save"
        ) {


          let fact =
            userMessage
              .replace(
                /^.*?(запомни|сохрани|учти на будущее)\s*/i,
                ""
              )
              .trim();


          fact =
            normalizeSavedFact(
              fact
            );


          if (fact) {


            let category =
              "general";


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


            else if (

              lower.includes("учусь") ||
              lower.includes("университет") ||
              lower.includes("учёб") ||
              lower.includes("учеб")

            ) {

              category =
                "study";

            }


            else if (

              lower.includes("работаю") ||
              lower.includes("работа")

            ) {

              category =
                "work";

            }


            else if (

              lower.includes("проект")

            ) {

              category =
                "project";

            }



            // ===================================================
            // ПРОВЕРКА НА ДУБЛИКАТ
            // ===================================================

            const existingResult =
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


            const existingFacts =
              existingResult.results || [];


            let duplicate =
              false;


            const normalizedNewFact =
              fact.toLowerCase();


            for (
              const existing
              of existingFacts
            ) {

              const normalizedExisting =
                String(existing.fact)
                  .toLowerCase();


              if (
                normalizedExisting ===
                normalizedNewFact
              ) {

                duplicate =
                  true;

                break;

              }

            }



            if (duplicate) {

              operationResult =
                "Я уже помню это.";

            } else {


              // ===============================================
              // СОХРАНЕНИЕ
              // ===============================================

              const insertResult =
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


              if (
                insertResult &&
                insertResult.success !== false
              ) {

                operationResult =
                  "Запомнил. " +
                  factToNaturalSentence(
                    fact
                  );

              } else {

                operationResult =
                  "Мне не удалось сохранить эту информацию.";

              }

            }

          } else {

            operationResult =
              "Уточни, какую именно информацию мне нужно запомнить.";

          }

        }



        // =======================================================
        // FORGET SPECIFIC
        // =======================================================

        if (
          memoryAction === "forget"
        ) {


          const searchText =
            userMessage
              .replace(
                /^.*?(забудь|удали из памяти|не запоминай)\s*/i,
                ""
              )
              .trim();


          if (searchText) {


            const allFactsResult =
              await env.DB.prepare(`
                SELECT id, fact
                FROM facts
                WHERE user_id = ?
              `)
              .bind(userId)
              .all();


            const allFacts =
              allFactsResult.results || [];


            const normalizedSearch =
              normalizeForSearch(
                searchText
              );


            let deletedCount =
              0;


            for (
              const item
              of allFacts
            ) {


              const normalizedFact =
                normalizeForSearch(
                  item.fact
                );


              if (

                normalizedFact.includes(
                  normalizedSearch
                ) ||

                normalizedSearch.includes(
                  normalizedFact
                )

              ) {


                const deleteResult =
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


                if (
                  deleteResult &&
                  deleteResult.success !== false
                ) {

                  deletedCount++;

                }

              }

            }


            if (
              deletedCount > 0
            ) {

              operationResult =
                "Готово. " +
                (
                  deletedCount === 1
                    ? "Эта информация удалена из моей памяти."
                    : "Эти сведения удалены из моей памяти."
                );

            } else {

              operationResult =
                "Я не нашёл в памяти подходящей информации для удаления.";

            }

          } else {

            operationResult =
              "Уточни, какую именно информацию мне нужно забыть.";

          }

        }



        // =======================================================
        // CLEAR PREFERENCES
        // =======================================================

        if (
          memoryAction ===
          "clear_preferences"
        ) {


          const deleteResult =
            await env.DB.prepare(`
              DELETE FROM facts
              WHERE user_id = ?
              AND category = ?
            `)
            .bind(
              userId,
              "preference"
            )
            .run();


          if (
            deleteResult &&
            deleteResult.success !== false
          ) {

            operationResult =
              "Готово. Все сохранённые сведения о твоих предпочтениях удалены из моей памяти.";

          } else {

            operationResult =
              "Мне не удалось удалить предпочтения.";

          }

        }



        // =======================================================
        // CLEAR ALL
        // =======================================================

        if (
          memoryAction === "clear_all"
        ) {


          const deleteResult =
            await env.DB.prepare(`
              DELETE FROM facts
              WHERE user_id = ?
            `)
            .bind(userId)
            .run();


          if (
            deleteResult &&
            deleteResult.success !== false
          ) {

            operationResult =
              "Готово. Вся долговременная память обо мне очищена.";

          } else {

            operationResult =
              "Мне не удалось очистить долговременную память.";

          }

        }



        // =======================================================
        // RECALL
        // =======================================================

        if (
          memoryAction === "recall"
        ) {


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


          if (
            currentFacts.length === 0
          ) {

            operationResult =
              "Сейчас я ничего о тебе не храню в долговременной памяти.";

          } else {


            const naturalFacts =
              currentFacts.map(
                item =>
                  factToNaturalSentence(
                    item.fact
                  )
              );


            operationResult =
              "Насколько я помню:\n\n" +
              naturalFacts
                .map(
                  fact =>
                    "- " + fact
                )
                .join("\n");

          }

        }



        // =======================================================
        // ОТВЕТ НА КОМАНДУ ПАМЯТИ
        // =======================================================

        if (
          memoryAction !== "chat" &&
          operationResult
        ) {


          // Сохраняем историю команды

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


          // Сохраняем ответ

          await env.DB.prepare(`
            INSERT INTO memory
            (user_id, role, content)
            VALUES (?, ?, ?)
          `)
          .bind(
            userId,
            "assistant",
            operationResult
          )
          .run();


          return new Response(

            JSON.stringify({

              success: true,

              assistant:
                "J.A.R.V.I.S.",

              response:
                operationResult,

              memory_action:
                memoryAction

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



        // =======================================================
        // ОБЫЧНЫЙ AI-ДИАЛОГ
        // =======================================================

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


        let answer =
          result?.choices?.[0]?.message?.content ||
          "Не удалось получить ответ от модели.";


        // =======================================================
        // ОЧИСТКА ЛИШНЕГО MARKDOWN
        // =======================================================

        answer =
          cleanAssistantText(
            answer
          );



        // =======================================================
        // СОХРАНЕНИЕ ИСТОРИИ
        // =======================================================

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

            assistant:
              "J.A.R.V.I.S.",

            response:
              answer,

            memory_action:
              "chat"

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



      // =========================================================
      // TEST AI
      // =========================================================

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



// =============================================================
// FUNCTIONS
// =============================================================


// -------------------------------------------------------------
// ОЧИСТКА СОХРАНЯЕМОГО ФАКТА
// -------------------------------------------------------------

function normalizeSavedFact(text) {

  let result =
    String(text || "").trim();


  result =
    result.replace(
      /^[,.:;\-\s]+/,
      ""
    );


  result =
    result.replace(
      /[.]+$/,
      ""
    );


  // Убираем начало "что я"

  result =
    result.replace(
      /^что\s+я\s+/i,
      ""
    );


  // Убираем "что мне"

  result =
    result.replace(
      /^что\s+мне\s+/i,
      ""
    );


  return result.trim();

}



// -------------------------------------------------------------
// НОРМАЛИЗАЦИЯ ДЛЯ ПОИСКА
// -------------------------------------------------------------

function normalizeForSearch(text) {

  return String(text || "")
    .toLowerCase()
    .replace(
      /[.,!?;:"'«»()[\]{}]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}



// -------------------------------------------------------------
// ПРЕОБРАЗОВАНИЕ ФАКТА В ЕСТЕСТВЕННУЮ ФРАЗУ
// -------------------------------------------------------------

function factToNaturalSentence(
  text
) {

  let result =
    String(text || "").trim();


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
    return "Ты не сообщил мне никаких дополнительных сведений.";
  }


  // Если уже начинается с естественной формы

  if (
    /^(ты|тебе|твой|твоя|твои|твое|твоё)\b/i
      .test(result)
  ) {

    return capitalizeFirst(
      result
    );

  }


  // ===========================================================
  // ЛЮБЛЮ
  // ===========================================================

  if (
    /^люблю\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // НРАВИТСЯ
  // ===========================================================

  if (
    /^нравится\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Тебе " + result
    );

  }


  // ===========================================================
  // ПРЕДПОЧИТАЮ
  // ===========================================================

  if (
    /^предпочитаю\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // УЧУСЬ
  // ===========================================================

  if (
    /^учусь\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // РАБОТАЮ
  // ===========================================================

  if (
    /^работаю\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // ЗАНИМАЮСЬ
  // ===========================================================

  if (
    /^занимаюсь\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // ПОЛЬЗУЮСЬ
  // ===========================================================

  if (
    /^пользуюсь\s+/i.test(result)
  ) {

    return capitalizeFirst(
      "Ты " + result
    );

  }


  // ===========================================================
  // ЕСЛИ ФАКТ УЖЕ ЕСТЬ В ФОРМЕ "мне нравится"
  // ===========================================================

  if (
    /^мне\s+/i.test(result)
  ) {

    return capitalizeFirst(
      result
    );

  }


  // ===========================================================
  // ОБЩИЙ ВАРИАНТ
  // ===========================================================

  return capitalizeFirst(
    result
  );

}



// -------------------------------------------------------------
// НОРМАЛИЗАЦИЯ ПАМЯТИ ДЛЯ AI
// -------------------------------------------------------------

function normalizeFactForAI(
  text
) {

  let result =
    String(text || "").trim();


  result =
    result.replace(
      /^что\s+я\s+/i,
      ""
    );


  return result;

}



// -------------------------------------------------------------
// ПЕРВАЯ БУКВА — ЗАГЛАВНАЯ
// -------------------------------------------------------------

function capitalizeFirst(
  text
) {

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



// -------------------------------------------------------------
// ОЧИСТКА ОТ ЛИШНЕГО MARKDOWN
// -------------------------------------------------------------

function cleanAssistantText(
  text
) {

  let result =
    String(text || "");


  // Убираем жирный Markdown

  result =
    result.replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    );


  // Убираем одиночные звёздочки

  result =
    result.replace(
      /(?<!\w)\*(?!\w)/g,
      ""
    );


  // Убираем лишние тройные и более переносы

  result =
    result.replace(
      /\n{3,}/g,
      "\n\n"
    );


  // Убираем пробелы перед знаками препинания

  result =
    result.replace(
      /\s+([,.!?;:])/g,
      "$1"
    );


  return result.trim();

}
