import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DOMAIN_RULES,
  matchDomainRule,
} from "../../src/core/domain-rules";

describe("domain-rules table", () => {
  it("has no duplicate domains", () => {
    const seen = new Set<string>();
    for (const r of DOMAIN_RULES) {
      const key = r.domain.toLowerCase();
      expect(seen.has(key), `duplicate: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("every category in the table has labels + a color", () => {
    for (const r of DOMAIN_RULES) {
      expect(CATEGORY_LABELS[r.category]).toBeDefined();
      expect(CATEGORY_LABELS[r.category].en).toBeTruthy();
      expect(CATEGORY_LABELS[r.category].ko).toBeTruthy();
      expect(CATEGORY_COLORS[r.category]).toBeDefined();
    }
  });
});

describe("matchDomainRule", () => {
  it("matches a bare apex domain", () => {
    const m = matchDomainRule("github.com");
    expect(m).toMatchObject({
      category: "code",
      categoryName: "Code",
      color: "purple",
    });
  });

  it("returns Korean label when language=ko", () => {
    const m = matchDomainRule("github.com", "ko");
    expect(m?.categoryName).toBe("코드");
  });

  it("strips www. prefix", () => {
    const a = matchDomainRule("www.github.com");
    expect(a?.category).toBe("code");
  });

  it("normalizes case", () => {
    expect(matchDomainRule("GitHub.com")?.category).toBe("code");
    expect(matchDomainRule("WWW.GITHUB.COM")?.category).toBe("code");
  });

  it("walks subdomains so foo.github.com matches github.com", () => {
    expect(matchDomainRule("docs.github.com")?.category).toBe("code");
    expect(matchDomainRule("api.github.com")?.category).toBe("code");
    expect(matchDomainRule("raw.githubusercontent.com")).toBeNull(); // not in list
  });

  it("prefers more-specific entries over the apex", () => {
    // aws.amazon.com → code; amazon.com → shopping. The walk hits aws.amazon.com first.
    expect(matchDomainRule("aws.amazon.com")?.category).toBe("code");
    expect(matchDomainRule("amazon.com")?.category).toBe("shopping");
    expect(matchDomainRule("smile.amazon.com")?.category).toBe("shopping"); // walks up
  });

  it("returns null for unknown domains", () => {
    expect(matchDomainRule("example.com")).toBeNull();
    expect(matchDomainRule("totally-not-a-real-tld.zzz")).toBeNull();
  });

  it("intentionally does NOT match google.com (multi-topic)", () => {
    // We don't classify google.com because searches span every category.
    expect(matchDomainRule("google.com")).toBeNull();
  });

  it("does match specific Google subdomains we control", () => {
    expect(matchDomainRule("docs.google.com")?.category).toBe("productivity");
    expect(matchDomainRule("mail.google.com")?.category).toBe("productivity");
    expect(matchDomainRule("gemini.google.com")?.category).toBe("ai");
    expect(matchDomainRule("aistudio.google.com")?.category).toBe("ai");
  });

  it("covers Korean major sites", () => {
    expect(matchDomainRule("naver.com")?.category).toBe("news");
    expect(matchDomainRule("coupang.com")?.category).toBe("shopping");
    expect(matchDomainRule("kakaobank.com")?.category).toBe("finance");
    expect(matchDomainRule("melon.com")?.category).toBe("entertainment");
  });

  it("each category color matches CATEGORY_COLORS for any rule", () => {
    const samples: Array<{ domain: string; expectedColor: string }> = [
      { domain: "github.com", expectedColor: "purple" },
      { domain: "claude.ai", expectedColor: "green" },
      { domain: "instagram.com", expectedColor: "pink" },
      { domain: "youtube.com", expectedColor: "red" },
      { domain: "nytimes.com", expectedColor: "yellow" },
      { domain: "amazon.com", expectedColor: "orange" },
      { domain: "notion.so", expectedColor: "cyan" },
      { domain: "coinbase.com", expectedColor: "blue" },
      { domain: "spotify.com", expectedColor: "grey" },
    ];
    for (const s of samples) {
      expect(matchDomainRule(s.domain)?.color).toBe(s.expectedColor);
    }
  });
});
