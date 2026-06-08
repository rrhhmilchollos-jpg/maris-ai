import { useEffect, useRef } from "react";

/**
 * MatrixBackground — Animación de lluvia de caracteres estilo Matrix.
 * Se renderiza en un <canvas> que ocupa todo el contenedor padre.
 */
export function MatrixBackground({ opacity = 0.85 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CHARS =
      "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
      "0123456789ABCDEF<>{}[]|/\\+-=*#@!?;:.,";

    let animId: number;
    let cols: number;
    let drops: number[];

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cols = Math.floor(canvas.width / 16);
      drops = Array.from({ length: cols }, () => Math.random() * -50);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      // Fade trail
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < cols; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * 16;
        const y = drops[i] * 16;

        // Head glow (bright)
        ctx.font = "bold 13px monospace";
        ctx.fillStyle = "#00ffcc";
        ctx.shadowColor = "#00ffcc";
        ctx.shadowBlur = 8;
        ctx.fillText(char, x, y);

        // Tail (dimmer green)
        ctx.font = "12px monospace";
        ctx.fillStyle = "#00cc66";
        ctx.shadowBlur = 0;
        const tailChar = CHARS[Math.floor(Math.random() * CHARS.length)];
        ctx.fillText(tailChar, x, y - 16);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5;
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ opacity, pointerEvents: "none" }}
    />
  );
}
