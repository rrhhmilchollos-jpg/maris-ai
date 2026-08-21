import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire("/app/artifacts/api-server/package.json");
const puppeteer = require("puppeteer");
const url = process.env.SPAX_PREVIEW_URL || "http://127.0.0.1:3000/api/apps/6a863265e250d114f66ef6f2/preview?pv=16";
const routes = ["Acceso equipo", "Voluntariado", "Moderación"];
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  for (const label of routes) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
    const clicked = await page.evaluate((buttonLabel) => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === buttonLabel);
      if (!button) return false;
      button.click();
      return true;
    }, label);
    assert.equal(clicked, true, `No se encontró ${label}`);
    await page.waitForFunction(() => document.body.innerText.includes("Código de empleado"), { timeout: 10_000 });
    const accessUi = await page.evaluate(() => ({
      hasEmailInput: Boolean(document.querySelector('input[type="email"]')),
      codeInput: document.querySelector('input[inputmode="numeric"]')?.getAttribute("pattern"),
      maxLength: document.querySelector('input[inputmode="numeric"]')?.getAttribute("maxlength"),
      text: document.body.innerText,
    }));
    assert.equal(accessUi.hasEmailInput, false, `${label}: sigue visible un campo de correo`);
    assert.equal(accessUi.codeInput, "[0-9]{6}", `${label}: patrón de código incorrecto`);
    assert.equal(accessUi.maxLength, "6", `${label}: longitud de código incorrecta`);
    assert.equal(errors.some((message) => /Minified React error #300|Rendered (more|fewer) hooks/i.test(message)), false, `${label}: ${errors.join(" | ")}`);
    await page.close();
    console.log(`OK: ${label}`);
  }
  console.log(JSON.stringify({ ok: true, routes }));
} finally {
  await browser.close();
}
