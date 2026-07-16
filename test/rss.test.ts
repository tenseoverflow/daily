import { describe, expect, it } from "vitest";
import { parseDelfiHtml, parseRssItems } from "../src/rss";
import type { FeedConfig } from "../src/types";

const aripaev: FeedConfig = {
  id: "aripaev",
  name: "Äripäev",
  url: "https://www.aripaev.ee/rss",
  kind: "rss",
  hosts: ["aripaev.ee"],
};

const delfi: FeedConfig = {
  id: "delfi",
  name: "Delfi",
  url: "https://www.delfi.ee/",
  kind: "html",
  hosts: ["delfi.ee"],
};

describe("parseRssItems", () => {
  it("parses CDATA titles and links", () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[Test headline & more]]></title>
          <link>https://www.aripaev.ee/uudised/2026/07/16/test</link>
          <description><![CDATA[Short blurb]]></description>
          <pubDate>Thu, 16 Jul 2026 12:00:00 +0000</pubDate>
        </item>
      </channel></rss>`;

    const items = parseRssItems(xml, aripaev, 10);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test headline & more");
    expect(items[0].url).toContain("aripaev.ee");
    expect(items[0].description).toBe("Short blurb");
    expect(items[0].publishedAt).toBeTruthy();
  });
});

describe("parseDelfiHtml", () => {
  it("extracts unique article URLs and titles from slugs", () => {
    const html = `
      <a href="https://www.delfi.ee/artikkel/120597724/juhtkiri-tagasitee-peab-igauhele-jaama">x</a>
      <a href="https://arileht.delfi.ee/artikkel/120597692/temu-tellijad-on-sokis">y</a>
      <a href="https://www.delfi.ee/artikkel/120597724/juhtkiri-tagasitee-peab-igauhele-jaama/kommentaarid">z</a>
    `;
    const items = parseDelfiHtml(html, delfi, 10);
    expect(items).toHaveLength(2);
    expect(items[0].title.toLowerCase()).toContain("juhtkiri");
    expect(items.every((i) => !i.url.includes("kommentaarid"))).toBe(true);
  });
});
