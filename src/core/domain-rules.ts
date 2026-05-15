// Tier-1 fast path: hardcoded domain → category mapping. Lookup is O(1)
// with subdomain walk, so 99% of "obvious" tabs (youtube.com, github.com,
// instagram.com, naver.com…) bypass the LLM entirely.
//
// Methodology: curated from the developer's knowledge of top global +
// Korean sites, anchored to roughly Tranco top-500 + Korean major sites.
// To regenerate from a fresh data source:
//   1. Download Tranco top-1k CSV (https://tranco-list.eu).
//   2. Run a one-off script that categorizes each via the Claude API.
//   3. Hand-review and replace DOMAIN_RULES below.
//
// Storage conventions:
//   - lowercase, no www. prefix
//   - bare apex (github.com) or specific subdomain (aws.amazon.com)
//   - the lookup walks subdomains, so `news.ycombinator.com` matches
//     `ycombinator.com` if no specific rule for the news. subdomain
//   - more-specific entries win (aws.amazon.com → code beats
//     amazon.com → shopping)

import type { ChromeGroupColor } from "./types";

export type CategoryKey =
  | "code"
  | "ai"
  | "social"
  | "video"
  | "news"
  | "shopping"
  | "productivity"
  | "finance"
  | "entertainment";

export type RuleLanguage = "en" | "ko";

/** Localized display name for each category. Tier-1 rules don't touch
 * the LLM, so we localize manually here. */
export const CATEGORY_LABELS: Record<CategoryKey, Record<RuleLanguage, string>> = {
  code: { en: "Code", ko: "코드" },
  ai: { en: "AI", ko: "AI" },
  social: { en: "Social", ko: "소셜" },
  video: { en: "Video", ko: "비디오" },
  news: { en: "News", ko: "뉴스" },
  shopping: { en: "Shopping", ko: "쇼핑" },
  productivity: { en: "Productivity", ko: "업무" },
  finance: { en: "Finance", ko: "금융" },
  entertainment: { en: "Entertainment", ko: "엔터테인먼트" },
};

/** Chrome tab-group color assignment per category. Uses all 9 available. */
export const CATEGORY_COLORS: Record<CategoryKey, ChromeGroupColor> = {
  code: "purple",
  ai: "green",
  social: "pink",
  video: "red",
  news: "yellow",
  shopping: "orange",
  productivity: "cyan",
  finance: "blue",
  entertainment: "grey",
};

export interface DomainRule {
  domain: string;
  category: CategoryKey;
}

// ============================================================
// The list
// ============================================================
//
// Notes on multi-topic domains intentionally OMITTED:
//   - google.com / bing.com / duckduckgo.com / yahoo.com — searches span
//     every topic; let the LLM classify by title.
//   - naver.com / daum.net — Korean portals that bundle search, news,
//     mail, maps, shopping, cafes, blogs, finance under one apex. Same
//     reasoning as google.com: let the LLM read the title. We DO list
//     specific naver subdomains that are unambiguously single-topic
//     (mail.naver.com → productivity, finance.naver.com → finance, …).
//   - reddit.com is borderline; left in `social` because most users use
//     it socially.

