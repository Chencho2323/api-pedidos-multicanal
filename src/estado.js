// Maquina de estados del pedido.
//
// Un pedido no salta de "recibido" a "entregado": cada paso lo da alguien y
// deja rastro. Si el codigo permitiera cualquier cambio, un webhook repetido o
// una llamada manual podrian devolver un pedido entregado a la cocina y la
// conciliacion de comisiones contaria dos veces el mismo despacho.
//
// Este modulo fija los estados, las transiciones validas y el error que se
// devuelve cuando alguien intenta una transicion que no existe. No valida
// pagos ni comisiones: eso vive en `pedido.js` y en el calculo de comisiones.

/** Estados por los que pasa un pedido, en orden de avance. */
export const ESTADOS = Object.freeze([
  "recibido",
  "confirmado",
  "en_preparacion",
  "en_camino",
  "entregado",
  "cancelado",
]);

/** Todo pedido arranca aca: llego el crudo del canal y quedo guardado. */
export const ESTADO_INICIAL = "recibido";

/**
 * Estados sin salida. Entregado y cancelado son el final del pedido; volver
 * atras no es una transicion, es un pedido nuevo o un error de captura.
 */
export const ESTADOS_FINALES = Object.freeze(["entregado", "cancelado"]);

/**
 * Transiciones permitidas, por estado de origen.
 *
 * La cancelacion se corta cuando el pedido sale a la calle: despues de
 * `en_camino` lo que hay es una devolucion, no una cancelacion, y la devolucion
 * se maneja como un pedido aparte para que la comision del canal se pueda
 * reclamar con su propio numero.
 */
const TRANSICIONES = Object.freeze({
  recibido: Object.freeze(["confirmado", "cancelado"]),
  confirmado: Object.freeze(["en_preparacion", "cancelado"]),
  en_preparacion: Object.freeze(["en_camino", "cancelado"]),
  en_camino: Object.freeze(["entregado"]),
  entregado: Object.freeze([]),
  cancelado: Object.freeze([]),
});

/** Normaliza un estado escrito a mano y lo valida contra la lista. */
export function normalizarEstado(valor) {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`El estado es obligatorio: ${valor}`);
  }
  const limpio = valor.trim().toLowerCase().replace(/\s+/g, "_");
  if (!ESTADOS.includes(limpio)) {
    throw new Error(`Estado desconocido: ${valor}`);
  }
  return limpio;
}

/** Dice si un estado es final, sin lanzar error si el valor no existe. */
export function esEstadoFinal(estado) {
  return ESTADOS_FINALES.includes(normalizarEstado(estado));
}

/** Lista los estados a los que se puede pasar desde el actual. */
export function transicionesPosibles(estado) {
  return TRANSICIONES[normalizarEstado(estado)];
}

/** Dice si el paso de un estado a otro esta permitido. */
export function puedeTransicionar(desde, hacia) {
  const origen = normalizarEstado(desde);
  const destino = normalizarEstado(hacia);
  return TRANSICIONES[origen].includes(destino);
}

/**
 * Lanza un error explicando por que la transicion no vale.
 *
 * El mensaje nombra los dos estados y, cuando el origen es final, lo dice: al
 * operador le sirve saber que el pedido ya cerro y no que escribio mal.
 */
export function verificarTransicion(desde, hacia) {
  const origen = normalizarEstado(desde);
  const destino = normalizarEstado(hacia);

  if (origen === destino) {
    throw new Error(`El pedido ya esta en estado ${origen}`);
  }
  if (TRANSICIONES[origen].includes(destino)) {
    return destino;
  }

  const permitidos = TRANSICIONES[origen];
  if (permitidos.length === 0) {
    throw new Error(
      `El pedido esta ${origen}, que es un estado final: no se puede pasar a ${destino}`,
    );
  }
  throw new Error(
    `Transicion invalida de ${origen} a ${destino}; desde ${origen} solo se puede pasar a ${permitidos.join(" o ")}`,
  );
}

/**
 * Devuelve un pedido nuevo con el estado cambiado. El pedido es inmutable, asi
 * que el original queda intacto y el llamador decide cual conservar.
 *
 * Cancelar exige motivo: es el unico paso que cierra el pedido sin entrega y
 * despues alguien tiene que explicar por que.
 */
export function transicionar(pedido, nuevoEstado, { motivo = null, ahora = new Date() } = {}) {
  if (pedido === null || typeof pedido !== "object" || Array.isArray(pedido)) {
    throw new Error("Se esperaba un pedido para cambiar de estado");
  }

  const origen = normalizarEstado(pedido.estado ?? ESTADO_INICIAL);
  const destino = verificarTransicion(origen, nuevoEstado);

  let motivoLimpio = null;
  if (motivo !== null && motivo !== undefined) {
    if (typeof motivo !== "string" || motivo.trim() === "") {
      throw new Error("El motivo de la transicion no puede estar vacio");
    }
    motivoLimpio = motivo.trim();
  }
  if (destino === "cancelado" && motivoLimpio === null) {
    throw new Error("Para cancelar un pedido hay que indicar el motivo");
  }

  const fecha = ahora instanceof Date ? ahora : new Date(ahora);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`La fecha del cambio no es valida: ${ahora}`);
  }

  return Object.freeze({
    ...pedido,
    estado: destino,
    actualizadoEn: fecha.toISOString(),
    motivoEstado: motivoLimpio,
  });
}
