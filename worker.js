export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // Обычная проверка Worker
      if (url.pathname === "/") {
        return new Response(
          "J.A.R.V.I.S. online",
          {
            headers: {
              "Content-Type": "text/plain; charset=UTF-8"
            }
          }
        );
      }

      // Прямой тест Workers AI
      if (url.pathname === "/test-ai") {

        const result = await env.AI.run(
          "@cf/zai-org/glm-4.7-flash",
          {
            messages: [
              {
                role: "system",
                content:
                  "Ты J.A.R.V.I.S. — персональный интеллектуальный ассистент. " +
                  "Отвечай на русском языке."
              },
              {
                role: "user",
                content: "Джарвис, представься одним предложением."
              }
            ]
          }
        );

        return new Response(
          JSON.stringify({
            success: true,
            ai_response: result
          }, null, 2),
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
          error: error.message,
          name: error.name,
          stack: error.stack
        }, null, 2),
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
