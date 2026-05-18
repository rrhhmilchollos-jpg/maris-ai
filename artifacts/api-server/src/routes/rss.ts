import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const BASE_URL = "https://maris-ai.shop";

router.get("/rss", async (_req, res) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(20).lean();

    const feedItems = articles.map((article) => `
      <item>
        <title><![CDATA[${article.title}]]></title>
        <link>${BASE_URL}/news/${article.slug}</link>
        <guid isPermaLink="true">${BASE_URL}/news/${article.slug}</guid>
        <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
        <description><![CDATA[${article.metaDescription || article.body.substring(0, 200) + "..."}]]></description>
        ${article.imageUrl ? `<enclosure url="${article.imageUrl}" type="image/jpeg" length="0" />` : ""}
        ${article.author ? `<author><![CDATA[${article.author}]]></author>` : ""}
        ${article.tags.length > 0 ? article.tags.map((tag: string) => `<category><![CDATA[${tag}]]></category>`).join("") : ""}
      </item>`).join("");

    const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Maris AI Noticias</title>
    <link>${BASE_URL}/news</link>
    <description>Las últimas noticias sobre Maris AI, Live Coding y aplicaciones generadas por inteligencia artificial</description>
    <language>es</language>
    <copyright>© ${new Date().getFullYear()} Maris AI Inc.</copyright>
    <managingEditor>hola@maris-ai.shop (Maris AI)</managingEditor>
    <webMaster>hola@maris-ai.shop (Maris AI)</webMaster>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>60</ttl>
    <image>
      <url>${BASE_URL}/logo.svg</url>
      <title>Maris AI Noticias</title>
      <link>${BASE_URL}/news</link>
    </image>
    <atom:link href="${BASE_URL}/rss" rel="self" type="application/rss+xml" />
    ${feedItems}
  </channel>
</rss>`;

    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(rssFeed);
  } catch (err) {
    logger.error("Error generating RSS feed", err);
    res.status(500).send("Error generating feed");
  }
});

export default router;
