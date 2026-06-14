import { PillarLayout } from "@/components/pillar-layout";

export default function QueEsAgenteIaPage() {
  return (
    <PillarLayout
      slug="que-es-un-agente-de-ia"
      pageTitle="¿Qué es un agente de IA? Definición y ejemplos en español | Maris AI"
      metaDescription="Qué es un agente de IA, en qué se diferencia de un chatbot, y cómo varios agentes especializados trabajan juntos para generar aplicaciones completas. Explicación clara con ejemplos."
      h1="¿Qué es un agente de IA?"
      intro="Un agente de IA es un sistema que no solo responde preguntas: percibe un objetivo, razona sobre los pasos necesarios y actúa por sí mismo para conseguirlo, usando herramientas reales como si fuera un miembro más de tu equipo."
      relatedLinks={[
        { href: "/que-es-vibe-coding", label: "¿Qué es el vibe coding? La nueva forma de programar con IA" },
        { href: "/desarrollo-no-code-guia", label: "Desarrollo no-code con IA: guía completa para emprendedores" },
        { href: "/glosario", label: "Glosario completo de términos de IA y desarrollo de software" },
      ]}
    >
      <section>
        <h2>Agente de IA vs. chatbot: la diferencia clave</h2>
        <p>
          Un chatbot tradicional —o incluso un asistente de IA conversacional— recibe una
          pregunta y devuelve una respuesta en texto. La interacción termina ahí: es la
          persona quien tiene que copiar esa respuesta, abrir otra herramienta y aplicar el
          resultado manualmente.
        </p>
        <p>
          Un <strong>agente de IA</strong> va un paso más allá: además de "pensar", puede{" "}
          <strong>actuar</strong>. Tiene acceso a herramientas (como editar archivos, ejecutar
          código, consultar una base de datos o desplegar una aplicación) y las usa de forma
          autónoma para avanzar hacia un objetivo, evaluando si el resultado es correcto y
          corrigiendo sus propios errores si algo falla.
        </p>
      </section>

      <section>
        <h2>Las tres capacidades de un agente</h2>
        <ul>
          <li>
            <strong>Percepción:</strong> entiende el contexto —tu petición, el estado actual
            del proyecto, los archivos existentes— antes de actuar.
          </li>
          <li>
            <strong>Razonamiento:</strong> descompone un objetivo complejo ("crea una tienda
            online") en pasos concretos (definir páginas, modelos de datos, componentes,
            integraciones de pago, diseño visual).
          </li>
          <li>
            <strong>Acción:</strong> ejecuta esos pasos usando herramientas reales —escribe
            código, instala dependencias, valida que el proyecto compile, corrige errores— sin
            necesidad de que una persona supervise cada micro-paso.
          </li>
        </ul>
      </section>

      <section>
        <h2>Por qué un solo agente no es suficiente para crear una app</h2>
        <p>
          Construir una aplicación completa implica disciplinas muy distintas: planificar la
          arquitectura, diseñar la interfaz, escribir el frontend, construir el backend y la
          base de datos, integrar servicios externos (pagos, autenticación, email) y probar
          que todo funcione junto. Pedirle todo esto a un único modelo de IA, de una sola vez,
          suele producir resultados inconsistentes o incompletos.
        </p>
        <p>
          Por eso, las plataformas más avanzadas de generación de aplicaciones —incluida{" "}
          <a href="/">Maris AI</a>— utilizan <strong>equipos de agentes especializados</strong>
          {" "}que colaboran como lo haría un equipo de desarrollo real:
        </p>
        <ul>
          <li><strong>Arquitecto:</strong> diseña la estructura del proyecto, las páginas y los modelos de datos.</li>
          <li><strong>Diseñador:</strong> define la paleta de colores, tipografía y estilo visual.</li>
          <li><strong>Ingeniero de frontend:</strong> construye la interfaz en React, TypeScript y Tailwind.</li>
          <li><strong>Ingeniero de backend:</strong> implementa la API, la lógica de negocio y la base de datos.</li>
          <li><strong>Integrador:</strong> detecta y conecta servicios externos como pagos o autenticación.</li>
          <li><strong>Agente de QA:</strong> revisa el código generado, ejecuta pruebas y corrige errores antes de la entrega.</li>
        </ul>
        <p>
          Cada agente trabaja con el modelo de IA más adecuado para su tarea, y todos comparten
          el contexto del proyecto para que el resultado final sea coherente: un único
          producto, no una colección de piezas sueltas.
        </p>
      </section>

      <section>
        <h2>Un ejemplo real: generar una aplicación con agentes de IA</h2>
        <p>
          Imagina que describes: "Necesito una plataforma de citas para una clínica dental,
          con registro de pacientes, calendario para el personal y pagos online". Un sistema
          de agentes de IA:
        </p>
        <ul>
          <li>Analiza la petición y planifica las páginas necesarias (inicio, registro, calendario, panel de administración).</li>
          <li>Diseña el modelo de datos (pacientes, citas, profesionales, pagos).</li>
          <li>Genera el frontend y el backend en paralelo, siguiendo ese plan.</li>
          <li>Detecta que se necesita una pasarela de pago y prepara la integración correspondiente.</li>
          <li>Compila y prueba el proyecto, corrigiendo errores de forma automática hasta que todo funciona.</li>
        </ul>
        <p>
          Todo este proceso, que con un equipo humano tradicional llevaría días o semanas, un
          pipeline de agentes especializados lo completa en minutos —dejando una aplicación
          real, revisable y lista para desplegarse.
        </p>
      </section>

      <section>
        <h2>El siguiente paso: de "agente" a "equipo de agentes en español"</h2>
        <p>
          La mayoría de los agentes de IA disponibles hoy están entrenados y optimizados
          principalmente en inglés. <a href="/">Maris AI</a> aplica este mismo enfoque de
          equipos de agentes especializados, pero con interfaces, comunicación y código
          generado pensados para el mercado hispanohablante desde el primer momento.
        </p>
      </section>
    </PillarLayout>
  );
}
