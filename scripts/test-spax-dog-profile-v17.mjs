import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire("/app/artifacts/api-server/package.json");
const puppeteer = require("puppeteer");
const url = process.env.SPAX_PREVIEW_URL || "http://127.0.0.1:3000/api/apps/6a863265e250d114f66ef6f2/preview?pv=17";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
  const clickedPhoto = await page.evaluate(() => {
    const photo = document.querySelector('[aria-label="Abrir ficha completa de Luna"]');
    if (!photo) return false;
    photo.click();
    return true;
  });
  assert.equal(clickedPhoto, true, "La foto de Luna no abre su ficha");
  await page.waitForFunction(() => document.body.innerText.includes("FICHA DE ADOPCIÓN") && document.body.innerText.includes("Familia ideal:"), { timeout: 10_000 });
  const hasActions = await page.evaluate(() => [...document.querySelectorAll("button")].map((item) => item.textContent?.trim()).includes("Solicitar adopción") && [...document.querySelectorAll("button")].map((item) => item.textContent?.trim()).includes("Solicitar acogida"));
  assert.equal(hasActions, true, "La ficha no contiene ambas acciones");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Solicitar adopción")?.click());
  await page.waitForFunction(() => document.body.innerText.includes("ADOPCIÓN RESPONSABLE") && document.body.innerText.includes("Conoce a Luna"), { timeout: 10_000 });
  assert.equal(errors.length, 0, errors.join(" | "));
  await page.close();
  console.log(JSON.stringify({ ok: true, checked: ["photo_click", "complete_profile", "adoption_action", "foster_action"] }));
} finally {
  await browser.close();
}
