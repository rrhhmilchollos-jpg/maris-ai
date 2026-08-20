import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire("/app/artifacts/api-server/package.json");
const puppeteer = require("puppeteer");
const url = process.env.SPAX_PREVIEW_URL || "http://127.0.0.1:3000/api/apps/6a863265e250d114f66ef6f2/preview?pv=15";
const cases = [
  { button: "Quiénes somos", expected: "Desde 1985, protección animal con compromiso local." },
  { button: "Voluntariado", expected: "Identificación profesional" },
  { button: "Moderación", expected: "Identificación profesional" },
];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  for (const test of cases) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
    const clicked = await page.evaluate((label) => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
      if (!button) return false;
      button.click();
      return true;
    }, test.button);
    assert.equal(clicked, true, `No se encontró el botón ${test.button}`);
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 10_000 }, test.expected);
    assert.equal(pageErrors.some((message) => /Minified React error #300|Rendered (more|fewer) hooks/i.test(message)), false, `${test.button}: ${pageErrors.join(" | ")}`);
    await page.close();
    console.log(`OK: ${test.button}`);
  }
  console.log(JSON.stringify({ ok: true, cases: cases.map((item) => item.button) }));
} finally {
  await browser.close();
}
