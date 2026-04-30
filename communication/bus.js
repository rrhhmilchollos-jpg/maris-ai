// Agent Messaging Bus — Fase 8 PRO
//
// Cerebro social: cualquier agente puede emitir un evento y cualquier
// otro agente puede escucharlo, sin pasar por el orquestador.
//
// NOTA: este módulo es un scaffold creado a petición explícita. No está
// conectado al servidor API ni a la cola de generación de Maris AI.
// Para usarlo en producción habría que migrar el EventEmitter local a
// un transporte distribuido (Redis pub/sub, NATS, etc.) porque hoy el
// API server corre en un único proceso y los workers de pg-boss en otro.

const EventEmitter = require("events");

const bus = new EventEmitter();

function emit(event, data) {
  bus.emit(event, data);
}

function on(event, callback) {
  bus.on(event, callback);
}

module.exports = { emit, on, bus };
