import { useRef, useState, useCallback, type ClipboardEvent } from "react";
import { Plus, X, Loader2, Image as ImageIcon, FileText, FileJson, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * Metadata describing one successfully-uploaded attachment, as returned by
 * POST /api/uploads. Kept narrow on purpose — the bytes themselves live on
 * the server; the UI only needs the id (to send back with the prompt) plus
 * enough metadata to render a chip.
 */
export interface UploadedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  /** Local object URL used for the preview thumbnail. Revoked on remove. */
  previewUrl?: string;
}

// Acepta todo — el antivirus del servidor filtra lo malicioso
const ACCEPT_ATTR = "*/*";

type AttachmentToast = (options: {
  title: string;
  description?: string;
  variant?: "destructive";
}) => void;

/**
 * Sube archivos al endpoint común de adjuntos y devuelve la lista actualizada.
 * Se comparte entre el selector de archivos y el pegado desde el portapapeles
 * para que ambas rutas tengan exactamente los mismos límites y validaciones.
 */
export async function uploadAttachmentFiles(
  files: FileList | File[] | null,
  attachments: UploadedAttachment[],
  toast: AttachmentToast,
): Promise<UploadedAttachment[]> {
  if (!files || files.length === 0) return attachments;

  // Hard cap: 10 attachments per message (matches the server-side cap).
  const room = Math.max(0, 10 - attachments.length);
  const list = Array.from(files).slice(0, room);
  if (list.length === 0) {
    toast({
      title: "Demasiados archivos",
      description: "Máximo 10 archivos por mensaje.",
      variant: "destructive",
    });
    return attachments;
  }

  const next = [...attachments];
  for (const file of list) {
    try {
      const fd = new FormData();
      // Algunas capturas del sistema operativo llegan sin nombre.
      // Asignar uno estable evita que el backend rechace el multipart.
      const filename = file.name || `captura-${Date.now()}.png`;
      fd.append("file", file, filename);
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "No pude subir el archivo.";
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch {
          /* ignore */
        }
        toast({
          title: `Error con ${filename}`,
          description: msg,
          variant: "destructive",
        });
        continue;
      }
      const body = (await res.json()) as {
        id: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        isImage: boolean;
        isVideo?: boolean;
      };
      // Build a local preview URL for images/videos so the chip shows the
      // screenshot instantly without a round-trip to /api/uploads/:id.
      const previewUrl = (body.isImage || body.isVideo) ? URL.createObjectURL(file) : undefined;
      next.push({ ...body, previewUrl });
    } catch (err) {
      toast({
        title: `Error con ${file.name || "la captura"}`,
        description: err instanceof Error ? err.message : "Fallo de red.",
        variant: "destructive",
      });
    }
  }
  return next;
}

/**
 * Permite pegar una captura de pantalla directamente sobre un textarea.
 * Los pegados de texto siguen comportándose de forma nativa; solo se
 * intercepta el evento cuando el portapapeles contiene una imagen.
 */
export function useAttachmentPaste({
  attachments,
  onChange,
  disabled = false,
}: {
  attachments: UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [uploadingPaste, setUploadingPaste] = useState(false);

  return useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled || uploadingPaste) return;
      const pastedImages = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (pastedImages.length === 0) return;

      event.preventDefault();
      setUploadingPaste(true);
      try {
        const next = await uploadAttachmentFiles(pastedImages, attachments, toast);
        onChange(next);
      } finally {
        setUploadingPaste(false);
      }
    },
    [attachments, disabled, onChange, toast, uploadingPaste],
  );
}

const isVideoMime = (mime: string) => mime.startsWith("video/");
const isImageMime = (mime: string) => mime.startsWith("image/");
const isTextMime  = (mime: string) => mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
const isPdfMime   = (mime: string) => mime === "application/pdf";

/**
 * The "+" picker that lives inside a chat input. Lets the user attach images,
 * PDFs, or text/CSV/JSON files from their PC or phone. On mobile, the native
 * file picker offers camera capture for image MIME types automatically — we
 * deliberately do NOT set `capture` because that limits the picker to just
 * the camera and hides the gallery / filesystem.
 */
export function AttachmentPicker({
  attachments,
  onChange,
  disabled,
  size = "icon",
  testIdPrefix = "attachment",
}: {
  attachments: UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
  disabled?: boolean;
  size?: "icon" | "sm";
  testIdPrefix?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const openPicker = useCallback(() => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  }, [disabled, uploading]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        const next = await uploadAttachmentFiles(files, attachments, toast);
        onChange(next);
      } finally {
        setUploading(false);
      }
      // Reset the input so re-selecting the same file fires `change` again.
      if (inputRef.current) inputRef.current.value = "";
    },
    [attachments, onChange, toast],
  );

  const removeAt = useCallback(
    (id: string) => {
      const removed = attachments.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      onChange(attachments.filter((a) => a.id !== id));
    },
    [attachments, onChange],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid={`${testIdPrefix}-input`}
      />
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={openPicker}
        disabled={disabled || uploading}
        title="Adjuntar archivo o foto — también puedes pegar una captura con Ctrl/Cmd+V"
        aria-label="Adjuntar archivo o foto"
        className="text-muted-foreground hover:text-foreground"
        data-testid={`${testIdPrefix}-button`}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </Button>
    </>
  );
}

/**
 * The chip strip that renders above the textarea. Pulled out so both the
 * dashboard and app-detail can render it consistently without copy-pasting
 * 40 lines of JSX. Renders nothing when the list is empty.
 */
export function AttachmentChips({
  attachments,
  onRemove,
  testIdPrefix = "attachment",
}: {
  attachments: UploadedAttachment[];
  onRemove: (id: string) => void;
  testIdPrefix?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-2 px-1"
      data-testid={`${testIdPrefix}-chips`}
    >
      {attachments.map((a: any) => (
        <div
          key={a.id}
          className="group flex items-center gap-2 rounded-md border border-border/60 bg-background/50 pl-2 pr-1 py-1 text-xs"
          data-testid={`${testIdPrefix}-chip-${a.id}`}
        >
          {a.isImage && a.previewUrl ? (
            <img src={a.previewUrl} alt={a.filename} className="h-8 w-8 rounded object-cover" />
          ) : (a as any).isVideo && a.previewUrl ? (
            <video src={a.previewUrl} className="h-8 w-8 rounded object-cover" muted playsInline />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
              {iconFor(a.mimeType)}
            </span>
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate max-w-[160px] font-medium">{a.filename}</span>
            <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Quitar ${a.filename}`}
            data-testid={`${testIdPrefix}-chip-remove-${a.id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  if (mime.startsWith("video/")) return <span className="text-[10px]">🎬</span>;
  if (mime === "application/json" || mime === "application/xml") return <FileJson className="h-4 w-4" />;
  if (mime.startsWith("text/")) return <FileText className="h-4 w-4" />;
  if (mime === "application/pdf") return <span className="text-[10px]">📄</span>;
  if (mime.includes("word") || mime.includes("document")) return <span className="text-[10px]">📝</span>;
  if (mime.includes("sheet") || mime.includes("excel")) return <span className="text-[10px]">📊</span>;
  if (mime.includes("presentation") || mime.includes("powerpoint")) return <span className="text-[10px]">📊</span>;
  if (mime === "application/zip") return <span className="text-[10px]">🗜️</span>;
  return <FileIcon className="h-4 w-4" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
