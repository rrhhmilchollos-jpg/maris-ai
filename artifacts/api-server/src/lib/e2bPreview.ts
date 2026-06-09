python3 << 'EOF'
import urllib.request, json, base64, os

TOKEN = os.environ["GITHUB_TOKEN"]
REPO = "rrhhmilchollos-jpg/maris-ai"
FILE = "artifacts/api-server/src/lib/e2bPreview.ts"
API = f"https://api.github.com/repos/{REPO}/contents/{FILE}"

headers = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
}

with open(f"/app/{FILE}", "r") as f:
    content = f.read()

# Verificar si el archivo ya existe en GitHub
try:
    req = urllib.request.Request(API, headers=headers)
    with urllib.request.urlopen(req) as r:
        existing = json.loads(r.read())
        sha = existing["sha"]
except:
    sha = None

body = json.dumps({
    "message": "feat: add E2B live preview sandbox (like Emergent.sh)",
    "content": base64.b64encode(content.encode()).decode(),
    "branch": "main",
    **({"sha": sha} if sha else {})
}).encode()

req = urllib.request.Request(API, data=body, headers=headers, method="PUT")
with urllib.request.urlopen(req) as r:
    result = json.loads(r.read())
    print(f"✅ Subido: {result['commit']['html_url']}")
EOF
