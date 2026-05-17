import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/rss", async (_req, res) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(20).lean();

    const feedItems = articles.map((article) => `
      <item>
        <title><![CDATA[${article.title}]]></title>
        <link>https://maris.ai/news/${article.slug}</link>
        <guid>https://maris.ai/news/${article.slug}</guid>
        <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
        <description><![CDATA[${article.metaDescription || article.body.substring(0, 200) + "..."}]]></description>
      </item>`).join("");

    const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
        <channel>
          <title>Maris AI News</title>
          <link>https://maris.ai/news</link>
          <description>Las últimas noticias sobre Live Coding y aplicaciones generadas por Maris AI</description>
          <language>es</language>
          <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
          <atom:link href="https://maris.ai/rss" rel="self" type="application/rss+xml" />
          ${feedItems}
        </channel>
      </rss>`;

    res.set("Content-Type", "application/rss+xml");
    res.send(rssFeed);
  } catch (err) {
    logger.error("Error generating RSS feed", err);
    res.status(500).send("Error generating feed");
  }
});

export default router;
