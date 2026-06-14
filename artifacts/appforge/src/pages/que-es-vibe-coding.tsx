import { PillarLayout } from "@/components/pillar-layout";

export default function QueEsVibeCodingPage() {
  return (
    <PillarLayout
      slug="que-es-vibe-coding"
      pageTitle="¿Qué es el Vibe Coding? Guía completa en español | Maris AI"
      metaDescription="Descubre qué es el vibe coding: la nueva forma de programar describiendo lo que quieres en lenguaje natural, mientras la IA escribe el código por ti. Ejemplos y herramientas en español."
      h1="¿Qué es el Vibe Coding?"
      intro="El vibe coding es la forma de crear software del momento: en vez de escribir cada línea de código a mano, describes lo que quieres con tus propias palabras y un equipo de agentes de IA construye la aplicación por ti."
      relatedLinks={[
        { href: "/que-es-un-agente-de-ia", label: "¿Qué es un agente de IA? Cómo funcionan los equipos de IA que programan por ti" },
        { href: "/desarrollo-no-code-guia", label: "Desarrollo no-code con IA: guía completa para emprendedores" },
        { href: "/glosario", label: "Glosario completo de términos de IA y desarrollo de software" },
      ]}
    >
      <section>
        <h2>El origen del término</h2>
        <p>
          El término "vibe coding" se popularizó en 2025 para describir una forma de programar
          en la que el desarrollador se centra en la intención y el resultado final —la
          "vibra" o sensación que debe tener el producto— en lugar de pelearse con la sintaxis,
          las librerías o la configuración del entorno. La idea es simple: describes lo que
          quieres construir en lenguaje natural, y un modelo de lenguaje (LLM) traduce esa
          descripción en código funcional, real y ejecutable.
        </p>
        <p>
          No se trata de "programar sin saber programar" en el sentido de magia: detrás sigue
          habiendo código TypeScript, React, bases de datos y servidores reales. Lo que cambia
          es <strong>quién escribe ese código</strong> y <strong>a qué velocidad</strong>. El
          rol de la persona pasa de teclear cada función a dirigir, revisar y refinar lo que la
          IA propone.
        </p>
      </section>

      <section>
        <h2>Vibe coding vs. programación tradicional</h2>
        <p>
          En el desarrollo tradicional, crear una aplicación con autenticación de usuarios,
          base de datos, pagos y un panel de administración puede llevar semanas, incluso para
          un equipo con experiencia: hay que diseñar la arquitectura, escribir cada componente,
          conectar el backend, configurar el despliegue y depurar errores uno a uno.
        </p>
        <p>
          Con vibe coding, ese mismo proyecto se aborda describiendo el objetivo: "quiero una
          app de reservas para una clínica, con login de pacientes, calendario de citas y panel
          para el personal". A partir de ahí, un sistema de agentes de IA especializados —cada
          uno enfocado en una parte del proyecto (arquitectura, frontend, backend, base de
          datos, diseño, pruebas)— genera el código completo en minutos. La persona revisa el
          resultado, prueba la app en un entorno real y pide ajustes con nuevas frases, igual
          que daría instrucciones a un equipo humano.
        </p>
      </section>

      <section>
        <h2>¿Por qué importa para emprendedores y pequeños negocios?</h2>
        <p>
          Hasta hace poco, convertir una idea de negocio en una aplicación real requería
          contratar a un equipo de desarrollo, invertir miles de euros y esperar meses. El vibe
          coding reduce esa barrera de entrada de forma drástica: una persona sin conocimientos
          de programación puede describir su idea —una tienda online, un sistema de citas, una
          plataforma de gestión interna— y obtener una primera versión funcional el mismo día.
        </p>
        <ul>
          <li>Validar una idea de negocio antes de invertir en un equipo de desarrollo.</li>
          <li>Crear herramientas internas a medida sin depender de software genérico.</li>
          <li>Iterar rápido: probar una versión, pedir cambios, lanzar de nuevo.</li>
          <li>Reducir drásticamente el coste y el tiempo de salida al mercado (time-to-market).</li>
        </ul>
      </section>

      <section>
        <h2>Vibe coding en español: el reto del idioma</h2>
        <p>
          La mayoría de las herramientas de vibe coding más conocidas —como Bolt.new,
          Lovable o v0— están pensadas y documentadas en inglés, lo que supone una barrera
          adicional para quienes prefieren trabajar en español o necesitan que la propia
          aplicación generada (textos, formularios, paneles de administración) esté en
          castellano desde el primer momento.
        </p>
        <p>
          <a href="/">Maris AI</a> nace precisamente para cubrir ese hueco: es una plataforma
          de vibe coding que funciona íntegramente en español, pensada para el mercado
          hispanohablante, y genera aplicaciones completas (React, TypeScript, Tailwind,
          Express y MongoDB) listas para producción a partir de una simple descripción en
          castellano.
        </p>
      </section>

      <section>
        <h2>¿Cómo se ve el vibe coding en la práctica?</h2>
        <p>
          Un flujo típico de vibe coding con Maris AI sigue estos pasos:
        </p>
        <ul>
          <li><strong>Describes tu idea:</strong> "Quiero una web para mi gimnasio, con planes de suscripción, calendario de clases y zona privada para socios".</li>
          <li><strong>Los agentes planifican el proyecto:</strong> deciden qué páginas, componentes, modelos de datos e integraciones (pagos, login) necesita la app.</li>
          <li><strong>Se genera el código:</strong> frontend y backend se construyen en paralelo, siguiendo buenas prácticas de arquitectura.</li>
          <li><strong>Pruebas y vista previa en vivo:</strong> puedes ver y usar la aplicación real antes de publicarla.</li>
          <li><strong>Refinamiento por conversación:</strong> "cambia el color principal a azul" o "añade un campo de teléfono al formulario de contacto" — la IA aplica los cambios sobre el proyecto existente.</li>
        </ul>
      </section>
    </PillarLayout>
  );
}
