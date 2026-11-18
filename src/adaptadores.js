// Adaptadores de entrada por canal.
//
// Cada canal entrega el pedido a su manera: nombres de campo distintos, montos
// en texto con formatos locales y cantidades a veces como texto. Este modulo
// traduce ese formato crudo al modelo canonico de `pedido.js`. El resto de la
// aplicacion nunca ve el formato original.
//
// La traduccion no rellena huecos: si un campo obligatorio falta, se lanza un
// error que nombra el canal y el campo. Un pedido a medias es peor que un
// pedido rechazado.

import { aCentavos, MONEDA_POR_DEFECTO } from "./dinero.js";
import { CANALES, crearPedido, normalizarCanal } from "./pedido.js";

/** Devuelve el valor de una ruta con notacion de puntos, o undefined. */
function leer(objeto, ruta) {
  if (objeto === null || typeof objeto !== "object") {
    return undefined;
  }
  return ruta
    .split(".")
    .reduce((valor, parte) => (valor === null || valor === undefined ? undefined : valor[parte]), objeto);
}

/** Exige un texto no vacio en la ruta indicada. */
function textoRequerido(objeto, ruta, campo) {
  const valor = leer(objeto, ruta);
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`falta ${campo}`);
  }
  return valor.trim();
}

/** Lee un texto opcional; devuelve null si no viene o viene vacio. */
function textoOpcional(objeto, ruta) {
  const valor = leer(objeto, ruta);
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor === "number") {
    return String(valor);
  }
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

/** Convierte una cantidad escrita como numero o texto a entero positivo. */
function aCantidad(valor, campo) {
  if (typeof valor === "string" && valor.trim() !== "") {
    const limpio = valor.trim();
    if (!/^\d+$/.test(limpio)) {
      throw new Error(`${campo} debe ser un entero positivo: ${valor}`);
    }
    const numero = Number(limpio);
    if (numero < 1) {
      throw new Error(`${campo} debe ser un entero positivo: ${valor}`);
    }
    return numero;
  }
  if (!Number.isInteger(valor) || valor < 1) {
    throw new Error(`${campo} debe ser un entero positivo: ${String(valor)}`);
  }
  return valor;
}

/** Convierte un monto crudo a centavos con el nombre del campo en el error. */
function aMonto(valor, campo) {
  try {
    return aCentavos(valor);
  } catch (error) {
    throw new Error(`${campo} no es un monto valido: ${error.message}`);
  }
}

/** Arma la lista de lineas canonicas a partir de los items crudos. */
function aLineas(items, mapear) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("el pedido no trae lineas");
  }
  return items.map((item, indice) => mapear(item, indice));
}

/** Junta nombre y apellido cuando el canal los manda separados. */
function unirNombre(...partes) {
  const limpios = partes
    .filter((parte) => typeof parte === "string")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
  return limpios.length === 0 ? null : limpios.join(" ");
}

/** Datos del cliente comun a los cuatro canales. */
function aCliente({ nombre, telefono, email }) {
  if (nombre === null && telefono === null && email === null) {
    return null;
  }
  return { nombre, telefono, email };
}

/**
 * Traduce un metodo de pago del canal al vocabulario canonico.
 * La tabla de cada canal es explicita: un metodo que no este no se adivina.
 */
function aMetodoPago(tabla, valor, canal) {
  const crudo = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  const metodo = tabla[crudo];
  if (!metodo) {
    throw new Error(`metodo de pago desconocido en ${canal}: ${String(valor)}`);
  }
  return metodo;
}

const PAGOS_RAPPI = Object.freeze({
  cash: "efectivo",
  efectivo: "efectivo",
  card: "tarjeta",
  tarjeta: "tarjeta",
  transfer: "transferencia",
  transferencia: "transferencia",
  wallet: "billetera",
  billetera: "billetera",
});

const PAGOS_GLOVO = Object.freeze({
  cash: "efectivo",
  card: "tarjeta",
  online: "tarjeta",
  wallet: "billetera",
  bank_transfer: "transferencia",
});

const PAGOS_PEDIDOSYA = Object.freeze({
  cash: "efectivo",
  credit_card: "tarjeta",
  debit_card: "tarjeta",
  wallet: "billetera",
  transfer: "transferencia",
});

const PAGOS_SHOPIFY = Object.freeze({
  shopify_payments: "tarjeta",
  cash: "efectivo",
  cash_on_delivery: "efectivo",
  bank_transfer: "transferencia",
  manual: "transferencia",
  wallet: "billetera",
});

