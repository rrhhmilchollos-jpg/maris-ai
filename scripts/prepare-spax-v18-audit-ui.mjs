import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = "/home/ubuntu/spax-frontend-bundle-v17.txt";
const target = "/home/ubuntu/spax-frontend-bundle-v18.txt";
let bundle = await readFile(source, "utf8");

function replaceOnce(search, replacement, label) {
  assert.ok(bundle.includes(search), `No se encontró el bloque esperado: ${label}`);
  bundle = bundle.replace(search, replacement);
}

replaceOnce(
  'function ModerationHub({onClose,role}:{onClose:()=>void;role:"moderator"|"veterinarian"|"administrator"}){',
  'function ModerationHub({onClose,role,session}:{onClose:()=>void;role:"moderator"|"veterinarian"|"administrator";session:StaffSession}){',
  'firma ModerationHub',
);
replaceOnce(
  'const canModerate=role!=="veterinarian";const addAnimal=',
  'const canModerate=role!=="veterinarian";const downloadAudit=async()=>{if(role!=="administrator"){setSaved("La exportación de auditoría está reservada a administración.");return}setSaved("Generando exportación de auditoría…");try{const r=await fetch(SPAX_AUTH+"/admin/audit/export.csv",{headers:{"Authorization":"Bearer "+session.accessToken}});if(!r.ok)throw new Error("audit_export_failed");const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="spax-auditoria.csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);setSaved("La exportación CSV se ha descargado. El archivo contiene acciones auditadas y datos minimizados.")}catch{setSaved("No se pudo exportar la auditoría. Vuelve a iniciar sesión o contacta con administración.")}};const addAnimal=',
  'función exportación',
);
replaceOnce(
  '<p className="eyebrow" style={{color:"#e17a24"}}>ACCESO DE MODERACIÓN</p>',
  '<p className="eyebrow" style={{color:"#e17a24"}}>{role==="administrator"?"ACCESO DE ADMINISTRACIÓN":role==="veterinarian"?"ACCESO VETERINARIO":"ACCESO DE MODERACIÓN"}</p>',
  'título dinámico del panel',
);
replaceOnce(
  '<button className="line" onClick={()=>setSaved("El rol de moderación debe concederse mediante una cuenta autenticada y auditada por SPAX.")}>Permisos y auditoría</button>',
  '{role==="administrator"?<button className="line" onClick={downloadAudit}>Exportar auditoría CSV</button>:<button className="line" onClick={()=>setSaved("El rol y los permisos se conceden únicamente mediante una cuenta autenticada y auditada por SPAX.")}>Permisos</button>}',
  'botón auditoría',
);
replaceOnce(
  'return <ModerationHub role={role} onClose={logout}/>;',
  'return <ModerationHub role={role} session={teamSession} onClose={logout}/>;',
  'montaje ModerationHub',
);

assert.ok(bundle.includes('Exportar auditoría CSV'), 'No se incorporó el botón de exportación');
assert.ok(bundle.includes('/admin/audit/export.csv'), 'No se conectó la ruta de auditoría');
assert.ok(bundle.includes('session={teamSession}'), 'No se pasó la sesión al panel');
await writeFile(target, bundle, "utf8");
console.log(JSON.stringify({ ok: true, target, bytes: bundle.length }));
