import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const source = "/home/ubuntu/spax-frontend-bundle-v16.txt";
const target = "/home/ubuntu/spax-frontend-bundle-v17.txt";
let bundle = await readFile(source, "utf8");

function replaceOnce(search, replacement, label) {
  assert.ok(bundle.includes(search), `No se encontró el bloque esperado: ${label}`);
  bundle = bundle.replace(search, replacement);
}

replaceOnce(
  'type Dog={id:string;name:string;sex:"Macho"|"Hembra";age:string;size:string;breed:string;energy:string;status:string;story:string;image:string;tags:string[]};',
  'type Dog={id:string;name:string;sex:"Macho"|"Hembra";age:string;size:string;breed:string;energy:string;status:string;story:string;image:string;tags:string[];character:string;home:string;coexistence:string;walks:string;care:string;idealFamily:string;adoptionNote:string};',
  'tipo Dog',
);
replaceOnce(
  'const DOGS:Dog[]=[\n{id:"luna",name:"Luna",sex:"Hembra",age:"2 años",size:"Mediano",breed:"Mestiza",energy:"Media",status:"Busca familia",story:"Luna llegó al refugio con mucha curiosidad y aprende rápido. Disfruta los paseos tranquilos y el contacto cercano.",image:"https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=1200&q=80",tags:["Sociable","Esterilizada","Apta con niños"]},\n{id:"bruno",name:"Bruno",sex:"Macho",age:"4 años",size:"Grande",breed:"Mestizo",energy:"Media",status:"Busca familia",story:"Bruno es noble, equilibrado y necesita un hogar con tiempo para paseos y compañía.",image:"https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=80",tags:["Cariñoso","Identificado","Paseos"]},\n{id:"nala",name:"Nala",sex:"Hembra",age:"1 año",size:"Pequeño",breed:"Mestiza",energy:"Alta",status:"Acogida o adopción",story:"Nala es joven, juguetona y muy inteligente. Busca una familia activa que continúe su educación positiva.",image:"https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=1200&q=80",tags:["Joven","Activa","Aprende rápido"]},\n{id:"toby",name:"Toby",sex:"Macho",age:"6 años",size:"Mediano",breed:"Cruce de podenco",energy:"Baja",status:"Busca familia",story:"Toby es sereno y observador. Agradece los entornos tranquilos y las rutinas previsibles.",image:"https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=1200&q=80",tags:["Tranquilo","Adulto","Paseos suaves"]},\n{id:"kira",name:"Kira",sex:"Hembra",age:"3 años",size:"Mediano",breed:"Mestiza",energy:"Media",status:"Busca familia",story:"Kira se ha adaptado muy bien al cuidado del refugio y busca una familia comprometida con una adopción responsable.",image:"https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=1200&q=80",tags:["Equilibrada","Esterilizada","Afectuosa"]},\n{id:"max",name:"Max",sex:"Macho",age:"2 años",size:"Grande",breed:"Cruce de pastor",energy:"Alta",status:"Acogida o adopción",story:"Max necesita ejercicio, acompañamiento y una familia que entienda sus necesidades de perro joven y activo.",image:"https://images.unsplash.com/photo-1551717743-49959800b1f6?auto=format&fit=crop&w=1200&q=80",tags:["Activo","Joven","Con adiestramiento"]}\n];',
  `const DOGS:Dog[]=[
{id:"luna",name:"Luna",sex:"Hembra",age:"2 años",size:"Mediano",breed:"Mestiza",energy:"Media",status:"Busca familia",story:"Luna llegó al refugio con mucha curiosidad y aprende rápido. Disfruta los paseos tranquilos y el contacto cercano.",image:"https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=1200&q=80",tags:["Sociable","Esterilizada","Apta con niños"],character:"Cercana, observadora y sensible al trato tranquilo. Se vincula con facilidad cuando se respetan sus tiempos.",home:"Puede adaptarse a piso o casa si cuenta con salidas diarias, descanso y una rutina estable.",coexistence:"La convivencia con niños u otros animales debe valorarse de manera individual por el equipo de SPAX.",walks:"Paseos regulares de intensidad media, combinando olfato, juego tranquilo y tiempo de exploración.",care:"Su estado sanitario y calendario preventivo se confirman siempre con el equipo responsable antes de formalizar una adopción.",idealFamily:"Una familia paciente, afectuosa y comprometida con una adaptación progresiva.",adoptionNote:"SPAX realizará entrevista, valoración de compatibilidad y el seguimiento que considere necesario."},
{id:"bruno",name:"Bruno",sex:"Macho",age:"4 años",size:"Grande",breed:"Mestizo",energy:"Media",status:"Busca familia",story:"Bruno es noble, equilibrado y necesita un hogar con tiempo para paseos y compañía.",image:"https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=80",tags:["Cariñoso","Identificado","Paseos"],character:"Noble, estable y muy agradecido con la compañía. Responde mejor a indicaciones claras y amables.",home:"Agradece espacio para descansar y una familia que pueda sostener una rutina de salidas y compañía.",coexistence:"Las presentaciones con otros animales deben hacerse de forma gradual y supervisada.",walks:"Necesita paseos diarios con tiempo suficiente para caminar, oler y desconectar.",care:"La información clínica actualizada se comparte durante el proceso de adopción con las personas preseleccionadas.",idealFamily:"Personas activas de forma moderada que disfruten de paseos y de un compañero adulto equilibrado.",adoptionNote:"La visita y el encuentro previo se coordinarán con SPAX antes de cualquier decisión."},
{id:"nala",name:"Nala",sex:"Hembra",age:"1 año",size:"Pequeño",breed:"Mestiza",energy:"Alta",status:"Acogida o adopción",story:"Nala es joven, juguetona y muy inteligente. Busca una familia activa que continúe su educación positiva.",image:"https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=1200&q=80",tags:["Joven","Activa","Aprende rápido"],character:"Joven, expresiva y con muchas ganas de aprender. Necesita acompañamiento consistente y refuerzo positivo.",home:"Le beneficia un hogar seguro con tiempo para juego, educación y descansos tranquilos.",coexistence:"Por su edad y energía, cada convivencia se valora de forma individual para asegurar una adaptación positiva.",walks:"Paseos activos, juego guiado y ejercicios de olfato adecuados a una perra joven.",care:"SPAX confirmará las necesidades de salud, alimentación y seguimiento antes de una acogida o adopción.",idealFamily:"Familia activa que quiera acompañar su educación sin métodos aversivos.",adoptionNote:"También puede necesitar una acogida temporal mientras continúa su proceso de socialización."},
{id:"toby",name:"Toby",sex:"Macho",age:"6 años",size:"Mediano",breed:"Cruce de podenco",energy:"Baja",status:"Busca familia",story:"Toby es sereno y observador. Agradece los entornos tranquilos y las rutinas previsibles.",image:"https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=1200&q=80",tags:["Tranquilo","Adulto","Paseos suaves"],character:"Sereno, sensible y observador. Se siente más cómodo cuando conoce el entorno y mantiene rutinas claras.",home:"Idealmente un ambiente tranquilo, con un espacio de descanso cómodo y sin estímulos constantes.",coexistence:"La compatibilidad con personas y otros animales se revisa durante las presentaciones organizadas por SPAX.",walks:"Paseos suaves, pausados y previsibles, adaptados a su ritmo y bienestar.",care:"El equipo responsable explicará cualquier pauta veterinaria o de manejo necesaria a la familia seleccionada.",idealFamily:"Personas tranquilas que valoren la compañía de un perro adulto y respeten sus tiempos.",adoptionNote:"La adaptación puede requerir paciencia; SPAX acompaña el proceso de transición."},
{id:"kira",name:"Kira",sex:"Hembra",age:"3 años",size:"Mediano",breed:"Mestiza",energy:"Media",status:"Busca familia",story:"Kira se ha adaptado muy bien al cuidado del refugio y busca una familia comprometida con una adopción responsable.",image:"https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=1200&q=80",tags:["Equilibrada","Esterilizada","Afectuosa"],character:"Afectuosa y equilibrada. Disfruta de la cercanía con las personas y de actividades moderadas.",home:"Puede integrarse en un hogar con rutina, afecto y salidas diarias bien organizadas.",coexistence:"SPAX orientará sobre presentaciones graduales y pautas de convivencia según el hogar interesado.",walks:"Le favorece una combinación de paseos diarios, ratos de juego y descanso compartido.",care:"La protectora facilitará a la familia aprobada la información sanitaria y de cuidados disponible.",idealFamily:"Hogar comprometido que busque una compañera adulta, cercana y estable.",adoptionNote:"La adopción se formaliza solo tras la valoración y los pasos de SPAX."},
{id:"max",name:"Max",sex:"Macho",age:"2 años",size:"Grande",breed:"Cruce de pastor",energy:"Alta",status:"Acogida o adopción",story:"Max necesita ejercicio, acompañamiento y una familia que entienda sus necesidades de perro joven y activo.",image:"https://images.unsplash.com/photo-1551717743-49959800b1f6?auto=format&fit=crop&w=1200&q=80",tags:["Activo","Joven","Con adiestramiento"],character:"Joven, potente y con mucha energía. Disfruta aprendiendo cuando recibe una guía constante y respetuosa.",home:"Necesita un entorno seguro y personas disponibles para actividad, educación y descanso estructurado.",coexistence:"La introducción con otros animales o menores debe planificarse con criterios de seguridad y compatibilidad.",walks:"Ejercicio físico y mental diario, con paseos, olfato, juego estructurado y aprendizaje.",care:"El equipo explicará las necesidades de manejo, salud y entrenamiento antes de aprobar la adopción o acogida.",idealFamily:"Personas con tiempo, experiencia o voluntad de acompañamiento profesional en educación canina.",adoptionNote:"Puede beneficiarse de acogida temporal responsable mientras aparece el hogar definitivo."}
];`,
  'datos de los perros',
);
replaceOnce(
  'function Adoption({dog,onClose,onDone}:{dog:Dog;onClose:()=>void;onDone:()=>void}){const[ok,setOk]=useState(false);',
  `function DogProfile({dog,onClose,onAdopt,onFoster}:{dog:Dog;onClose:()=>void;onAdopt:()=>void;onFoster:()=>void}){return <div className="modalback" role="dialog" aria-modal="true" aria-label={"Ficha de "+dog.name}><div className="modal"><button className="close" onClick={onClose}>×</button><div className="photo" style={{height:260,backgroundImage:"url('"+dog.image+"')",borderRadius:12,marginBottom:18}}><span className="pill">{dog.status}</span><span className="sex">{dog.sex}</span></div><p className="eyebrow" style={{color:"#205c48"}}>FICHA DE ADOPCIÓN</p><h2>{dog.name}</h2><p className="muted">{dog.age} · {dog.size} · {dog.breed} · Energía {dog.energy.toLowerCase()}</p><div className="tags">{dog.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div><p style={{lineHeight:1.65}}>{dog.story}</p><div className="services" style={{gridTemplateColumns:"repeat(2,minmax(0,1fr))",marginTop:16}}><div className="service"><strong>Carácter</strong><p>{dog.character}</p></div><div className="service"><strong>Hogar y convivencia</strong><p>{dog.home} {dog.coexistence}</p></div><div className="service"><strong>Paseos y actividad</strong><p>{dog.walks}</p></div><div className="service"><strong>Cuidados</strong><p>{dog.care}</p></div></div><div className="notice"><b>Familia ideal:</b> {dog.idealFamily}<br/><br/>{dog.adoptionNote}</div><div className="actions"><button className="line" onClick={onClose}>Seguir viendo perros</button><button className="warm" onClick={onFoster}>Solicitar acogida</button><button className="forest" onClick={onAdopt}>Solicitar adopción</button></div></div></div>}
function Adoption({dog,requestType,onClose,onDone}:{dog:Dog;requestType:"adoption"|"foster";onClose:()=>void;onDone:()=>void}){const[ok,setOk]=useState(false);const isFoster=requestType==="foster";`,
  'modal de adopción',
);
replaceOnce(
  '<h2>Gracias por interesarte por {dog.name}.</h2><p className="muted">La solicitud ha quedado registrada en esta vista previa. El equipo de SPAX deberá revisarla y contactar contigo antes de cualquier visita o adopción.</p>',
  '<h2>Gracias por interesarte por {dog.name}.</h2><p className="muted">La solicitud de {isFoster?"acogida":"adopción"} ha quedado registrada en esta vista previa. El equipo de SPAX deberá revisarla y contactar contigo antes de cualquier visita o decisión.</p>',
  'confirmación de solicitud',
);
replaceOnce(
  '<p className="eyebrow" style={{color:"#205c48"}}>ADOPCIÓN RESPONSABLE</p><h2>Conoce a {dog.name}</h2>',
  '<p className="eyebrow" style={{color:"#205c48"}}>{isFoster?"ACOGIDA RESPONSABLE":"ADOPCIÓN RESPONSABLE"}</p><h2>{isFoster?"Acoge a ":"Conoce a "}{dog.name}</h2>',
  'encabezado de solicitud',
);
replaceOnce(
  'placeholder={"Rutina, experiencia y cómo será la adaptación de " + dog.name + "."}',
  'placeholder={(isFoster?"Disponibilidad, experiencia y cómo será la acogida temporal de ":"Rutina, experiencia y cómo será la adaptación de ") + dog.name + "."}',
  'formulario de solicitud',
);
replaceOnce(
  'Enviar este formulario no confirma una adopción. La protectora debe valorar el bienestar del animal y realizar las comprobaciones necesarias.',
  'Enviar este formulario no confirma una '+ '{isFoster?"acogida":"adopción"}' + '. La protectora debe valorar el bienestar del animal y realizar las comprobaciones necesarias.',
  'aviso de solicitud',
);
replaceOnce(
  'const[sex,setSex]=useState("Todos"),[size,setSize]=useState("Todos"),[selected,setSelected]=useState<Dog|null>(null),[donate,setDonate]=useState(false),',
  'const[sex,setSex]=useState("Todos"),[size,setSize]=useState("Todos"),[selected,setSelected]=useState<Dog|null>(null),[profileDog,setProfileDog]=useState<Dog|null>(null),[requestType,setRequestType]=useState<"adoption"|"foster">("adoption"),[donate,setDonate]=useState(false),',
  'estado App de ficha',
);
replaceOnce(
  '<div className="photo" style={{backgroundImage:"url(\'"+d.image+"\')"}}><span className="pill">{d.status}</span><span className="sex">{d.sex}</span></div>',
  '<div className="photo" role="button" tabIndex={0} aria-label={"Abrir ficha completa de "+d.name} onClick={()=>setProfileDog(d)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setProfileDog(d)}}} style={{backgroundImage:"url(\'"+d.image+"\')",cursor:"pointer"}}><span className="pill">{d.status}</span><span className="sex">{d.sex}</span></div>',
  'foto clicable del catálogo',
);
replaceOnce(
  '<button className="know" onClick={()=>setSelected(d)}>Conocer a {d.name}</button><button className="adopt" onClick={()=>setSelected(d)}>Solicitar adopción</button>',
  '<button className="know" onClick={()=>setProfileDog(d)}>Conocer a {d.name}</button><button className="adopt" onClick={()=>{setRequestType("adoption");setSelected(d)}}>Solicitar adopción</button>',
  'botones de tarjeta',
);
replaceOnce(
  '{selected&&<Adoption dog={selected} onClose={()=>setSelected(null)} onDone={()=>setRequests(x=>x+1)}/>} {donate&&<Donate onClose={()=>setDonate(false)}/>}</main>}',
  '{profileDog&&<DogProfile dog={profileDog} onClose={()=>setProfileDog(null)} onAdopt={()=>{setProfileDog(null);setRequestType("adoption");setSelected(profileDog)}} onFoster={()=>{setProfileDog(null);setRequestType("foster");setSelected(profileDog)}}/>}{selected&&<Adoption dog={selected} requestType={requestType} onClose={()=>setSelected(null)} onDone={()=>setRequests(x=>x+1)}/>} {donate&&<Donate onClose={()=>setDonate(false)}/>}</main>}',
  'montaje de modales',
);

assert.ok(bundle.includes('function DogProfile'), 'No se creó el modal de ficha');
assert.ok(bundle.includes('cursor:"pointer"'), 'La foto no es clicable');
assert.ok(bundle.includes('requestType={requestType}'), 'No se conecta la solicitud desde la ficha');
await writeFile(target, bundle, "utf8");
console.log(JSON.stringify({ ok: true, target, bytes: bundle.length }));
