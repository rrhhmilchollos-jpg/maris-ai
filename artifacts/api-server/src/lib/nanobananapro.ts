/**
 * nanobananapro.ts
 * 
 * Integración con NanoBananaPro para generación de imágenes en Maris AI.
 * Permite a los usuarios generar imágenes dentro de sus aplicaciones.
 */

import { logger } from "./logger";

export interface ImageGenerationRequest {
  prompt: string;
  style?: string;
  size?: "256x256" | "512x512" | "1024x1024";
  quality?: "low" | "medium" | "high";
  count?: number;
  seed?: number;
}

export interface ImageGenerationResponse {
  success: boolean;
  images: {
    url: string;
    base64?: string;
    seed: number;
  }[];
  duration: number;
  error?: string;
}

export interface NanoBananaConfig {
  apiKey: string;
  apiUrl: string;
  timeout?: number;
}

class NanoBananaProClient {
  private baseURL: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(config: NanoBananaConfig) {
    this.baseURL = config.apiUrl;
    this.timeout = config.timeout || 60000;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  // Reemplaza el cliente axios — esta librería no estaba en las dependencias
  // del proyecto y este archivo nunca llegó a conectarse a ninguna ruta real
  // (huérfano, igual que mobile.ts). En vez de añadir axios solo para un
  // archivo no usado en producción, se mantiene el mismo comportamiento
  // (baseURL + headers + timeout) con fetch nativo, ya el patrón preferido
  // en el resto del proyecto para clientes HTTP de integraciones externas.
  private async request<T = any>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ data: T }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseURL}${path}`, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`NanoBananaPro request failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as T;
      return { data };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Genera imágenes usando NanoBananaPro
   */
  async generateImages(
    request: ImageGenerationRequest
  ): Promise<ImageGenerationResponse> {
    const startTime = Date.now();

    try {
      logger.info({ prompt: request.prompt }, "Generating image with NanoBananaPro");

      const response = await this.request("POST", "/v1/images/generations", {
        prompt: request.prompt,
        style: request.style || "realistic",
        size: request.size || "512x512",
        quality: request.quality || "medium",
        n: request.count || 1,
        seed: request.seed,
      });

      const images = response.data.data || [];

      logger.info(
        { imagesCount: images.length, duration: Date.now() - startTime },
        "Images generated successfully"
      );

      return {
        success: true,
        images: images.map((img: any) => ({
          url: img.url,
          base64: img.b64_json,
          seed: img.seed || request.seed || 0,
        })),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "Image generation failed");

      return {
        success: false,
        images: [],
        duration: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }

  /**
   * Genera múltiples imágenes en paralelo
   */
  async generateImagesBatch(
    requests: ImageGenerationRequest[]
  ): Promise<ImageGenerationResponse[]> {
    const promises = requests.map((req) => this.generateImages(req));
    return Promise.all(promises);
  }

  /**
   * Genera imagen y la guarda en base64
   */
  async generateImageAsBase64(
    request: ImageGenerationRequest
  ): Promise<string | null> {
    const result = await this.generateImages(request);

    if (!result.success || result.images.length === 0) {
      return null;
    }

    return result.images[0].base64 || null;
  }

  /**
   * Genera imagen y la guarda como archivo
   */
  async generateImageAsFile(
    request: ImageGenerationRequest,
    outputPath: string
  ): Promise<boolean> {
    const result = await this.generateImages(request);

    if (!result.success || result.images.length === 0) {
      return false;
    }

    try {
      const imageUrl = result.images[0].url;
      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        throw new Error(`Failed to download image: ${imageRes.status} ${imageRes.statusText}`);
      }
      const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

      const fs = await import("node:fs").then((m) => m.promises);
      await fs.writeFile(outputPath, imageBuffer);

      logger.info({ outputPath }, "Image saved successfully");
      return true;
    } catch (error) {
      logger.error({ error }, "Failed to save image");
      return false;
    }
  }

  /**
   * Obtiene estilos disponibles
   */
  async getAvailableStyles(): Promise<string[]> {
    try {
      const response = await this.request("GET", "/v1/styles");
      return response.data.styles || [];
    } catch (error) {
      logger.warn({ error }, "Failed to fetch available styles");
      return [
        "realistic",
        "anime",
        "cartoon",
        "oil-painting",
        "watercolor",
        "sketch",
      ];
    }
  }

  /**
   * Obtiene modelos disponibles
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.request("GET", "/v1/models");
      return response.data.models || [];
    } catch (error) {
      logger.warn({ error }, "Failed to fetch available models");
      return ["stable-diffusion-xl", "dall-e-3", "midjourney"];
    }
  }
}

// Singleton instance
let nanobananaClient: NanoBananaProClient | null = null;

/**
 * Inicializa el cliente de NanoBananaPro
 */
export function initializeNanoBanana(config: NanoBananaConfig): void {
  nanobananaClient = new NanoBananaProClient(config);
  logger.info("NanoBananaPro client initialized");
}

/**
 * Obtiene la instancia del cliente
 */
export function getNanoBananaClient(): NanoBananaProClient {
  if (!nanobananaClient) {
    const apiKey = process.env.NANOBANA_API_KEY;
    const apiUrl = process.env.NANOBANA_API_URL || "https://api.nanobana.pro";

    if (!apiKey) {
      throw new Error("NANOBANA_API_KEY environment variable not set");
    }

    nanobananaClient = new NanoBananaProClient({ apiKey, apiUrl });
  }

  return nanobananaClient;
}

/**
 * Genera una imagen con parámetros simples
 */
export async function generateImage(
  prompt: string,
  options?: Partial<ImageGenerationRequest>
): Promise<ImageGenerationResponse> {
  const client = getNanoBananaClient();
  return client.generateImages({
    prompt,
    ...options,
  });
}

/**
 * Genera múltiples imágenes
 */
export async function generateImages(
  prompts: string[],
  options?: Partial<ImageGenerationRequest>
): Promise<ImageGenerationResponse[]> {
  const client = getNanoBananaClient();
  const requests = prompts.map((prompt) => ({
    prompt,
    ...options,
  }));
  return client.generateImagesBatch(requests);
}

/**
 * Integración con el generador de apps
 * Permite insertar imágenes generadas en el código de la app
 */
export async function embedGeneratedImageInApp(
  appCode: string,
  imagePrompt: string,
  imageVariable: string = "generatedImage"
): Promise<string> {
  try {
    const result = await generateImage(imagePrompt);

    if (!result.success || result.images.length === 0) {
      logger.warn({ imagePrompt }, "Failed to generate image for embedding");
      return appCode;
    }

    const imageUrl = result.images[0].url;

    // Insertar la URL de la imagen en el código
    const imageCode = `
// Generated image: ${imagePrompt}
const ${imageVariable} = "${imageUrl}";
    `.trim();

    // Buscar un buen lugar para insertar (después de los imports)
    const importEndIndex = appCode.lastIndexOf("import");
    if (importEndIndex !== -1) {
      const nextNewline = appCode.indexOf("\n", importEndIndex);
      if (nextNewline !== -1) {
        return (
          appCode.slice(0, nextNewline + 1) +
          "\n" +
          imageCode +
          "\n" +
          appCode.slice(nextNewline + 1)
        );
      }
    }

    return appCode + "\n\n" + imageCode;
  } catch (error) {
    logger.error({ error }, "Failed to embed generated image");
    return appCode;
  }
}

/**
 * Genera imágenes para componentes específicos
 */
export async function generateComponentImages(
  componentType: string,
  count: number = 3
): Promise<string[]> {
  const prompts: Record<string, string> = {
    hero: "Beautiful hero section background image, modern design, high quality",
    card: "Minimalist card design background, professional, clean",
    banner: "Eye-catching banner image, vibrant colors, modern",
    thumbnail: "Professional thumbnail image, engaging, high quality",
    icon: "Simple icon design, minimalist, scalable",
    avatar: "Professional avatar image, friendly, approachable",
  };

  const prompt = prompts[componentType] || prompts.card;
  const results = await generateImages(
    Array(count).fill(prompt),
    { size: "512x512" }
  );

  return results
    .filter((r) => r.success)
    .flatMap((r) => r.images.map((img) => img.url));
}

export default {
  initializeNanoBanana,
  getNanoBananaClient,
  generateImage,
  generateImages,
  embedGeneratedImageInApp,
  generateComponentImages,
};
