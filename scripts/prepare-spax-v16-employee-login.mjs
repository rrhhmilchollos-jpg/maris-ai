import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = "/home/ubuntu/spax-frontend-bundle-v15.txt";
const target = "/home/ubuntu/spax-frontend-bundle-v16.txt";
let bundle = await readFile(source, "utf8");

function replaceOnce(search, replacement, label) {
  assert.ok(bundle.includes(search), `No se encontró el bloque esperado: ${label}`);
  bundle = bundle.replace(search, replacement);
}

replaceOnce(
  'type StaffUser={id:string;email:string;displayName:string;roles:StaffRole[];permissions:string[];active:boolean};',
  'type StaffUser={id:string;email:string;employeeCode:string;displayName:string;roles:StaffRole[];permissions:string[];active:boolean};',
  'tipo StaffUser',
);
replaceOnce(
  'function TeamAccess({onClose,onAuthenticated}:{onClose:()=>void;onAuthenticated:(session:StaffSession)=>void}){const[email,setEmail]=useState(""),[password,setPassword]=useState(""),',
  'function TeamAccess({onClose,onAuthenticated}:{onClose:()=>void;onAuthenticated:(session:StaffSession)=>void}){const[employeeCode,setEmployeeCode]=useState(""),[password,setPassword]=useState(""),',
  'estado de acceso',
);
replaceOnce(
  'body:JSON.stringify({email,password})',
  'body:JSON.stringify({employeeCode,password})',
  'petición de acceso',
);
replaceOnce(
  '<p className="muted">Acceso solo para personas invitadas y activadas por SPAX. Los permisos se asignan en el servidor y quedan registrados en auditoría.</p>',
  '<p className="muted">Acceso solo para personas invitadas y activadas por SPAX. Introduce tu código numérico de empleado y tu contraseña; los permisos se asignan en el servidor y quedan registrados en auditoría.</p>',
  'explicación de acceso',
);
replaceOnce(
  '<label className="field full">Correo del equipo<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nombre@protectoraxativa.org" /></label>',
  '<label className="field full">Código de empleado<input required inputMode="numeric" autoComplete="username" pattern="[0-9]{6}" maxLength={6} value={employeeCode} onChange={e=>setEmployeeCode(e.target.value.replace(/\\D/g,"").slice(0,6))} placeholder="Ej. 123456" aria-describedby="employee-code-help" /></label><p id="employee-code-help" className="muted" style={{marginTop:-8}}>Seis cifras asignadas por SPAX al crear o invitar a cada integrante del equipo.</p>',
  'campo de correo',
);
replaceOnce(
  'No elijas un rol en el navegador: moderación, veterinaria y voluntariado se determinan únicamente por la cuenta que SPAX haya autorizado.',
  'El código de empleado identifica tu cuenta; la contraseña confirma el acceso. Moderación, veterinaria y voluntariado se determinan únicamente por la cuenta autorizada por SPAX.',
  'aviso de rol',
);

assert.ok(!bundle.includes('Correo del equipo'), 'El campo de correo sigue en la interfaz');
assert.ok(bundle.includes('Código de empleado'), 'No se incorporó el campo de código');
assert.ok(bundle.includes('JSON.stringify({employeeCode,password})'), 'El frontend no envía el código al backend');
await writeFile(target, bundle, "utf8");
console.log(JSON.stringify({ ok: true, target, bytes: bundle.length }));
