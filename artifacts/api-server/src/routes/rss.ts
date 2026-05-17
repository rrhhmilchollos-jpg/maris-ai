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
        <description><![CDATA[${article.metaDescription || article.body.substring(0, 200) + 
