import { useEffect, useMemo, useState } from "react";
import { SandpackProvider, SandpackPreview, SandpackLayout, useSandpack } from "@codesandbox/sandpack-react";
import { parseBundle, buildSandpackFiles, SANDPACK_DEPENDENCIES } from "@/lib/parseBundle";

function ConsoleTap({ onLog }: { onLog: (msg: string) => void }) {
  const { listen } = useSandpack();
  useEffect(() => {
    const unsub = listen((m: any) => {
      try {
        if (m && m.type === "console" && Array.isArray(m.log)) {
          for (const entry of m.log) {
            const method = entry.method || "log";
            const data = (entry.data || []).map((d: any) => (typeof d === "string" ? d : JSON.stringify(d).slice(0, 800))).join(" ");
            onLog(`[console:${method}] ${data}`);
          }
        } else if (m && m.type === "action" && m.action === "show-error") {
          onLog(`[show-error] ${m.title || ""}: ${m.message || ""}\n  path=${m.path || ""}\n  frames=${m.payload && m.payload.frames ? JSON.stringify(m.payload.frames).slice(0, 800) : ""}`);
        } else if (m && m.type === "action") {
          onLog(`[action:${m.action}] ${JSON.stringify(m).slice(0, 400)}`);
        } else if (m && m.type === "status") {
          onLog(`[status] ${m.status}`);
        } else if (m && m.type === "done") {
          onLog(`[done] compilatonError=${m.compilatonError ?? "n/a"}`);
        } else if (m && m.type === "start") {
          onLog(`[start] firstLoad=${m.firstLoad}`);
        } else if (m && m.type === "compile") {
          // suppress (huge payloads with all files)
        } else if (m && m.type === "urlchange") {
          onLog(`[urlchange] ${m.url}`);
        } else if (m && m.type === "transpiler-context-error") {
          onLog(`[transpiler-error] ${JSON.stringify(m).slice(0, 600)}`);
        } else if (m) {
          onLog(`[other:${m.type || "?"}] ${JSON.stringify(m).slice(0, 400)}`);
        }
      } catch (e) {
        onLog(`[tap-error] ${String((e as Error).message)}`);
      }
    });
    return () => unsub();
  }, [listen, onLog]);
  return null;
}

