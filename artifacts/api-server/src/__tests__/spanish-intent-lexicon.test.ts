import assert from "node:assert/strict";
import { analyzeSpanishIntent } from "../lib/spanishIntentLexicon";
import { buildProjectMap, resolveTargetFromPrompt } from "../lib/projectMap";
import { interpretDataRequestDeterministic } from "../lib/dataOperationAgent";

const frontendBundle = `// === FILE: src/App.tsx ===
export default function App(){ return <button>Solicitar visita</button>; }
// === FILE: src/styles.css ===
button { color: red; }
// === FILE: src/components/Header.tsx ===
export function Header(){ return <header>Logo</header>; }
`;

const backendBundle = `// === FILE: server.js ===
app.post('/api/clientes', (req, res) => res.json({ ok: true }));
`;

function includes<T>(items: T[], item: T, label: string) {
  assert.ok(items.includes(item), `${label}: esperaba ${String(item)} en ${JSON.stringify(items)}`);
}

const addUser = analyzeSpanishIntent("añade un trabajador en la CRM con este correo y contraseña");
includes(addUser.actions, "add", "addUser.actions");
includes(addUser.domains, "crm", "addUser.domains");
includes(addUser.domains, "credentials", "addUser.domains");
assert.equal(addUser.isDataOperation, true, "añadir trabajador en CRM debe ser ENGINE_EXEC/data");
assert.equal(addUser.isDevOperation, false, "operación CRM no debe regenerar frontend");

const modifyButton = analyzeSpanishIntent("modifica el botón principal y ponlo más grande");
includes(modifyButton.actions, "modify", "modifyButton.actions");
includes(modifyButton.domains, "component", "modifyButton.domains");
assert.equal(modifyButton.isDirectEdit, true, "modificar botón debe ser parche directo");

const deleteModal = analyzeSpanishIntent("elimina el modal de precios, solo eso y para");
includes(deleteModal.actions, "delete", "deleteModal.actions");
assert.equal(deleteModal.isDirectEdit, true, "eliminar modal concreto debe ser edición directa");

const fixBug = analyzeSpanishIntent("arregla el error de preview que no carga");
includes(fixBug.actions, "fix", "fixBug.actions");
assert.equal(fixBug.isBugFix, true, "arreglar error debe marcar bugfix");

const research = analyzeSpanishIntent("busca en internet información de alarmas en Valencia");
includes(research.actions, "research", "research.actions");
assert.equal(research.isResearch, true, "buscar en internet debe ser investigación");

const projectMap = buildProjectMap("app1", "Demo", frontendBundle, backendBundle);
const dataTarget = resolveTargetFromPrompt("añade un cliente en la CRM", projectMap);
assert.equal(dataTarget.targetType, "data_record", "CRM debe ir a data_record");

const directInsert = interpretDataRequestDeterministic("añade en la base de datos de la CRM de Seguxat como trabajador a Ivan con correo ivan@seguxat.com y contraseña 1234");
assert.ok(directInsert, "la operación clara de alta de trabajador debe interpretarse sin LLM");
assert.equal(directInsert?.type, "INSERT", "añade debe mapear a INSERT");
assert.equal(directInsert?.collection, "trabajadores_seguxat", "debe ir a la colección directa de trabajadores de Seguxat");
assert.equal(directInsert?.fields.email, "ivan@seguxat.com", "debe extraer email");
assert.equal(directInsert?.fields.rol, "trabajador", "debe extraer rol trabajador");
assert.equal(directInsert?.fields.password, "1234", "debe extraer contraseña para protegerla después en persistencia");

const styleTarget = resolveTargetFromPrompt("cambia el color del botón", projectMap);
assert.equal(styleTarget.targetType, "style", "color debe ir a estilo");

const backendTarget = resolveTargetFromPrompt("modifica el endpoint de clientes", projectMap);
assert.equal(backendTarget.targetType, "backend_file", "endpoint debe ir a backend_file");

console.log("spanish-intent-lexicon: OK");
