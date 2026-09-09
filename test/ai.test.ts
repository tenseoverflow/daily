import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, describeAiConfig } from "../src/ai";
import type { Env } from "../src/types";

function baseEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    AI_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "llama3.1",
    ...overrides,
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("describeAiConfig", () => {
  it("exposes provider and cursor flags", () => {
    const cfg = describeAiConfig(
      baseEnv({ AI_PROVIDER: "cursor", CURSOR_API_KEY: "crsr_test" }),
    );
    expect(cfg.provider).toBe("cursor");
    expect(cfg.cursorConfigured).toBe(true);
    expect(cfg.cursorModel).toBeNull();
    expect(cfg.cursorApiBaseUrl).toBe("https://api.cursor.com");
  });
});

describe("chat ollama", () => {
  it("posts to /api/chat and returns message content", async () => {
    const seen = {
      url: "",
      body: {} as {
        model?: string;
        stream?: boolean;
        messages?: Array<{ content: string }>;
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.url = String(input);
        seen.body = JSON.parse(String(init?.body));
        return Response.json({
          message: { role: "assistant", content: "  hello from ollama  " },
        });
      }),
    );

    const text = await chat(baseEnv(), {
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 50,
      temperature: 0.1,
    });

    expect(text).toBe("hello from ollama");
    expect(seen.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(seen.body.model).toBe("llama3.1");
    expect(seen.body.stream).toBe(false);
    expect(seen.body.messages?.[0]?.content).toBe("hi");
  });

  it("throws on non-OK ollama responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("model not found", { status: 404 })),
    );

    await expect(
      chat(baseEnv(), { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/Ollama 404/);
  });
});

describe("chat cursor", () => {
  it("creates a no-repo agent, polls run result, archives", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method || "GET").toUpperCase();
        calls.push({ url, method });

        if (url.endsWith("/v1/agents") && method === "POST") {
          const body = JSON.parse(String(init?.body));
          expect(body.prompt.text).toContain("USER:");
          expect(body.prompt.text).toContain("hi");
          expect(body.model).toBeUndefined();
          return Response.json({
            agent: { id: "bc-test" },
            run: { id: "run-test" },
          });
        }

        if (url.includes("/v1/agents/bc-test/runs/run-test") && method === "GET") {
          return Response.json({
            id: "run-test",
            agentId: "bc-test",
            status: "FINISHED",
            result: "  ranked headlines json  ",
          });
        }

        if (url.endsWith("/v1/agents/bc-test/archive") && method === "POST") {
          return new Response(null, { status: 200 });
        }

        return new Response("unexpected", { status: 500 });
      }),
    );

    const text = await chat(
      baseEnv({
        AI_PROVIDER: "cursor",
        CURSOR_API_KEY: "crsr_test",
      }),
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(text).toBe("ranked headlines json");
    expect(calls.some((c) => c.url.endsWith("/v1/agents") && c.method === "POST")).toBe(
      true,
    );
    expect(
      calls.some((c) => c.url.includes("/archive") && c.method === "POST"),
    ).toBe(true);
  });
});
