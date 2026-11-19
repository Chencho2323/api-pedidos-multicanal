// Almacen de pedidos con idempotencia por clave externa.
//
// Los canales reintentan. Un webhook que no recibe respuesta a tiempo se
// vuelve a enviar, y el mismo pedido llega dos o tres veces. Si el almacen lo
// guarda cada vez, la conciliacion de comisiones cobra tres pedidos donde hubo
// uno. Por eso la llave del almacen es la pareja (canal, clave externa): es el
// identificador que el canal garantiza estable para un pedido.
//
// Reglas:
// - Registrar dos veces el mismo contenido devuelve el pedido guardado y no
//   genera otro. Eso es la idempotencia.
// - Registrar la misma clave con contenido distinto es un conflicto: el canal
//   mando dos pedidos con el mismo numero. No se adivina cual vale; se rechaza
//   y se deja el original intacto.
// - La llave es por canal. El pedido 100 de Rappi y el 100 de Glovo son dos
//   pedidos distintos.
//
// El almacen vive en memoria y no es persistente: la persistencia llega con
// los endpoints. Lo que fija este modulo es la regla, no el motor de guardado.

import { createHash } from "node:crypto";

import { normalizarCanal } from "./pedido.js";

/**
 * Huella del contenido de un pedido.
 *
 * Se arma a mano, campo por campo, y no con un JSON del objeto completo: el
 * `id` interno se genera en cada lectura y no forma parte de lo que mando el
 * canal, asi que un pedido releido del mismo crudo tendria otra huella y la
 * idempotencia no serviria de nada.
 */
function huellaDe(pedido) {
  const contenido = {
    canal: pedido.canal,
    claveExterna: pedido.claveExterna,
    creadoEn: pedido.creadoEn,
    moneda: pedido.moneda,
    lineas: (pedido.lineas ?? []).map((linea) => ({
      sku: linea.sku,
      nombre: linea.nombre,
      cantidad: linea.cantidad,
      precioUnitario: linea.precioUnitario,
      descuento: linea.descuento ?? 0,
    })),
    pagos: (pedido.pagos ?? []).map((pago) => ({
      metodo: pago.metodo,
      monto: pago.monto,
      referencia: pago.referencia ?? null,
    })),
    cliente: pedido.cliente ?? null,
    notas: pedido.notas ?? null,
  };
  return createHash("sha256").update(JSON.stringify(contenido)).digest("hex");
}

/** Exige un pedido con canal y clave externa y devuelve la llave del almacen. */
function llaveDe(pedido) {
  if (pedido === null || typeof pedido !== "object" || Array.isArray(pedido)) {
    throw new Error("Se esperaba un pedido para guardar");
  }
  const canal = normalizarCanal(pedido.canal);
  if (typeof pedido.claveExterna !== "string" || pedido.claveExterna.trim() === "") {
    throw new Error(`El pedido de ${canal} no trae clave externa`);
  }
  return `${canal}:${pedido.claveExterna.trim()}`;
}

/**
 * Crea un almacen vacio.
 *
 * Cada metodo devuelve objetos nuevos; los pedidos guardados siguen congelados.
 */
export function crearAlmacen() {
  // Un Map conserva el orden de llegada y no reordena al volver a escribir una
  // llave existente, que es justo lo que necesita `listar`.
  const guardados = new Map();

  /** Guarda un pedido o devuelve el que ya estaba. */
  function registrar(pedido) {
    const llave = llaveDe(pedido);
    const huella = huellaDe(pedido);
    const previo = guardados.get(llave);

    if (previo) {
      if (previo.huella !== huella) {
        throw new Error(
          `La clave externa ${pedido.claveExterna} del canal ${previo.pedido.canal} ya existe con otro contenido`,
        );
      }
      return Object.freeze({ pedido: previo.pedido, nuevo: false, duplicado: true });
    }

    guardados.set(llave, { pedido, huella, recibidoEn: new Date().toISOString() });
    return Object.freeze({ pedido, nuevo: true, duplicado: false });
  }

  /**
   * Guarda una lista de pedidos en orden.
   * Devuelve los que entraron y los que ya estaban. Si uno choca con otro
   * contenido en la misma llave, lanza el error con su posicion en el lote:
   * lo anterior al conflicto queda guardado y lo posterior no se procesa.
   */
  function registrarLote(pedidos) {
    if (!Array.isArray(pedidos)) {
      throw new Error("Se esperaba una lista de pedidos");
    }

    const nuevos = [];
    const duplicados = [];

    pedidos.forEach((pedido, indice) => {
      let resultado;
      try {
        resultado = registrar(pedido);
      } catch (error) {
        throw new Error(`Pedido ${indice + 1} del lote: ${error.message}`);
      }
      (resultado.nuevo ? nuevos : duplicados).push(resultado.pedido);
    });

    return Object.freeze({
      nuevos: Object.freeze(nuevos),
      duplicados: Object.freeze(duplicados),
    });
  }

  /** Devuelve el pedido guardado con esa clave, o null si no existe. */
  function obtener(canal, claveExterna) {
    const canalCanonico = normalizarCanal(canal);
    if (typeof claveExterna !== "string" || claveExterna.trim() === "") {
      throw new Error("La clave externa es obligatoria");
    }
    const previo = guardados.get(`${canalCanonico}:${claveExterna.trim()}`);
    return previo ? previo.pedido : null;
  }

  /** Dice si la llave ya esta ocupada, sin traer el pedido. */
  function tiene(canal, claveExterna) {
    return obtener(canal, claveExterna) !== null;
  }

  /**
   * Devuelve los pedidos en orden de llegada. Con `canal` filtra por canal.
   * El filtro no se valida contra CANALES: un canal sin pedidos devuelve vacio.
   */
  function listar({ canal } = {}) {
    const todos = [...guardados.values()].map((entrada) => entrada.pedido);
    if (canal === null || canal === undefined) {
      return Object.freeze(todos);
    }
    const buscado = normalizarCanal(canal);
    return Object.freeze(todos.filter((pedido) => pedido.canal === buscado));
  }

  /** Numero de pedidos distintos guardados. */
  function cantidad() {
    return guardados.size;
  }

  return Object.freeze({ registrar, registrarLote, obtener, tiene, listar, cantidad });
}
