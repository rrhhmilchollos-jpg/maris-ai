import { Layout } from "@/components/layout";
import { motion } from "framer-motion";

export function CookiesPage() {
  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-12">
        <article className="container px-4 md:px-8 mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1 className="text-5xl font-bold text-white mb-4">Política de Cookies</h1>
            <p className="text-muted-foreground">Última actualización: 28 de mayo de 2026</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="prose prose-invert max-w-none space-y-8"
          >
            <section>
              <h2 className="text-2xl font-bold text-white mb-4">1. ¿Qué son las Cookies?</h2>
              <p className="text-muted-foreground leading-relaxed">
                Las cookies son pequeños archivos de texto que se almacenan en tu dispositivo (ordenador, tablet o teléfono) cuando visitas un sitio web. Utilizamos cookies para mejorar tu experiencia de usuario, recordar tus preferencias y analizar cómo utilizas nuestro sitio web.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">2. Tipos de Cookies que Utilizamos</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Utilizamos los siguientes tipos de cookies:
              </p>
              <h3 className="text-xl font-semibold text-white mb-3">Cookies Esenciales</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Estas cookies son necesarias para el funcionamiento básico del sitio web, como la autenticación del usuario y la seguridad.
              </p>
              <h3 className="text-xl font-semibold text-white mb-3">Cookies de Rendimiento</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Estas cookies nos ayudan a entender cómo los usuarios interactúan con nuestro sitio web, permitiéndonos mejorar su funcionalidad.
              </p>
              <h3 className="text-xl font-semibold text-white mb-3">Cookies de Análisis</h3>
              <p className="text-muted-foreground leading-relaxed">
                Utilizamos Google Analytics y similares para recopilar información sobre cómo utilizas nuestro sitio web. Esta información se utiliza para mejorar nuestros servicios.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">3. Cómo Controlar las Cookies</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Puedes controlar y/o eliminar cookies según desees. Para más información, visita www.aboutcookies.org. Puedes eliminar todas las cookies que ya están en tu dispositivo y configurar la mayoría de los navegadores para que no acepten cookies.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Sin embargo, si haces esto, es posible que tengas que ajustar manualmente algunas preferencias cada vez que visites nuestro sitio web, y es posible que algunos servicios y funcionalidades no funcionen correctamente.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">4. Cookies de Terceros</h2>
              <p className="text-muted-foreground leading-relaxed">
                Nuestro sitio web puede contener cookies de terceros, como Google Analytics. Estos terceros utilizan cookies para recopilar información sobre tu comportamiento en línea. No tenemos control sobre estas cookies y te recomendamos que revises las políticas de privacidad de estos terceros.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">5. Cambios en Esta Política</h2>
              <p className="text-muted-foreground leading-relaxed">
                Nos reservamos el derecho de actualizar esta Política de Cookies en cualquier momento. Los cambios entrarán en vigor inmediatamente después de su publicación en el sitio web.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-white mb-4">6. Contacto</h2>
              <p className="text-muted-foreground leading-relaxed">
                Si tienes preguntas sobre esta Política de Cookies, contáctanos en:
              </p>
              <p className="text-muted-foreground mt-4">
                <strong className="text-white">Maris AI Inc.</strong><br />
                Email: privacy@marisai.es<br />
                Sitio web: www.marisai.es
              </p>
            </section>
          </motion.div>
        </article>
      </div>
    </Layout>
  );
}
