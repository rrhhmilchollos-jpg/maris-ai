import { Layout } from "@/components/layout";
import { motion } from "framer-motion";

export default function PrivacidadPage() {
  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-12">
        <article className="container px-4 md:px-8 mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1 className="text-5xl font-bold text-white mb-4">Política de Privacidad</h1>
            <p className="text-muted-foreground">Última actualización: 28 de mayo de 2026</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="prose prose-invert max-w-none space-y-8"
          >
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Introducción</h2>
              <p className="text-muted-foreground leading-relaxed">
                En Maris AI ("nosotros", "nuestro" o "la Empresa"), respetamos la privacidad de nuestros usuarios ("usuario", "tú" o "tu"). Esta Política de Privacidad explica cómo recopilamos, usamos, divulgamos y salvaguardamos tu información cuando visitas nuestro sitio web marisai.es y utilizas nuestros servicios.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Información que Recopilamos</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Recopilamos información que nos proporcionas directamente e información que se recopila automáticamente cuando utilizas nuestros servicios.
              </p>
              <h3 className="text-xl font-semibold text-white mb-3">Información que proporcionas:</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Nombre, correo electrónico y contraseña (a través de Clerk)</li>
                <li>Información de perfil y preferencias</li>
                <li>Descripciones de aplicaciones que deseas generar</li>
                <li>Información de facturación y pago</li>
                <li>Comunicaciones y consultas de soporte</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. Cómo Usamos tu Información</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Utilizamos la información recopilada para:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Proporcionar, mantener y mejorar nuestros servicios</li>
                <li>Procesar transacciones y enviar información relacionada</li>
                <li>Enviar comunicaciones técnicas y actualizaciones de seguridad</li>
                <li>Responder a tus consultas y solicitudes de soporte</li>
                <li>Cumplir con obligaciones legales</li>
                <li>Prevenir fraude y actividades maliciosas</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Compartir tu Información</h2>
              <p className="text-muted-foreground leading-relaxed">
                No vendemos, comercializamos ni transferimos tu información personal identificable a terceros sin tu consentimiento, excepto en los siguientes casos: (1) proveedores de servicios que nos asisten en la operación de nuestro sitio web y conducción de nuestro negocio, (2) cuando creemos que la divulgación es necesaria para cumplir con la ley, (3) para proteger los derechos, propiedad y seguridad de Maris AI, nuestros usuarios y el público.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Seguridad de tu Información</h2>
              <p className="text-muted-foreground leading-relaxed">
                Utilizamos medidas de seguridad administrativas, técnicas y físicas apropiadas para proteger tu información personal contra acceso, alteración, divulgación o destrucción no autorizados. Sin embargo, ningún método de transmisión por Internet o almacenamiento electrónico es 100% seguro.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Tus Derechos</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Dependiendo de tu ubicación, puedes tener ciertos derechos respecto a tu información personal, incluyendo:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>El derecho a acceder a tu información personal</li>
                <li>El derecho a rectificar información inexacta</li>
                <li>El derecho a solicitar la eliminación de tu información</li>
                <li>El derecho a oponerme al procesamiento de tu información</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Para ejercer estos derechos, contáctanos en privacidad@marisai.es.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. Cookies</h2>
              <p className="text-muted-foreground leading-relaxed">
                Utilizamos cookies y tecnologías similares para mejorar tu experiencia en nuestro sitio web. Puedes controlar el uso de cookies a través de la configuración de tu navegador. Para más información, consulta nuestra Política de Cookies.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Contacto</h2>
              <p className="text-muted-foreground leading-relaxed">
                Si tienes preguntas sobre esta Política de Privacidad o nuestras prácticas de privacidad, contáctanos en:
              </p>
              <p className="text-muted-foreground mt-4">
                <strong className="text-white">Maris AI Inc.</strong><br />
                Email: privacidad@marisai.es<br />
                Sitio web: www.marisai.es
              </p>
            </section>
          </motion.div>
        </article>
      </div>
    </Layout>
  );
}
