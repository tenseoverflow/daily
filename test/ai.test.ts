import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, chatForRanking, describeAiConfig, logTruncatedResponse, shouldRetryCursor } from "../src/ai";
import type { Env } from "../src/types";

function baseEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    AI_PROVIDER: "workers",
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

describe("chatForRanking", () => {
  it("calls workers provider when requested", async () => {
    const mockAI = {
      run: vi.fn(async () => ({ response: "test response" })),
    };
    const env = baseEnv({ AI: mockAI });
    
    const result = await chatForRanking(env, {
      messages: [{ role: "user", content: "rank these" }],
    }, "workers");
    
    expect(result.provider).toBe("workers");
    expect(result.text).toBe("test response");
    expect(mockAI.run).toHaveBeenCalled();
  });
  
  it("calls cursor provider when requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method || "GET").toUpperCase();

        if (url.endsWith("/v1/agents") && method === "POST") {
          return Response.json({
            agent: { id: "bc-rank" },
            run: { id: "run-rank" },
          });
        }

        if (url.includes("/v1/agents/bc-rank/runs/run-rank") && method === "GET") {
          return Response.json({
            status: "FINISHED",
            result: "cursor response",
          });
        }

        if (url.includes("/archive") && method === "POST") {
          return new Response(null, { status: 200 });
        }

        return new Response("unexpected", { status: 500 });
      }),
    );
    
    const result = await chatForRanking(
      baseEnv({ CURSOR_API_KEY: "crsr_test" }),
      { messages: [{ role: "user", content: "rank" }] },
      "cursor",
    );
    
    expect(result.provider).toBe("cursor");
    expect(result.text).toBe("cursor response");
  });
});

describe("shouldRetryCursor", () => {
  it("returns true in auto mode with CURSOR_API_KEY", () => {
    expect(shouldRetryCursor(baseEnv({ AI_PROVIDER: "auto", CURSOR_API_KEY: "crsr_test" }))).toBe(true);
  });
  
  it("returns false in auto mode without CURSOR_API_KEY", () => {
    expect(shouldRetryCursor(baseEnv({ AI_PROVIDER: "auto" }))).toBe(false);
  });
  
  it("returns false in workers mode even with CURSOR_API_KEY", () => {
    expect(shouldRetryCursor(baseEnv({ AI_PROVIDER: "workers", CURSOR_API_KEY: "crsr_test" }))).toBe(false);
  });
  
  it("returns false in cursor mode", () => {
    expect(shouldRetryCursor(baseEnv({ AI_PROVIDER: "cursor", CURSOR_API_KEY: "crsr_test" }))).toBe(false);
  });
});

describe("logTruncatedResponse", () => {
  it("logs truncated response", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const longText = "a".repeat(500);
    
    logTruncatedResponse(longText, "workers");
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("JSON parse failed from workers"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("..."),
    );
    
    consoleSpy.mockRestore();
  });
  
  it("does not add ellipsis for short responses", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shortText = "short response";
    
    logTruncatedResponse(shortText, "cursor");
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("JSON parse failed from cursor"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.not.stringContaining("..."),
    );
    
    consoleSpy.mockRestore();
  });
});
