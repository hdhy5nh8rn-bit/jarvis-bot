export default {
  async fetch(request, env) {
    try {
      if (request.method === "GET") {
        return Response.json({
          status: "online",
          assistant: "J.A.R.V.I.S.",
          message: "Система активна."
        });
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

      return Response.json({
        success: true,
        assistant: "J.A.R.V.I.S.",
        response: result.response ?? result
      });

    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error.message
        },
        {
          status: 500
        }
      );
    }
  }
};
