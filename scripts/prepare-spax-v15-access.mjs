import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = "/home/ubuntu/spax-frontend-bundle-v14.txt";
const target = "/home/ubuntu/spax-frontend-bundle-v15.txt";
let bundle = await readFile(source, "utf8");

const oldNav = '<button className="ghost" onClick={()=>setAccess(true)}>Acceso equipo</button><button className="ghost" onClick={()=>setVolunteer(true)}>Voluntariado</button>';
const newNav = '<button className="ghost" onClick={()=>setAccess(true)}>Acceso equipo</button><button className="ghost" onClick={()=>setAccess(true)}>Voluntariado</button><button className="ghost" onClick={()=>setAccess(true)}>Moderación</button>';
assert.ok(bundle.includes(oldNav), "No se encontró la navegación de acceso del equipo");
bundle = bundle.replace(oldNav, newNav);

assert.ok(!bundle.includes('onClick={()=>setVolunteer(true)}>Voluntariado</button>'), "Voluntariado aún puede abrirse sin autenticación");
assert.ok(bundle.includes('onClick={()=>setAccess(true)}>Moderación</button>'), "No se añadió el acceso de moderación autenticado");
await writeFile(target, bundle, "utf8");
console.log(JSON.stringify({ ok: true, target, bytes: bundle.length }));
