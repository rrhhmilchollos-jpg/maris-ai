import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = "/home/ubuntu/spax-frontend-bundle-current.txt";
const target = "/home/ubuntu/spax-frontend-bundle-v14.txt";
let bundle = await readFile(source, "utf8");
const dogHook = 'const dogs=useMemo(()=>DOGS.filter(d=>(sex==="Todos"||d.sex===sex)&&(size==="Todos"||d.size===size)),[sex,size]);';

assert.ok(bundle.includes(dogHook), "No se encontró el hook de filtrado de perros");
assert.ok(bundle.includes(`;${dogHook}return <main`), "El hook de filtrado no está en la posición condicional esperada");
assert.ok(bundle.includes('sessionStorage.removeItem("spax_refresh_token");setTeamSession(null)};if(about)'), "No se encontró el punto seguro de inserción antes de las rutas internas");

// React exige invocar todos los hooks en el mismo orden en cada render. El
// filtrado se ejecutaba solo cuando no se abría una ruta interna; se mueve antes
// de las salidas condicionales sin reescribir ningún módulo de SPAX.
bundle = bundle.replace(`;${dogHook}return <main`, ';return <main');
bundle = bundle.replace(
  'sessionStorage.removeItem("spax_refresh_token");setTeamSession(null)};if(about)',
  `sessionStorage.removeItem("spax_refresh_token");setTeamSession(null)};${dogHook}if(about)`,
);

assert.ok(!bundle.includes(`;${dogHook}return <main`), "El hook continúa después de las rutas condicionales");
assert.ok(bundle.includes(`${dogHook}if(about)return <AboutSPAX`), "El hook no se movió antes de las rutas internas");
await writeFile(target, bundle, "utf8");
console.log(JSON.stringify({ ok: true, target, bytes: bundle.length }));
