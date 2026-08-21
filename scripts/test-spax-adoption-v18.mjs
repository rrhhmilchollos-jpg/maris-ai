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

  const photo = await page.$('[aria-label="Abrir ficha completa de Luna"]');
  assert.ok(photo, "La foto de Luna no abre la ficha completa");
  await photo.click();
  await page.waitForFunction(() => document.body.innerText.includes("FICHA DE ADOPCIÓN") && document.body.innerText.includes("Familia ideal:"), { timeout: 10_000 });

  const adopted = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Solicitar adopción");
    if (!button) return false;
    button.click();
    return true;
  });
  assert.equal(adopted, true, "No se pudo iniciar la solicitud desde la ficha");
  await page.waitForFunction(() => document.body.innerText.includes("ADOPCIÓN RESPONSABLE") && document.body.innerText.includes("Conoce a Luna"), { timeout: 10_000 });

  const inputs = await page.$$("input");
  await inputs[0].type("Prueba Adopción");
  await inputs[1].type("600000000");
  await inputs[2].type("prueba.adopcion@example.invalid");
  await page.$eval("textarea", (node) => { node.value = "Prueba funcional de formulario. La información real debe revisarla SPAX."; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Enviar solicitud")?.click());
  await page.waitForFunction(() => document.body.innerText.includes("SOLICITUD RECIBIDA") && document.body.innerText.includes("Gracias por interesarte por Luna"), { timeout: 10_000 });

  assert.equal(errors.length, 0, `Errores de página: ${errors.join(" | ")}`);
  assert.equal(consoleErrors.length, 0, `Errores de consola: ${consoleErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, checked: ["dog_photo", "profile", "adoption_form", "success_message"], consoleErrors: 0 }));
} finally {
  await browser.close();
}
