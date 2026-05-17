/**
 * Maris AI Watermark System
 * 
 * Inyecta una marca de agua discreta pero visible en todos los proyectos generados.
 * Los usuarios pueden eliminar la marca de agua mediante pago en Stripe.
 */

export interface WatermarkConfig {
  enabled: boolean;
  position: "top-right" | "bottom-right" | "bottom-left" | "top-left" | "center";
  opacity: number;
  fontSize: string;
}

const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: true,
  position: "bottom-right",
  opacity: 0.7,
  fontSize: "12px",
};

/**
 * Genera el CSS para la marca de agua
 */
export function generateWatermarkCSS(config: WatermarkConfig = DEFAULT_WATERMARK_CONFIG): string {
  if (!config.enabled) return "";

  const positionStyles = {
    "top-right": "top: 20px; right: 20px;",
    "bottom-right": "bottom: 20px; right: 20px;",
    "bottom-left": "bottom: 20px; left: 20px;",
    "top-left": "top: 20px; left: 20px;",
    "center": "top: 50%; left: 50%; transform: translate(-50%, -50%);",
  };

  return `
    .maris-ai-watermark {
      position: fixed;
      ${positionStyles[config.position]}
      font-size: ${config.fontSize};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #666;
      opacity: ${config.opacity};
      pointer-events: none;
      z-index: 9999;
      background: rgba(255, 255, 255, 0.8);
      padding: 8px 12px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      white-space: nowrap;
      user-select: none;
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    .maris-ai-watermark a {
      color: #0066cc;
      text-decoration: none;
      margin-left: 4px;
    }

    .maris-ai-watermark a:hover {
      text-decoration: underline;
    }

    @media (max-width: 768px) {
      .maris-ai-watermark {
        font-size: 10px;
        padding: 6px 10px;
      }
    }
  `;
}

/**
 * Genera el HTML para la marca de agua
 */
export function generateWatermarkHTML(removeWatermarkUrl?: string): string {
  return `
    <div class="maris-ai-watermark">
      Hecho con <strong>Maris AI</strong>
      ${removeWatermarkUrl ? `<a href="${removeWatermarkUrl}" target="_blank">Eliminar</a>` : ""}
    </div>
  `;
}

/**
 * Inyecta la marca de agua en el HTML generado
 */
export function injectWatermarkToHTML(
  html: string,
  config: WatermarkConfig = DEFAULT_WATERMARK_CONFIG,
  removeWatermarkUrl?: string,
): string {
  if (!config.enabled) return html;

  const watermarkCSS = generateWatermarkCSS(config);
  const watermarkHTML = generateWatermarkHTML(removeWatermarkUrl);

  // Inyectar CSS antes del cierre de </head>
  const headClosing = html.indexOf("</head>");
  if (headClosing !== -1) {
    const cssTag = `<style>${watermarkCSS}</style>`;
    const newHTML =
      html.slice(0, headClosing) + cssTag + html.slice(headClosing);

    // Inyectar HTML antes del cierre de </body>
    const bodyClosing = newHTML.indexOf("</body>");
    if (bodyClosing !== -1) {
      return (
        newHTML.slice(0, bodyClosing) +
        watermarkHTML +
        newHTML.slice(bodyClosing)
      );
    }
  }

  return html;
}

/**
 * Inyecta la marca de agua en React/JSX
 */
export function generateWatermarkReactComponent(removeWatermarkUrl?: string): string {
  return `
// Componente de Marca de Agua de Maris AI
export function MarisAIWatermark() {
  return (
    <div className="maris-ai-watermark">
      Hecho con <strong>Maris AI</strong>
      ${removeWatermarkUrl ? `<a href="${removeWatermarkUrl}" target="_blank">Eliminar</a>` : ""}
    </div>
  );
}
  `;
}

/**
 * Inyecta la marca de agua en el código CSS
 */
export function injectWatermarkToCSS(css: string, config: WatermarkConfig = DEFAULT_WATERMARK_CONFIG): string {
  if (!config.enabled) return css;
  return generateWatermarkCSS(config) + "\n" + css;
}

/**
 * Inyecta la marca de agua en el código JavaScript/TypeScript
 */
export function injectWatermarkToJavaScript(
  js: string,
  removeWatermarkUrl?: string,
): string {
  const watermarkScript = `
// Marca de Agua de Maris AI
(function() {
  const watermark = document.createElement('div');
  watermark.className = 'maris-ai-watermark';
  watermark.innerHTML = 'Hecho con <strong>Maris AI</strong>${
    removeWatermarkUrl ? ` <a href="${removeWatermarkUrl}" target="_blank">Eliminar</a>` : ""
  }';
  document.body.appendChild(watermark);
})();
  `;

  return watermarkScript + "\n" + js;
}

/**
 * Verifica si un proyecto tiene la marca de agua habilitada
 */
export function shouldHaveWatermark(
  appId: string,
  hasRemovedWatermark: boolean,
  isAdmin: boolean,
): boolean {
  // El admin nunca ve marca de agua
  if (isAdmin) return false;

  // Si el usuario ha pagado para eliminar, no mostrar
  if (hasRemovedWatermark) return false;

  // Por defecto, mostrar marca de agua
  return true;
}
