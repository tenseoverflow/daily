import { AI_MODEL } from "./config";
import type { Env } from "./types";

export type AiProviderName = "workers" | "ollama" | "auto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

function providerName(env: Env): AiProviderName {
  const raw = (env.AI_PROVIDER || "workers").toLowerCase();
  if (raw === "ollama" || raw === "workers" || raw === "auto") return raw;
  return "workers";
}

function ollamaBaseUrl(env: Env): string {
  return (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function ollamaModel(env: Env): string {
  return env.OLLAMA_MODEL || "llama3.1";
}

async function chatWorkersAi(env: Env, options: ChatOptions): Promise<string> {
  const result = (await env.AI.run(AI_MODEL, {
    messages: options.messages,
    max_tokens: options.maxTokens ?? 700,
    temperature: options.temperature ?? 0.3,
  })) as { response?: string };
  return (result.response ?? "").trim();
}

async function chatOllama(env: Env, options: ChatOptions): Promise<string> {
  const url = `${ollamaBaseUrl(env)}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel(env),
      stream: false,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.maxTokens ?? 700,
      },
      messages: options.messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    response?: string;
  };
  return (data.message?.content ?? data.response ?? "").trim();
}

export function describeAiConfig(env: Env): {
  provider: AiProviderName;
  ollamaBaseUrl: string;
  ollamaModel: string;
  workersModel: string;
} {
  return {
    provider: providerName(env),
    ollamaBaseUrl: ollamaBaseUrl(env),
    ollamaModel: ollamaModel(env),
    workersModel: AI_MODEL,
  };
}

/**
 * Chat completion via Workers AI and/or Ollama.
 * - workers: Cloudflare Workers AI only
 * - ollama: local/remote Ollama only
 * - auto: try Workers AI, then Ollama on failure
 */
export async function chat(env: Env, options: ChatOptions): Promise<string> {
  const mode = providerName(env);

  if (mode === "ollama") {
    return chatOllama(env, options);
  }

  if (mode === "workers") {
    return chatWorkersAi(env, options);
  }

  // auto
  try {
    return await chatWorkersAi(env, options);
  } catch (workersErr) {
    console.warn("Workers AI failed, trying Ollama:", workersErr);
    try {
      return await chatOllama(env, options);
    } catch (ollamaErr) {
      throw new Error(
        `AI unavailable (workers + ollama failed): ${String(workersErr)} | ${String(ollamaErr)}`,
      );
    }
  }
}
