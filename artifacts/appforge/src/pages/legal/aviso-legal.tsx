import { Layout } from "@/components/layout";
import { motion } from "framer-motion";

export default function AvisoLegalPage() {
  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-12">
        <article className="container px-4 md:px-8 mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1 className="text-5xl font-bold text-white mb-4">Aviso Legal</h1>
            <p className="text-muted-foreground">Última actualización: 28 de mayo de 2026</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="prose prose-invert max-w-none space-y-8"
          >
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. Información Legal</h2>
              <p className="text-muted-foreground leading-relaxed">
                Maris AI Inc. es una empresa constituida de conformidad con las leyes aplicables. Todos los derechos reservados. El contenido de este sitio web, incluyendo pero no limitado a texto, gráficos, logotipos, imágenes y software, está protegido por derechos de autor y otras leyes de propiedad intelectual.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Uso Aceptable</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Al acceder y utilizar este sitio web y nuestros servicios, aceptas cumplir con todas las leyes y regulaciones aplicables. No debes:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Utilizar el sitio web para fines ilegales o no autorizados</li>
                <li>Infringir los derechos de propiedad intelectual de terceros</li>
                <li>Transmitir contenido obsceno, ofensivo o difamatorio</li>
                <li>Intentar obtener acceso no autorizado a nuestros sistemas</li>
                <li>Interferir con el funcionamiento normal del sitio web</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. Limitación de Responsabilidad</h2>
              <p className="text-muted-foreground leading-relaxed">
                Maris AI proporciona el sitio web y los servicios "tal como están" sin garantías de ningún tipo, expresas o implícitas. En la máxima medida permitida por la ley, Maris AI no será responsable de ningún daño indirecto, incidental, especial, consecuente o punitivo que resulte del uso o la imposibilidad de usar el sitio web o los servicios.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Exención de Garantías</h2>
              <p className="text-muted-foreground leading-relaxed">
                Maris AI no garantiza que el sitio web o los servicios serán ininterrumpidos, seguros o libres de errores. No garantizamos la precisión, integridad o utilidad de cualquier información proporcionada a través del sitio web.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Propiedad Intelectual</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                El contenido del sitio web, incluyendo pero no limitado a texto, gráficos, logotipos e imágenes, está protegido por derechos de autor y otras leyes de propiedad intelectual. Tienes permiso para ver y usar el contenido solo para propósitos personales y no comerciales.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Sin embargo, el código generado por nuestros servicios es 100% tuyo. Puedes usarlo, modificarlo, distribuirlo y comercializarlo sin restricciones.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Enlaces Externos</h2>
              <p className="text-muted-foreground leading-relaxed">
                Nuestro sitio web puede contener enlaces a sitios web de terceros. No somos responsables del contenido, precisión o prácticas de estos sitios web externos. El acceso a estos sitios está bajo tu propio riesgo.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">7. Cambios en los Términos</h2>
              <p className="text-muted-foreground leading-relaxed">
                Nos reservamos el derecho de modificar este Aviso Legal en cualquier momento. Los cambios entrarán en vigor inmediatamente después de su publicación en el sitio web. Tu uso continuado del sitio web constituye tu aceptación de los cambios.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">8. Contacto</h2>
              <p className="text-muted-foreground leading-relaxed">
                Si tienes preguntas sobre este Aviso Legal, contáctanos en:
              </p>
              <p className="text-muted-foreground mt-4">
                <strong className="text-white">Maris AI Inc.</strong><br />
                Email: legal@marisai.es<br />
                Sitio web: www.marisai.es
              </p>
            </section>
          </motion.div>
        </article>
      </div>
    </Layout>
  );
}
