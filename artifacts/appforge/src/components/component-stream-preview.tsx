/**
 * ComponentStreamPreview — Maris AI Real-Time Component Streaming
 *
 * Shows the app being built component by component in real time.
 * As the backend streams each file, this component renders a live
 * visual skeleton that progressively fills in with the actual component names,
 * file paths, and a progress indicator per component.
 *
 * This creates the "magic" feeling of watching the AI build your app live,
 * similar to emergent.sh but with richer per-component metadata.
 */

import React, { useEffect, useState, useRef } from "react";
import { Code2, CheckCircle2, Loader2, Cpu, Layers, FileCode2, Palette, TestTube2, Wrench, Database, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StreamedComponent {
  id: string;
  name: string;
  filePath: string;
  category: "page" | "component" | "hook" | "util" | "style" | "config" | "backend" | "test";
  status: "pending" | "streaming" | "done";
  linesOfCode?: number;
  fromCache?: boolean;
}

interface ComponentStreamPreviewProps {
  components: StreamedComponent[];
  isActive: boolean;
  currentPhase?: string;
  totalComponents?: number;
  className?: string;
}

const CATEGORY_ICONS: Record<StreamedComponent["category"], React.ElementType> = {
  page: Layers,
  component: Code2,
  hook: Cpu,
  util: Wrench,
  style: Palette,
  config: FileCode2,
  backend: Database,
  test: TestTube2,
};

const CATEGORY_COLORS: Record<StreamedComponent["category"], string> = {
  page: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  component: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  hook: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  util: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  style: "text-pink-400 bg-pink-500/10 border-pink-500/20",
  config: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  backend: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  test: "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

/**
 * Parse a frontend code bundle into StreamedComponent list.
 * Used to reconstruct the component list from a completed generation.
 */
export function parseComponentsFromBundle(frontendCode: string): StreamedComponent[] {
  const fileRegex = /\/\/ === FILE: ([^\s]+) ===/g;
  const components: StreamedComponent[] = [];
  let match;
  let idx = 0;
  while ((match = fileRegex.exec(frontendCode)) !== null) {
    const filePath = match[1];
    const category = detectCategoryFromPath(filePath);
    const name = extractNameFromPath(filePath);
    // Count lines of code for this file
    const nextMatch = fileRegex.exec(frontendCode);
    const endIdx = nextMatch ? nextMatch.index : frontendCode.length;
    fileRegex.lastIndex = nextMatch ? nextMatch.index : frontendCode.length;
    const fileContent = frontendCode.slice(match.index, endIdx);
    const linesOfCode = fileContent.split("\n").length;
    components.push({
      id: `comp-${idx++}`,
      name,
      filePath,
      category,
      status: "done",
      linesOfCode,
      fromCache: false,
    });
    if (!nextMatch) break;
  }
  return components;
}

function detectCategoryFromPath(filePath: string): StreamedComponent["category"] {
  if (filePath.includes("pages/") || filePath.match(/\/(Home|Landing|Dashboard|Profile|Settings|Login|Register|About|Contact)\./)) return "page";
  if (filePath.includes("hooks/")) return "hook";
  if (filePath.includes("lib/") || filePath.includes("utils/")) return "util";
  if (filePath.includes("styles/") || filePath.endsWith(".css")) return "style";
  if (filePath.match(/\.(config|json)$/)) return "config";
  if (filePath.includes("backend/") || filePath.includes("server/") || filePath.includes("api/")) return "backend";
  if (filePath.includes("__tests__") || filePath.includes(".test.") || filePath.includes(".spec.")) return "test";
  return "component";
}

function extractNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.(tsx|jsx|ts|js|css|json)$/, "");
}

export function ComponentStreamPreview({
  components,
  isActive,
  currentPhase,
  totalComponents,
  className,
}: ComponentStreamPreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const doneCount = components.filter((c) => c.status === "done").length;
  const streamingCount = components.filter((c) => c.status === "streaming").length;
  const cachedCount = components.filter((c) => c.fromCache).length;
  const total = totalComponents ?? components.length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [components.length]);

  if (!isActive && components.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Brain className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
            Componentes generados
          </span>
        </div>
        <div className="flex items-center gap-3">
          {cachedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              ⚡ {cachedCount} desde caché
            </span>
          )}
          <span className="text-[10px] font-mono text-white/30">
            {doneCount}/{total > 0 ? total : "?"} archivos
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {isActive && total > 0 && (
        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Component list */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-1.5 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1"
      >
        {components.map((comp) => {
          const Icon = CATEGORY_ICONS[comp.category] ?? Code2;
          const colorClass = CATEGORY_COLORS[comp.category] ?? CATEGORY_COLORS.component;
          return (
            <div
              key={comp.id}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border transition-all duration-300",
                comp.status === "done"
                  ? "bg-white/[0.02] border-white/5 opacity-80"
                  : comp.status === "streaming"
                  ? "bg-primary/5 border-primary/20 shadow-sm shadow-primary/10"
                  : "bg-white/[0.01] border-white/[0.03] opacity-40",
              )}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {comp.status === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : comp.status === "streaming" ? (
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                ) : (
                  <div className="h-3.5 w-3.5 rounded-full border border-white/10" />
                )}
              </div>

              {/* Category badge */}
              <div className={cn("h-5 w-5 rounded-md border flex items-center justify-center shrink-0", colorClass)}>
                <Icon className="h-3 w-3" />
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-white/80 truncate">{comp.name}</span>
                  {comp.fromCache && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                      CACHÉ
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-white/25 font-mono truncate block">{comp.filePath}</span>
              </div>

              {/* Lines of code */}
              {comp.linesOfCode && comp.status === "done" && (
                <span className="text-[10px] font-mono text-white/20 shrink-0">{comp.linesOfCode}L</span>
              )}
            </div>
          );
        })}

        {/* Placeholder rows while streaming */}
        {isActive && streamingCount === 0 && doneCount < (total || 1) && (
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border border-white/[0.03] bg-white/[0.01] opacity-40">
            <div className="h-3.5 w-3.5 rounded-full border border-white/10 animate-pulse" />
            <div className="h-3.5 w-3.5 rounded-md border border-white/10 animate-pulse" />
            <div className="flex-1">
              <div className="h-2.5 w-24 bg-white/5 rounded animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Phase label */}
      {currentPhase && isActive && (
        <div className="text-[10px] text-white/30 font-medium text-center">
          {currentPhase}
        </div>
      )}
    </div>
  );
}