export default function DebugPreviewPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [bundle, setBundle] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => {
    if (id === "min") { setBundle("MIN"); return; }
    // Cancel the in-flight bundle fetch on unmount or `id` change so a slow
    // response can't `setBundle` after the component is gone (or for the
    // wrong app id).
    const controller = new AbortController();
    fetch(`/api/__debug/bundle/${id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setBundle(d.frontendCode || ""))
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.error("debug-preview fetch failed", err);
        }
      });
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (d && d.__appforgeDebug) {
        setLogs((prev) => [...prev.slice(-500), `[iframe:${d.kind}] ${d.msg}${d.stack ? "\n  " + d.stack.split("\n").slice(0, 4).join("\n  ") : ""}`]);
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      controller.abort();
      window.removeEventListener("message", onMsg);
    };
  }, [id]);
  const sandpackFiles = useMemo(() => {
    if (bundle === "MIN") {
      // Smallest possible bundle: just an App that prints text. No deps used.
      return buildSandpackFiles({
        "src/App.tsx": "export default function App(){ return <div style={{padding:24,fontSize:24}}>HELLO MIN BUNDLE</div>; }",
      });
    }
    const built = bundle ? buildSandpackFiles(parseBundle(bundle)) : null;
    if (built && new URLSearchParams(window.location.search).has("hello")) {
      const fileCount = Object.keys(built).length;
      built["/App.tsx"] = `import * as React from "react"; export default function App() { return React.createElement("div", { style: { padding: 24, fontSize: 24, background: "lime", color: "black" } }, "HELLO FROM REPLACED APP. Files in bundle: ${fileCount}"); }`;
    }
    if (built && new URLSearchParams(window.location.search).has("nav")) {
      // Use the real Navbar wrapped in a TEST-ONLY ErrorBoundary so we can
      // capture a thrown error from render (React 18 silently nukes the tree
      // on uncaught render errors — the pink background disappears too).
      built["/App.tsx"] = `import * as React from "react";
import Navbar from "./components/Navbar";
console.log("[appforge-test] App.tsx module loaded");
class EB extends React.Component {
  constructor(p){ super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e){ return { e }; }
  componentDidCatch(e, info){ console.log("[appforge-test] EB caught:", e && (e.message || String(e)), "stack:", info && info.componentStack); }
  render(){
    if (this.state.e) return React.createElement("pre", { style: { background: "yellow", color: "red", padding: 16, whiteSpace: "pre-wrap" } }, "CAUGHT: " + (this.state.e && (this.state.e.stack || this.state.e.message || String(this.state.e))));
    return this.props.children;
  }
}
export default function App() {
  console.log("[appforge-test] App() called");
  return React.createElement("div", { style: { background: "pink", color: "black", minHeight: "100vh", padding: 12, fontSize: 16 } },
    "BEFORE NAVBAR",
    React.createElement(EB, null, React.createElement(Navbar, null)),
    "AFTER NAVBAR"
  );
}`;
    }
    if (built && new URLSearchParams(window.location.search).has("wouter")) {
      built["/App.tsx"] = `import * as React from "react";
import { Link, Switch, Route, useLocation } from "wouter";
function Home() { const [loc] = useLocation(); return React.createElement("div", { style: { padding: 24 } }, "WOUTER OK. loc=" + loc + ". ", React.createElement(Link, { href: "/about" }, "go about")); }
function About() { return React.createElement("div", { style: { padding: 24 } }, "ABOUT PAGE"); }
export default function App() {
  return React.createElement("div", { style: { padding: 12, background: "yellow", color: "black", minHeight: "100vh" } },
    React.createElement(Switch, null,
      React.createElement(Route, { path: "/", component: Home }),
      React.createElement(Route, { path: "/about", component: About })
    )
  );
}`;
    }
    return built;
  }, [bundle]);
  const [showFiles, setShowFiles] = useState(false);
  return (
    <div style={{ display: "grid", gridTemplateRows: "1fr 280px", height: "100vh" }}>
      <div style={{ minHeight: 0, position: "relative" }}>
        {sandpackFiles ? (
          <SandpackProvider
            template="react-ts"
            files={sandpackFiles}
            customSetup={{ entry: "/index.tsx", dependencies: SANDPACK_DEPENDENCIES }}
            options={{ recompileMode: "delayed", recompileDelay: 500 }}
            theme="light"
          >
            <ConsoleTap onLog={(msg) => setLogs((prev) => [...prev.slice(-500), msg])} />
            <SandpackLayout style={{ height: "100%", width: "100%", border: "none", borderRadius: 0 }}>
              <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton style={{ height: "100%", width: "100%", flex: 1, minWidth: 0 }} />
            </SandpackLayout>
          </SandpackProvider>
        ) : (
          <div style={{ padding: 24 }}>Loading bundle…</div>
        )}
      </div>
      <div style={{ background: "#0b1220", color: "#e2e8f0", fontFamily: "ui-monospace,monospace", fontSize: 11, lineHeight: 1.4, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "4px 12px", display: "flex", gap: 12, borderBottom: "1px solid #1e293b" }}>
          <button onClick={() => setShowFiles((s) => !s)} style={{ background: "#334155", color: "white", border: "none", padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>
            {showFiles ? "Show logs" : "Show files"}
          </button>
          {sandpackFiles && <span>files: {Object.keys(sandpackFiles).length}</span>}
        </div>
        <pre style={{ margin: 0, padding: 12, overflow: "auto", whiteSpace: "pre-wrap", flex: 1 }}>
          {showFiles && sandpackFiles
            ? Object.entries(sandpackFiles)
                .map(([p, c]) => `=== ${p} (${typeof c === "string" ? c.length : 0}b) ===\n${typeof c === "string" ? c.slice(0, 800) : ""}`)
                .join("\n\n")
            : logs.length
            ? logs.join("\n")
            : "(no logs yet)"}
        </pre>
      </div>
    </div>
  );
}
