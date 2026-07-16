import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, describeAiConfig } from "../src/ai";
import type { Env } from "../src/types";

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "llama3.1",
    ...overrides,
  } as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("describeAiConfig", () => {
  it("exposes provider and ollama defaults", () => {
    const cfg = describeAiConfig(baseEnv({ AI_PROVIDER: "auto" }));
    expect(cfg.provider).toBe("auto");
    expect(cfg.ollamaBaseUrl).toBe("http://127.0.0.1:11434");
    expect(cfg.ollamaModel).toBe("llama3.1");
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
