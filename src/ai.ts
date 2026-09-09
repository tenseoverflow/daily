import { AI_MODEL } from "./config";
import type { Env } from "./types";

export type AiProviderName = "workers" | "cursor" | "auto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

const TERMINAL_RUN = new Set([
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
]);

function providerName(env: Env): AiProviderName {
  const raw = (env.AI_PROVIDER || "workers").toLowerCase();
  if (raw === "workers" || raw === "cursor" || raw === "auto") {
    return raw;
  }
  return "workers";
}

function cursorApiBase(env: Env): string {
  return (env.CURSOR_API_BASE_URL || "https://api.cursor.com").replace(
    /\/$/,
    "",
  );
}

function cursorModel(env: Env): string | undefined {
  return env.CURSOR_MODEL?.trim() || undefined;
}

function cursorAuthHeader(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

async function sleep(ms: number): Promise<void> {
  const scheduler = (
    globalThis as unknown as {
      scheduler?: { wait?: (n: number) => Promise<void> };
    }
  ).scheduler;
  if (scheduler?.wait) {
    await scheduler.wait(ms);
    return;
  }
  await new Promise((r) => setTimeout(r, ms));
}

async function chatWorkersAi(env: Env, options: ChatOptions): Promise<string> {
  const result = (await env.AI.run(AI_MODEL, {
    messages: options.messages,
    max_tokens: options.maxTokens ?? 700,
    temperature: options.temperature ?? 0.3,
  })) as { response?: string };
  return (result.response ?? "").trim();
}

function formatCursorPrompt(messages: ChatMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join("\n\n");

  return [
    "You are a text-only assistant running as a no-repo Cursor cloud agent.",
    "Do not use tools, edit files, browse the web, or invent repository work.",
    "Reply with ONLY the final answer text — no preamble about being an agent.",
    "",
    transcript,
  ].join("\n");
}

async function cursorFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not set");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", cursorAuthHeader(apiKey));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${cursorApiBase(env)}${path}`, { ...init, headers });
}

async function waitForCursorRun(
  env: Env,
  agentId: string,
  runId: string,
): Promise<string> {
  const maxAttempts = 90;
  let delayMs = 1500;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await cursorFetch(env, `/v1/agents/${agentId}/runs/${runId}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cursor run poll ${res.status}: ${body.slice(0, 200)}`);
    }

    const run = (await res.json()) as {
      status?: string;
      result?: string;
      error?: { message?: string };
    };

    if (run.status && TERMINAL_RUN.has(run.status)) {
      if (run.status !== "FINISHED") {
        throw new Error(
          `Cursor run ${run.status}: ${run.error?.message || run.result || "no result"}`,
        );
      }
      const text = (run.result || "").trim();
      if (!text) {
        throw new Error("Cursor run finished with empty result");
      }
      return text;
    }

    await sleep(delayMs);
    delayMs = Math.min(8000, Math.floor(delayMs * 1.25));
  }

  throw new Error("Cursor run timed out waiting for result");
}

async function archiveCursorAgent(env: Env, agentId: string): Promise<void> {
  await cursorFetch(env, `/v1/agents/${agentId}/archive`, {
    method: "POST",
  }).catch(() => undefined);
}

/**
 * Cursor Cloud Agents API (no-repo agent) as a text completion backend.
 * Docs: https://cursor.com/docs/cloud-agent/api/endpoints
 */
async function chatCursor(env: Env, options: ChatOptions): Promise<string> {
  const body: Record<string, unknown> = {
    prompt: { text: formatCursorPrompt(options.messages) },
    name: "daily-digest-ai",
  };
  const modelId = cursorModel(env);
  if (modelId) {
    body.model = { id: modelId };
  }

  const createRes = await cursorFetch(env, "/v1/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => "");
    const hint =
      createRes.status === 400 && errBody.includes("invalid_model")
        ? ` List valid ids: curl -sS ${cursorApiBase(env)}/v1/models -H "Authorization: Bearer $CURSOR_API_KEY" | jq '.items[].id' — or unset CURSOR_MODEL to use your account default.`
        : "";
    throw new Error(
      `Cursor create ${createRes.status}: ${errBody.slice(0, 240)}${hint}`,
    );
  }

  const created = (await createRes.json()) as {
    agent?: { id?: string };
    run?: { id?: string };
  };
  const agentId = created.agent?.id;
  const runId = created.run?.id;
  if (!agentId || !runId) {
    throw new Error("Cursor create response missing agent/run id");
  }

  try {
    return await waitForCursorRun(env, agentId, runId);
  } finally {
    await archiveCursorAgent(env, agentId);
  }
}

export function describeAiConfig(env: Env): {
  provider: AiProviderName;
  workersModel: string;
  cursorConfigured: boolean;
  cursorModel: string | null;
  cursorApiBaseUrl: string;
} {
  return {
    provider: providerName(env),
    workersModel: AI_MODEL,
    cursorConfigured: Boolean(env.CURSOR_API_KEY),
    cursorModel: cursorModel(env) ?? null,
    cursorApiBaseUrl: cursorApiBase(env),
  };
}

async function callProvider(
  name: "workers" | "cursor",
  env: Env,
  options: ChatOptions,
): Promise<string> {
  if (name === "workers") return chatWorkersAi(env, options);
  return chatCursor(env, options);
}

/**
 * Chat completion via Workers AI and/or Cursor Cloud Agents.
 * - workers / cursor: that backend only
 * - auto: Workers AI → Cursor
 */
export async function chat(env: Env, options: ChatOptions): Promise<string> {
  const mode = providerName(env);

  if (mode !== "auto") {
    return callProvider(mode, env, options);
  }

  const errors: string[] = [];
  for (const name of ["workers", "cursor"] as const) {
    if (name === "cursor" && !env.CURSOR_API_KEY) continue;
    try {
      return await callProvider(name, env, options);
    } catch (err) {
      console.warn(`${name} AI failed:`, err);
      errors.push(`${name}: ${String(err)}`);
    }
  }

  throw new Error(`AI unavailable (${errors.join(" | ") || "no providers"})`);
}

export interface RankingChatResult {
  text: string;
  provider: "workers" | "cursor";
}

/**
 * Chat for ranking with explicit provider selection.
 */
export async function chatForRanking(
  env: Env,
  options: ChatOptions,
  preferredProvider: "workers" | "cursor",
): Promise<RankingChatResult> {
  const text = await callProvider(preferredProvider, env, options);
  return { text, provider: preferredProvider };
}

export function logTruncatedResponse(
  text: string,
  provider: "workers" | "cursor",
): void {
  const truncated = text.slice(0, 300);
  console.warn(
    `JSON parse failed from ${provider}, raw response (truncated): ${truncated}${text.length > 300 ? "..." : ""}`,
  );
}

export function shouldRetryCursor(env: Env): boolean {
  const mode = providerName(env);
  return mode === "auto" && Boolean(env.CURSOR_API_KEY);
}
