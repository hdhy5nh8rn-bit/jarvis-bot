const VERSION = "v5.2-DIAGNOSTIC";

const USER_ID = "egor";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return json({
        ok: true,
        service: "J.A.R.V.I.S.",
        version: VERSION,
        handler: "new-code"
      });
    }

    if (url.pathname === "/chat" && request.method === "POST") {

      const body = await request.json().catch(() => ({}));
      const message = String(body.message || "").trim();

      if (!message) {
        return json({
          ok: false,
          error: "Пустое сообщение"
        }, 400);
      }

      /*
       * ДИАГНОСТИКА:
       * Если приходит команда "Завтра в 10 подготовить презентацию",
       * этот код обязан вернуть именно этот ответ.
       */

      if (
        /завтра/i.test(message) &&
        /10/i.test(message) &&
        /презентац/i.test(message)
      ) {

        const tomorrow = getTomorrow();

        const task = await env.DB.prepare(`
          INSERT INTO tasks
            (
              user_id,
              title,
              task_date,
              task_time,
              status,
              task_type,
              repeat_rule
            )
          VALUES (?, ?, ?, ?, 'active', ?, ?)
          RETURNING
            id,
            title,
            task_date,
            task_time,
            status,
            task_type,
            repeat_rule
        `)
        .bind(
          USER_ID,
          "подготовить презентацию",
          tomorrow,
          "10:00",
          "task",
          "none"
        )
        .first();

        return json({
          ok: true,
          version: VERSION,
          handler: "task-creation-test",
          reply:
            `Тестовый обработчик сработал. ` +
            `Создал задачу «подготовить презентацию» ` +
            `на ${tomorrow} в 10:00.`,
          task
        });
      }

      return json({
        ok: true,
        version: VERSION,
        handler: "chat-test",
        reply: "Новый код J.A.R.V.I.S. работает. Команда пока не распознана.",
        received: message
      });
    }

    if (url.pathname === "/tasks") {

      const result = await env.DB.prepare(`
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
        ORDER BY id DESC
      `)
      .bind(USER_ID)
      .all();

      return json({
        ok: true,
        version: VERSION,
        tasks: result.results || []
      });
    }

    return new Response("J.A.R.V.I.S. v5.2", {
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
};


function getTomorrow() {

  const now = new Date();

  now.setDate(now.getDate() + 1);

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8"
      }
    }
  );
}
