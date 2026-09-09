import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, describeAiConfig } from "../src/ai";
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