export const DOMAIN_RULES: ReadonlyArray<DomainRule> = [
  // === Code (purple) ===
  { domain: "github.com", category: "code" },
  { domain: "gitlab.com", category: "code" },
  { domain: "bitbucket.org", category: "code" },
  { domain: "codeberg.org", category: "code" },
  { domain: "gitea.io", category: "code" },
  { domain: "stackoverflow.com", category: "code" },
  { domain: "stackexchange.com", category: "code" },
  { domain: "serverfault.com", category: "code" },
  { domain: "superuser.com", category: "code" },
  { domain: "askubuntu.com", category: "code" },
  { domain: "npmjs.com", category: "code" },
  { domain: "pypi.org", category: "code" },
  { domain: "crates.io", category: "code" },
  { domain: "rubygems.org", category: "code" },
  { domain: "packagist.org", category: "code" },
  { domain: "pkg.go.dev", category: "code" },
  { domain: "hex.pm", category: "code" },
  { domain: "developer.mozilla.org", category: "code" },
  { domain: "developer.chrome.com", category: "code" },
  { domain: "developer.apple.com", category: "code" },
  { domain: "developer.android.com", category: "code" },
  { domain: "docs.python.org", category: "code" },
  { domain: "doc.rust-lang.org", category: "code" },
  { domain: "go.dev", category: "code" },
  { domain: "golang.org", category: "code" },
  { domain: "typescriptlang.org", category: "code" },
  { domain: "react.dev", category: "code" },
  { domain: "reactjs.org", category: "code" },
  { domain: "vuejs.org", category: "code" },
  { domain: "angular.io", category: "code" },
  { domain: "angular.dev", category: "code" },
  { domain: "svelte.dev", category: "code" },
  { domain: "solidjs.com", category: "code" },
  { domain: "qwik.dev", category: "code" },
  { domain: "nextjs.org", category: "code" },
  { domain: "nuxt.com", category: "code" },
  { domain: "remix.run", category: "code" },
  { domain: "gatsbyjs.com", category: "code" },
  { domain: "tailwindcss.com", category: "code" },
  { domain: "getbootstrap.com", category: "code" },
  { domain: "mui.com", category: "code" },
  { domain: "chakra-ui.com", category: "code" },
  { domain: "nodejs.org", category: "code" },
  { domain: "deno.com", category: "code" },
  { domain: "bun.sh", category: "code" },
  { domain: "vitejs.dev", category: "code" },
  { domain: "webpack.js.org", category: "code" },
  { domain: "rollupjs.org", category: "code" },
  { domain: "esbuild.github.io", category: "code" },
  { domain: "jestjs.io", category: "code" },
  { domain: "vitest.dev", category: "code" },
  { domain: "playwright.dev", category: "code" },
  { domain: "cypress.io", category: "code" },
  { domain: "docker.com", category: "code" },
  { domain: "kubernetes.io", category: "code" },
  { domain: "helm.sh", category: "code" },
  { domain: "postgresql.org", category: "code" },
  { domain: "mysql.com", category: "code" },
  { domain: "mariadb.org", category: "code" },
  { domain: "mongodb.com", category: "code" },
  { domain: "redis.io", category: "code" },
  { domain: "sqlite.org", category: "code" },
  { domain: "neo4j.com", category: "code" },
  { domain: "supabase.com", category: "code" },
  { domain: "firebase.google.com", category: "code" },
  { domain: "planetscale.com", category: "code" },
  { domain: "neon.tech", category: "code" },
  { domain: "vercel.com", category: "code" },
  { domain: "netlify.com", category: "code" },
  { domain: "render.com", category: "code" },
  { domain: "fly.io", category: "code" },
  { domain: "railway.app", category: "code" },
  { domain: "heroku.com", category: "code" },
  { domain: "cloudflare.com", category: "code" },
  { domain: "digitalocean.com", category: "code" },
  { domain: "linode.com", category: "code" },
  { domain: "hetzner.com", category: "code" },
  { domain: "aws.amazon.com", category: "code" },
  { domain: "cloud.google.com", category: "code" },
  { domain: "console.cloud.google.com", category: "code" },
  { domain: "portal.azure.com", category: "code" },
  { domain: "replit.com", category: "code" },
  { domain: "codesandbox.io", category: "code" },
  { domain: "stackblitz.com", category: "code" },
  { domain: "codepen.io", category: "code" },
  { domain: "jsfiddle.net", category: "code" },
  { domain: "leetcode.com", category: "code" },
  { domain: "hackerrank.com", category: "code" },
  { domain: "codewars.com", category: "code" },
  { domain: "freecodecamp.org", category: "code" },
  { domain: "arxiv.org", category: "code" },

  // === AI (green) ===
  { domain: "claude.ai", category: "ai" },
  { domain: "claude.com", category: "ai" },
  { domain: "anthropic.com", category: "ai" },
  { domain: "chatgpt.com", category: "ai" },
  { domain: "chat.openai.com", category: "ai" },
  { domain: "openai.com", category: "ai" },
  { domain: "platform.openai.com", category: "ai" },
  { domain: "gemini.google.com", category: "ai" },
  { domain: "aistudio.google.com", category: "ai" },
  { domain: "ai.google.dev", category: "ai" },
  { domain: "perplexity.ai", category: "ai" },
  { domain: "huggingface.co", category: "ai" },
  { domain: "mistral.ai", category: "ai" },
  { domain: "cohere.com", category: "ai" },
  { domain: "groq.com", category: "ai" },
  { domain: "ollama.com", category: "ai" },
  { domain: "ollama.ai", category: "ai" },
  { domain: "replicate.com", category: "ai" },
  { domain: "runwayml.com", category: "ai" },
  { domain: "midjourney.com", category: "ai" },
  { domain: "stability.ai", category: "ai" },
  { domain: "elevenlabs.io", category: "ai" },
  { domain: "character.ai", category: "ai" },
  { domain: "v0.dev", category: "ai" },
  { domain: "cursor.com", category: "ai" },
  { domain: "cursor.sh", category: "ai" },

  // === Social (pink) ===
  { domain: "facebook.com", category: "social" },
  { domain: "fb.com", category: "social" },
  { domain: "instagram.com", category: "social" },
  { domain: "twitter.com", category: "social" },
  { domain: "x.com", category: "social" },
  { domain: "threads.net", category: "social" },
  { domain: "tiktok.com", category: "social" },
  { domain: "linkedin.com", category: "social" },
  { domain: "reddit.com", category: "social" },
  { domain: "pinterest.com", category: "social" },
  { domain: "snapchat.com", category: "social" },
  { domain: "tumblr.com", category: "social" },
  { domain: "mastodon.social", category: "social" },
  { domain: "bsky.app", category: "social" },
  { domain: "discord.com", category: "social" },
  { domain: "telegram.org", category: "social" },
  { domain: "whatsapp.com", category: "social" },
  { domain: "weibo.com", category: "social" },
  { domain: "band.us", category: "social" },
  { domain: "cafe.naver.com", category: "social" },

  // === Video (red) ===
  { domain: "youtube.com", category: "video" },
  { domain: "youtu.be", category: "video" },
  { domain: "netflix.com", category: "video" },
  { domain: "hulu.com", category: "video" },
  { domain: "disneyplus.com", category: "video" },
  { domain: "primevideo.com", category: "video" },
  { domain: "hbomax.com", category: "video" },
  { domain: "max.com", category: "video" },
  { domain: "peacocktv.com", category: "video" },
  { domain: "paramountplus.com", category: "video" },
  { domain: "appletv.com", category: "video" },
  { domain: "twitch.tv", category: "video" },
  { domain: "kick.com", category: "video" },
  { domain: "vimeo.com", category: "video" },
  { domain: "watcha.com", category: "video" },
  { domain: "wavve.com", category: "video" },
  { domain: "tving.com", category: "video" },
  { domain: "coupangplay.com", category: "video" },
  { domain: "bilibili.com", category: "video" },
  { domain: "niconico.jp", category: "video" },

  // === News (yellow) ===
  { domain: "nytimes.com", category: "news" },
  { domain: "washingtonpost.com", category: "news" },
  { domain: "wsj.com", category: "news" },
  { domain: "bbc.com", category: "news" },
  { domain: "bbc.co.uk", category: "news" },
  { domain: "cnn.com", category: "news" },
  { domain: "foxnews.com", category: "news" },
  { domain: "reuters.com", category: "news" },
  { domain: "apnews.com", category: "news" },
  { domain: "npr.org", category: "news" },
  { domain: "bloomberg.com", category: "news" },
  { domain: "ft.com", category: "news" },
  { domain: "economist.com", category: "news" },
  { domain: "theguardian.com", category: "news" },
  { domain: "news.ycombinator.com", category: "news" },
  { domain: "ycombinator.com", category: "news" },
  { domain: "techcrunch.com", category: "news" },
  { domain: "theverge.com", category: "news" },
  { domain: "arstechnica.com", category: "news" },
  { domain: "wired.com", category: "news" },
  { domain: "engadget.com", category: "news" },
  { domain: "gizmodo.com", category: "news" },
  { domain: "9to5mac.com", category: "news" },
  { domain: "9to5google.com", category: "news" },
  { domain: "macrumors.com", category: "news" },
  { domain: "medium.com", category: "news" },
  { domain: "substack.com", category: "news" },
  // naver.com / daum.net apex deliberately NOT listed (multi-topic;
  // see file header). Specific subdomains below.
  { domain: "news.naver.com", category: "news" },
  { domain: "chosun.com", category: "news" },
  { domain: "donga.com", category: "news" },
  { domain: "hani.co.kr", category: "news" },
  { domain: "joongang.co.kr", category: "news" },
  { domain: "mk.co.kr", category: "news" },
  { domain: "hankyung.com", category: "news" },
  { domain: "ohmynews.com", category: "news" },
  { domain: "kbs.co.kr", category: "news" },
  { domain: "mbc.co.kr", category: "news" },
  { domain: "sbs.co.kr", category: "news" },
  { domain: "ytn.co.kr", category: "news" },

  // === Shopping (orange) ===
  { domain: "amazon.com", category: "shopping" },
  { domain: "amazon.co.uk", category: "shopping" },
  { domain: "amazon.co.jp", category: "shopping" },
  { domain: "amazon.de", category: "shopping" },
  { domain: "ebay.com", category: "shopping" },
  { domain: "aliexpress.com", category: "shopping" },
  { domain: "etsy.com", category: "shopping" },
  { domain: "walmart.com", category: "shopping" },
  { domain: "target.com", category: "shopping" },
  { domain: "costco.com", category: "shopping" },
  { domain: "bestbuy.com", category: "shopping" },
  { domain: "ikea.com", category: "shopping" },
  { domain: "apple.com", category: "shopping" },
  { domain: "rakuten.co.jp", category: "shopping" },
  { domain: "11st.co.kr", category: "shopping" },
  { domain: "gmarket.co.kr", category: "shopping" },
  { domain: "auction.co.kr", category: "shopping" },
  { domain: "coupang.com", category: "shopping" },
  { domain: "ssg.com", category: "shopping" },
  { domain: "lotteon.com", category: "shopping" },
  { domain: "oliveyoung.co.kr", category: "shopping" },
  { domain: "kakaomakers.com", category: "shopping" },
  { domain: "smartstore.naver.com", category: "shopping" },
  { domain: "shopping.naver.com", category: "shopping" },

  // === Productivity (cyan) ===
  { domain: "notion.so", category: "productivity" },
  { domain: "notion.com", category: "productivity" },
  { domain: "figma.com", category: "productivity" },
  { domain: "miro.com", category: "productivity" },
  { domain: "mural.co", category: "productivity" },
  { domain: "lucidchart.com", category: "productivity" },
  { domain: "slack.com", category: "productivity" },
  { domain: "trello.com", category: "productivity" },
  { domain: "asana.com", category: "productivity" },
  { domain: "monday.com", category: "productivity" },
  { domain: "linear.app", category: "productivity" },
  { domain: "atlassian.com", category: "productivity" },
  { domain: "airtable.com", category: "productivity" },
  { domain: "docs.google.com", category: "productivity" },
  { domain: "drive.google.com", category: "productivity" },
  { domain: "sheets.google.com", category: "productivity" },
  { domain: "slides.google.com", category: "productivity" },
  { domain: "calendar.google.com", category: "productivity" },
  { domain: "meet.google.com", category: "productivity" },
  { domain: "mail.google.com", category: "productivity" },
  { domain: "office.com", category: "productivity" },
  { domain: "outlook.live.com", category: "productivity" },
  { domain: "outlook.office.com", category: "productivity" },
  { domain: "onedrive.live.com", category: "productivity" },
  { domain: "teams.microsoft.com", category: "productivity" },
  { domain: "dropbox.com", category: "productivity" },
  { domain: "box.com", category: "productivity" },
  { domain: "1password.com", category: "productivity" },
  { domain: "bitwarden.com", category: "productivity" },
  { domain: "calendly.com", category: "productivity" },
  { domain: "cal.com", category: "productivity" },
  { domain: "canva.com", category: "productivity" },
  { domain: "evernote.com", category: "productivity" },
  { domain: "obsidian.md", category: "productivity" },
  { domain: "kakaowork.com", category: "productivity" },
  { domain: "dooray.com", category: "productivity" },
  { domain: "mail.naver.com", category: "productivity" },

  // === Finance (blue) ===
  { domain: "chase.com", category: "finance" },
  { domain: "bankofamerica.com", category: "finance" },
  { domain: "wellsfargo.com", category: "finance" },
  { domain: "citi.com", category: "finance" },
  { domain: "capitalone.com", category: "finance" },
  { domain: "coinbase.com", category: "finance" },
  { domain: "binance.com", category: "finance" },
  { domain: "kraken.com", category: "finance" },
  { domain: "gemini.com", category: "finance" },
  { domain: "robinhood.com", category: "finance" },
  { domain: "fidelity.com", category: "finance" },
  { domain: "schwab.com", category: "finance" },
  { domain: "vanguard.com", category: "finance" },
  { domain: "paypal.com", category: "finance" },
  { domain: "venmo.com", category: "finance" },
  { domain: "stripe.com", category: "finance" },
  { domain: "wise.com", category: "finance" },
  { domain: "revolut.com", category: "finance" },
  { domain: "kbstar.com", category: "finance" },
  { domain: "shinhan.com", category: "finance" },
  { domain: "wooribank.com", category: "finance" },
  { domain: "hanabank.com", category: "finance" },
  { domain: "kebhana.com", category: "finance" },
  { domain: "nh-bank.com", category: "finance" },
  { domain: "ibk.co.kr", category: "finance" },
  { domain: "toss.im", category: "finance" },
  { domain: "tossbank.com", category: "finance" },
  { domain: "kakaobank.com", category: "finance" },
  { domain: "kbanknow.com", category: "finance" },
  { domain: "upbit.com", category: "finance" },
  { domain: "bithumb.com", category: "finance" },
  { domain: "finance.naver.com", category: "finance" },
  { domain: "pay.naver.com", category: "finance" },

  // === Entertainment (grey) ===
  { domain: "spotify.com", category: "entertainment" },
  { domain: "music.apple.com", category: "entertainment" },
  { domain: "soundcloud.com", category: "entertainment" },
  { domain: "bandcamp.com", category: "entertainment" },
  { domain: "deezer.com", category: "entertainment" },
  { domain: "tidal.com", category: "entertainment" },
  { domain: "store.steampowered.com", category: "entertainment" },
  { domain: "steampowered.com", category: "entertainment" },
  { domain: "epicgames.com", category: "entertainment" },
  { domain: "gog.com", category: "entertainment" },
  { domain: "imdb.com", category: "entertainment" },
  { domain: "rottentomatoes.com", category: "entertainment" },
  { domain: "letterboxd.com", category: "entertainment" },
  { domain: "goodreads.com", category: "entertainment" },
  { domain: "melon.com", category: "entertainment" },
  { domain: "genie.co.kr", category: "entertainment" },
  { domain: "bugs.co.kr", category: "entertainment" },
  { domain: "vibe.naver.com", category: "entertainment" },
];

