import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire("/app/artifacts/api-server/package.json");
const puppeteer = require("puppeteer");
const url = process.env.SPAX_PREVIEW_URL || "http://127.0.0.1:3000/api/apps/6a863265e250d114f66ef6f2/preview?pv=18";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
  const opened = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Moderación");
    if (!button) return false;
    button.click();
    return true;
  });
  assert.equal(opened, true, "No se encontró el botón Moderación");
  await page.waitForFunction(() => document.body.innerText.includes("ACCESO DEL EQUIPO") && document.body.innerText.includes("Código de empleado"), { timeout: 10_000 });
  assert.equal(errors.length, 0, `Errores de página: ${errors.join(" | ")}`);
  assert.equal(consoleErrors.length, 0, `Errores de consola: ${consoleErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, checked: ["moderation_button", "team_access", "employee_code_login"], consoleErrors: 0 }));
} finally {
  await browser.close();
}
