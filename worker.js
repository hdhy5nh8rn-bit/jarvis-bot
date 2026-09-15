export default {
  async fetch(request, env) {
    try {
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({
            status: "online",
            assistant: "J.A.R.V.I.S.",
            message: "Система активна."
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            }
          }
        );
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405
        });
      }

      const body = await request.json();

      const userMessage =
        body.message ||
        body.prompt ||
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