// ============================================================
// Lookup
// ============================================================

const ruleMap = new Map<string, CategoryKey>();
for (const r of DOMAIN_RULES) {
  ruleMap.set(normalizeDomain(r.domain), r.category);
}

function normalizeDomain(domain: string): string {
  const lower = domain.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

export interface DomainRuleMatch {
  category: CategoryKey;
  categoryName: string;
  color: ChromeGroupColor;
}

/**
 * Look up a domain against the rules table. Walks subdomains from most
 * specific to least, so:
 *   docs.github.com → checks docs.github.com, then github.com → match
 *   abc.xyz        → checks abc.xyz, then xyz → no match
 *
 * Returns null when nothing matches; callers fall through to LLM.
 */
export function matchDomainRule(
  domain: string,
  language: RuleLanguage = "en",
): DomainRuleMatch | null {
  let candidate = normalizeDomain(domain);
  while (candidate.length > 0) {
    const category = ruleMap.get(candidate);
    if (category) {
      return {
        category,
        categoryName: CATEGORY_LABELS[category][language],
        color: CATEGORY_COLORS[category],
      };
    }
    const dotIdx = candidate.indexOf(".");
    if (dotIdx === -1) break;
    candidate = candidate.slice(dotIdx + 1);
  }
  return null;
}
