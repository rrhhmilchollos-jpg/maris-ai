// autocannon no publica declaraciones de tipos propias ni existe un paquete
// @types/autocannon. Se usa solo en el script interno de stress-test
// (src/routes/stressTest.ts), así que basta con un stub con la forma
// mínima que ese archivo realmente lee del resultado — no un tipado
// completo de la librería, que no existe.
declare module "autocannon" {
  interface AutocannonResult {
    requests: { total: number; average: number };
    errors: number;
    non2xx: number;
    latency: { average: number; p50: number; p99: number };
    throughput: { average: number };
  }
  interface AutocannonOptions {
    url: string;
    connections?: number;
    duration?: number;
    [key: string]: unknown;
  }
  function autocannon(opts: AutocannonOptions): Promise<AutocannonResult>;
  export default autocannon;
}