/** Adaptador de Rappi: `order_id`, `items`, `payments`, `comments`. */
function mapearRappi(crudo) {
  const cliente = leer(crudo, "customer");
  const pagos = leer(crudo, "payments");

  return {
    canal: "rappi",
    claveExterna: textoRequerido(crudo, "order_id", "el numero de pedido (order_id)"),
    creadoEn: textoRequerido(crudo, "created_at", "la fecha del pedido (created_at)"),
    moneda: textoOpcional(crudo, "currency") ?? MONEDA_POR_DEFECTO,
    lineas: aLineas(leer(crudo, "items"), (item, indice) => ({
      sku: textoRequerido(item, "sku", `el SKU del item ${indice + 1}`),
      nombre: textoRequerido(item, "name", `el nombre del item ${indice + 1}`),
      cantidad: aCantidad(leer(item, "quantity"), `la cantidad del item ${indice + 1}`),
      precioUnitario: aMonto(
        leer(item, "unit_price"),
        `el precio unitario del item ${indice + 1}`,
      ),
      descuento: aMonto(leer(item, "discount") ?? 0, `el descuento del item ${indice + 1}`),
    })),
    pagos: (Array.isArray(pagos) ? pagos : []).map((pago, indice) => ({
      metodo: aMetodoPago(PAGOS_RAPPI, leer(pago, "type"), "rappi"),
      monto: aMonto(leer(pago, "amount"), `el monto del pago ${indice + 1}`),
      referencia: textoOpcional(pago, "reference"),
    })),
    cliente: aCliente({
      nombre: unirNombre(leer(cliente, "first_name"), leer(cliente, "last_name")),
      telefono: textoOpcional(cliente, "phone"),
      email: textoOpcional(cliente, "email"),
    }),
    notas: textoOpcional(crudo, "comments"),
  };
}

/** Adaptador de Glovo: `orderId`, `products`, un solo `payment`. */
function mapearGlovo(crudo) {
  const cliente = leer(crudo, "customer");
  const pago = leer(crudo, "payment");

  return {
    canal: "glovo",
    claveExterna: textoRequerido(crudo, "orderId", "el numero de pedido (orderId)"),
    creadoEn: textoRequerido(crudo, "placedAt", "la fecha del pedido (placedAt)"),
    moneda: textoOpcional(crudo, "currency") ?? MONEDA_POR_DEFECTO,
    lineas: aLineas(leer(crudo, "products"), (producto, indice) => ({
      sku: textoRequerido(producto, "externalId", `el SKU del producto ${indice + 1}`),
      nombre: textoRequerido(producto, "description", `el nombre del producto ${indice + 1}`),
      cantidad: aCantidad(leer(producto, "quantity"), `la cantidad del producto ${indice + 1}`),
      precioUnitario: aMonto(
        leer(producto, "price"),
        `el precio unitario del producto ${indice + 1}`,
      ),
      descuento: aMonto(
        leer(producto, "discount") ?? 0,
        `el descuento del producto ${indice + 1}`,
      ),
    })),
    pagos:
      pago === null || pago === undefined
        ? []
        : [
            {
              metodo: aMetodoPago(PAGOS_GLOVO, leer(pago, "method"), "glovo"),
              monto: aMonto(leer(pago, "amount"), "el monto del pago"),
              referencia: textoOpcional(pago, "reference"),
            },
          ],
    cliente: aCliente({
      nombre: unirNombre(leer(cliente, "firstName"), leer(cliente, "lastName")),
      telefono: textoOpcional(cliente, "phoneNumber"),
      email: textoOpcional(cliente, "email"),
    }),
    notas: textoOpcional(crudo, "note"),
  };
}

/** Adaptador de PedidosYa: `orderCode`, `details`, `paymentMethod`. */
function mapearPedidosya(crudo) {
  const cliente = leer(crudo, "customer");
  const metodo = leer(crudo, "paymentMethod");
  const monto = leer(crudo, "paymentAmount");
  const tienePago = metodo !== null && metodo !== undefined;
  const pagos = tienePago
    ? [
        {
          metodo: aMetodoPago(PAGOS_PEDIDOSYA, metodo, "pedidosya"),
          monto: aMonto(monto, "el monto del pago"),
          referencia: textoOpcional(crudo, "paymentReference"),
        },
      ]
    : [];

  return {
    canal: "pedidosya",
    claveExterna: textoRequerido(crudo, "orderCode", "el numero de pedido (orderCode)"),
    creadoEn: textoRequerido(crudo, "createdAt", "la fecha del pedido (createdAt)"),
    moneda: textoOpcional(crudo, "currency") ?? MONEDA_POR_DEFECTO,
    lineas: aLineas(leer(crudo, "details"), (detalle, indice) => ({
      sku: textoRequerido(detalle, "code", `el SKU del detalle ${indice + 1}`),
      nombre: textoRequerido(detalle, "product", `el nombre del detalle ${indice + 1}`),
      cantidad: aCantidad(leer(detalle, "quantity"), `la cantidad del detalle ${indice + 1}`),
      precioUnitario: aMonto(
        leer(detalle, "unitPrice"),
        `el precio unitario del detalle ${indice + 1}`,
      ),
      descuento: aMonto(leer(detalle, "discount") ?? 0, `el descuento del detalle ${indice + 1}`),
    })),
    pagos,
    cliente: aCliente({
      nombre: textoOpcional(cliente, "name"),
      telefono: textoOpcional(cliente, "phone"),
      email: textoOpcional(cliente, "email"),
    }),
    notas: textoOpcional(crudo, "notes"),
  };
}

