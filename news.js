const { XMLParser } = require("fast-xml-parser");
const sourcesConfig = require("./sources.json");

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ITEMS = 60;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "text",
});

const MAX_RESOLVE = 20;
const googleLinkCache = new Map();

const withTimeout = async (promise, ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const result = await promise(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
};

const fetchXml = async (url) => {
  return withTimeout(async (signal) => {
    const res = await fetch(url, { signal, headers: { "User-Agent": "TEN-Dashboard/1.0" } });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
    return res.text();
  }, DEFAULT_TIMEOUT_MS);
};

const decodeHtml = (value = "") =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

const stripHtml = (value = "") => decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

const extractHrefFromHtml = (value = "") => {
  const match = value.match(/href="([^"]+)"/i);
  return match ? decodeHtml(match[1]) : "";
};

const resolveGoogleLink = async (url) => {
  if (!url || !url.includes("news.google.com/rss/articles/")) return url;
  if (googleLinkCache.has(url)) return googleLinkCache.get(url);
  try {
    const res = await withTimeout(async (signal) => {
      const response = await fetch(url, { signal, redirect: "follow", headers: { "User-Agent": "TEN-Dashboard/1.0" } });
      return response;
    }, DEFAULT_TIMEOUT_MS);
    const resolved = res.url || url;
    googleLinkCache.set(url, resolved);
    return resolved;
  } catch {
    return url;
  }
};

const normalizeItem = (item, feedTitle, feedMeta) => {
  const link = item.link?.href || (Array.isArray(item.link) ? item.link[0]?.href : item.link) || item.link?.text || item.link;
  const title = item.title?.text || item.title || "";
  const summaryRaw = item.description?.text || item.description || item.summary?.text || item.summary || "";
  const publishedAt = item.pubDate || item.published || item.updated || item.dcdate || item["dc:date"] || "";
  const source = item.source?.text || item.source || item.author?.name || feedTitle;

  const summaryText = stripHtml(summaryRaw);
  const linkFromSummary = extractHrefFromHtml(summaryRaw);

  return {
    id: item.guid?.text || item.guid || link || title,
    title: stripHtml(title),
    link: linkFromSummary || link,
    summary: summaryText,
    publishedAt,
    source,
    feedTitle,
    country: feedMeta?.country || "🌐",
  };
};

const parseFeed = (xml, feedMeta) => {
  const data = parser.parse(xml);
  if (data.rss?.channel) {
    const channel = data.rss.channel;
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    const feedTitle = channel.title?.text || channel.title || feedMeta?.name || "Source";
    return items.map((item) => normalizeItem(item, feedTitle, feedMeta));
  }

  if (data.feed) {
    const feed = data.feed;
    const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
    const feedTitle = feed.title?.text || feed.title || feedMeta?.name || "Source";
    return entries.map((entry) => normalizeItem(entry, feedTitle, feedMeta));
  }

  return [];
};

const sortByDateDesc = (a, b) => {
  const da = new Date(a.publishedAt || 0).getTime();
  const db = new Date(b.publishedAt || 0).getTime();
  return db - da;
};

exports.handler = async () => {
  try {
    const sources = sourcesConfig.sources || [];

    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          const xml = await fetchXml(source.url);
          return parseFeed(xml, source);
        } catch (error) {
          return [];
        }
      })
    );

    const merged = results.flat();
    const seen = new Set();
    const deduped = [];
    const toResolve = [];

    for (const item of merged) {
      const key = item.link || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (toResolve.length < MAX_RESOLVE) toResolve.push(item);
    }

    await Promise.all(
      toResolve.map(async (item) => {
        item.link = await resolveGoogleLink(item.link);
      })
    );

    const items = deduped.sort(sortByDateDesc).slice(0, MAX_ITEMS);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=15, s-maxage=15",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        items,
        sources: sources.map((s) => s.name),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to fetch feeds",
      }),
    };
  }
};
