const express = require("express");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===============================
// ESTADO TEMPORÁRIO DO LIFEPILOTE
// ===============================

let state = {
  tasks: [],
  events: [],
  goals: []
};

// ===============================
// FERRAMENTAS DO ASSISTENTE
// ===============================

const tools = [
  {
    type: "function",
    name: "create_task",
    description: "Cria uma tarefa no LifePilote.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        priority: {
          type: "string",
          enum: ["alta", "media", "baixa"]
        }
      },
      required: ["text"]
    }
  },

  {
    type: "function",
    name: "complete_task",
    description: "Conclui uma tarefa existente.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    }
  },

  {
    type: "function",
    name: "create_event",
    description: "Cria um compromisso na agenda.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        datetime: {
          type: "string",
          description: "Data e hora em ISO 8601"
        }
      },
      required: ["title", "datetime"]
    }
  },

  {
    type: "function",
    name: "create_goal",
    description: "Cria um objetivo.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    }
  },

  {
    type: "function",
    name: "list_tasks",
    description: "Lista as tarefas atuais.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },

  {
    type: "function",
    name: "list_events",
    description: "Lista os compromissos atuais.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },

  {
    type: "function",
    name: "list_goals",
    description: "Lista os objetivos atuais.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

// ===============================
// EXECUTAR FERRAMENTAS
// ===============================

function callTool(name, args) {

  if (name === "create_task") {

    const task = {
      id: Date.now(),
      text: args.text,
      priority: args.priority || "media",
      done: false
    };

    state.tasks.push(task);

    return task;
  }

  if (name === "complete_task") {

    const task = state.tasks.find(x =>
      x.text.toLowerCase().includes(
        args.text.toLowerCase()
      )
    );

    if (task) {
      task.done = true;
      return task;
    }

    return {
      error: "Tarefa não encontrada"
    };
  }

  if (name === "create_event") {

    const event = {
      id: Date.now(),
      title: args.title,
      datetime: args.datetime
    };

    state.events.push(event);

    return event;
  }

  if (name === "create_goal") {

    const goal = {
      id: Date.now(),
      text: args.text
    };

    state.goals.push(goal);

    return goal;
  }

  if (name === "list_tasks") {
    return state.tasks;
  }

  if (name === "list_events") {
    return state.events;
  }

  if (name === "list_goals") {
    return state.goals;
  }

  return {
    error: "Ferramenta não encontrada"
  };
}

// ===============================
// CHAT COM A IA
// ===============================

app.post("/api/chat", async (req, res) => {

  try {

    const input = req.body.message;

    if (!input) {

      return res.status(400).json({
        error: "Mensagem vazia."
      });

    }

    let response = await client.responses.create({

      model: "gpt-5.6-luna",

      instructions: `
Você é o LifePilote, um assistente pessoal inteligente.

Responda sempre em português do Brasil.

Seja natural, útil, direto e inteligente.

Você pode conversar, pesquisar na web,
criar tarefas, concluir tarefas,
criar compromissos e criar objetivos.

Quando a pergunta depender de informações atuais,
recentes, notícias, preços, clima, acontecimentos,
pessoas, empresas, produtos ou qualquer informação
que possa ter mudado, USE A BUSCA NA WEB.

Quando usar a busca:

- analise as fontes;
- responda usando as informações encontradas;
- não invente informações;
- se houver conflito entre fontes, explique;
- priorize fontes confiáveis.

Nunca diga que pesquisou se a busca não foi realmente usada.

Nunca diga que criou ou alterou algo sem confirmação
da ferramenta correspondente.

Quando faltar informação essencial para criar um evento,
pergunte ao usuário.

Você é o cérebro online do LifePilote.
`,

      input,

      tools: [
        ...tools,
        {
          type: "web_search"
        }
      ]
    });

    // ===============================
    // EXECUTAR FERRAMENTAS
    // ===============================

    while (
      response.output.some(
        x => x.type === "function_call"
      )
    ) {

      const calls = response.output.filter(
        x => x.type === "function_call"
      );

      const outputs = calls.map(call => ({

        type: "function_call_output",

        call_id: call.call_id,

        output: JSON.stringify(
          callTool(
            call.name,
            JSON.parse(
              call.arguments || "{}"
            )
          )
        )

      }));

      response = await client.responses.create({

        model: "gpt-5.6-luna",

        previous_response_id: response.id,

        input: outputs,

        tools: [
          ...tools,
          {
            type: "web_search"
          }
        ]

      });
    }

    // ===============================
    // IDENTIFICAR BUSCA NA WEB
    // ===============================

    const usedWebSearch =
      response.output.some(
        x => x.type === "web_search_call"
      );

    const sources = [];

    for (const item of response.output) {

      if (
        item.type === "web_search_call" &&
        item.action &&
        Array.isArray(item.action.sources)
      ) {

        for (const source of item.action.sources) {

          if (
            source.url &&
            !sources.some(
              s => s.url === source.url
            )
          ) {

            sources.push({
              title:
                source.title ||
                source.url,

              url: source.url
            });

          }
        }
      }
    }

    res.json({

      reply: response.output_text,

      usedWebSearch,

      sources,

      state

    });

  } catch (error) {

    console.error(
      "ERRO DO LIFEPILOTE:",
      error
    );

    res.status(500).json({

      error:
        "Falha ao falar com a IA."

    });

  }

});

// ===============================
// ESTADO DO LIFEPILOTE
// ===============================

app.get("/api/state", (req, res) => {

  res.json(state);

});

// ===============================
// SERVIDOR
// ===============================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "LifePilote online na porta " +
    PORT
  );

});