/** Adaptador de Shopify: `line_items`, `transactions`, `customer`. */
function mapearShopify(crudo) {
  const cliente = leer(crudo, "customer");
  const transacciones = Array.isArray(leer(crudo, "transactions")) ? leer(crudo, "transactions") : [];
  const cobradas = transacciones.filter(
    (transaccion) => leer(transaccion, "status") === "success" && leer(transaccion, "kind") === "sale",
  );

  // Shopify manda el id numerico y un nombre legible; la clave externa prefiere
  // el id y cae al nombre solo cuando el id no viene.
  const id = leer(crudo, "id");
  const claveExterna =
    id === null || id === undefined || String(id).trim() === ""
      ? textoRequerido(crudo, "name", "el numero de pedido (name)")
      : String(id).trim();

  return {
    canal: "shopify",
    claveExterna,
    creadoEn: textoRequerido(crudo, "created_at", "la fecha del pedido (created_at)"),
    moneda: textoOpcional(crudo, "currency") ?? MONEDA_POR_DEFECTO,
    lineas: aLineas(leer(crudo, "line_items"), (linea, indice) => ({
      sku: textoRequerido(linea, "sku", `el SKU de la linea ${indice + 1}`),
      nombre: textoRequerido(linea, "title", `el nombre de la linea ${indice + 1}`),
      cantidad: aCantidad(leer(linea, "quantity"), `la cantidad de la linea ${indice + 1}`),
      precioUnitario: aMonto(leer(linea, "price"), `el precio unitario de la linea ${indice + 1}`),
      descuento: aMonto(
        leer(linea, "total_discount") ?? 0,
        `el descuento de la linea ${indice + 1}`,
      ),
    })),
    pagos: cobradas.map((transaccion) => ({
      metodo: aMetodoPago(PAGOS_SHOPIFY, leer(transaccion, "gateway"), "shopify"),
      monto: aMonto(leer(transaccion, "amount"), "el monto de la transaccion"),
      referencia: textoOpcional(transaccion, "authorization"),
    })),
    cliente: aCliente({
      nombre: unirNombre(leer(cliente, "first_name"), leer(cliente, "last_name")),
      telefono: textoOpcional(cliente, "phone"),
      email: textoOpcional(cliente, "email"),
    }),
    notas: textoOpcional(crudo, "note"),
  };
}

/** Mapa de canal a su funcion de mapeo. */
export const ADAPTADORES = Object.freeze({
  rappi: mapearRappi,
  glovo: mapearGlovo,
  pedidosya: mapearPedidosya,
  shopify: mapearShopify,
});

/**
 * Devuelve la funcion de mapeo del canal. Falla si el canal no tiene adaptador,
 * para que agregar un canal nuevo no quede a medias.
 */
export function obtenerAdaptador(canal) {
  const canonico = normalizarCanal(canal);
  const adaptador = ADAPTADORES[canonico];
  if (typeof adaptador !== "function") {
    throw new Error(`El canal ${canonico} no tiene adaptador de entrada`);
  }
  return adaptador;
}

/**
 * Lee el pedido crudo de un canal y devuelve el pedido canonico congelado.
 * Los errores de mapeo salen con el canal en el mensaje.
 */
export function leerPedido(canal, crudo) {
  const canonico = normalizarCanal(canal);
  if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) {
    throw new Error(`El pedido de ${canonico} debe ser un objeto`);
  }

  let mapeado;
  try {
    mapeado = obtenerAdaptador(canonico)(crudo);
  } catch (error) {
    throw new Error(`No se pudo leer el pedido de ${canonico}: ${error.message}`);
  }

  try {
    return crearPedido(mapeado);
  } catch (error) {
    throw new Error(`No se pudo leer el pedido de ${canonico}: ${error.message}`);
  }
}

/** Canales con adaptador de entrada disponible. */
export function canalesConAdaptador() {
  return CANALES.filter((canal) => typeof ADAPTADORES[canal] === "function");
}
