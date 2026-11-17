// Modelo canonico de pedido.
//
// Cada canal (Rappi, Glovo, PedidosYa, Shopify) entrega el pedido con nombres
// y formatos distintos. Aqui se guarda una sola forma interna: montos en
// centavos enteros, fechas en ISO 8601 y cantidades enteras. Los adaptadores
// de cada canal se encargan de traducir hacia este modelo; el resto de la
// aplicacion nunca ve el formato original.
//
// Los objetos que salen de este modulo son inmutables: se congelan en
// profundidad. Para cambiar un pedido se construye uno nuevo.

import { randomUUID } from "node:crypto";

import { MONEDA_POR_DEFECTO, sumar } from "./dinero.js";

/** Canales soportados por el modelo. */
export const CANALES = Object.freeze(["rappi", "glovo", "pedidosya", "shopify"]);

/** Metodos de pago que se aceptan en un pedido. */
export const METODOS_PAGO = Object.freeze([
  "efectivo",
  "tarjeta",
  "transferencia",
  "billetera",
]);

const ESTADOS_PAGO = Object.freeze(["pendiente", "parcial", "pagado"]);

/** Congela el objeto y sus arreglos u objetos anidados. */
function congelar(valor) {
  if (Array.isArray(valor)) {
    valor.forEach(congelar);
  } else if (valor !== null && typeof valor === "object") {
    Object.values(valor).forEach(congelar);
  }
  return Object.freeze(valor);
}

/** Exige un texto no vacio y devuelve la version sin espacios sobrantes. */
function textoObligatorio(valor, campo) {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`${campo} es obligatorio`);
  }
  return valor.trim();
}

/** Exige un entero mayor o igual a un minimo. */
function enteroMinimo(valor, campo, minimo) {
  if (!Number.isInteger(valor)) {
    throw new Error(`${campo} debe ser un entero: ${valor}`);
  }
  if (valor < minimo) {
    throw new Error(`${campo} no puede ser menor que ${minimo}: ${valor}`);
  }
  return valor;
}

/** Normaliza el nombre del canal a la forma canonica. */
export function normalizarCanal(canal) {
  const limpio = textoObligatorio(canal, "El canal").toLowerCase();
  if (!CANALES.includes(limpio)) {
    throw new Error(`Canal desconocido: ${canal}`);
  }
  return limpio;
}

/**
 * Construye una linea de pedido.
 *
 * El descuento es el valor total descontado de la linea, no un porcentaje.
 * El subtotal que se usa para el total del pedido es el bruto menos ese
 * descuento.
 */
export function crearLinea({ sku, nombre, cantidad, precioUnitario, descuento = 0 }) {
  const lineaSku = textoObligatorio(sku, "El SKU de la linea");
  const lineaNombre = textoObligatorio(nombre, "El nombre de la linea");
  const lineaCantidad = enteroMinimo(cantidad, "La cantidad", 1);
  const precio = enteroMinimo(precioUnitario, "El precio unitario", 0);
  const descuentoLinea = enteroMinimo(descuento, "El descuento de la linea", 0);

  const subtotalBruto = precio * lineaCantidad;
  if (descuentoLinea > subtotalBruto) {
    throw new Error(
      `El descuento de la linea ${lineaSku} supera su subtotal: ${descuentoLinea} > ${subtotalBruto}`,
    );
  }

  return congelar({
    sku: lineaSku,
    nombre: lineaNombre,
    cantidad: lineaCantidad,
    precioUnitario: precio,
    descuento: descuentoLinea,
    subtotalBruto,
    subtotal: subtotalBruto - descuentoLinea,
  });
}

/** Construye un pago del pedido. El monto va en centavos. */
export function crearPago({ metodo, monto, referencia = null }) {
  if (typeof metodo !== "string" || !METODOS_PAGO.includes(metodo.trim().toLowerCase())) {
    throw new Error(`Metodo de pago desconocido: ${metodo}`);
  }
  const montoPago = enteroMinimo(monto, "El monto del pago", 1);

  let referenciaLimpia = null;
  if (referencia !== null && referencia !== undefined) {
    referenciaLimpia = textoObligatorio(referencia, "La referencia del pago");
  }

  return congelar({
    metodo: metodo.trim().toLowerCase(),
    monto: montoPago,
    referencia: referenciaLimpia,
  });
}

/** Normaliza la fecha a ISO 8601 y rechaza valores que no sean fechas. */
function aFechaISO(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} no es una fecha valida: ${valor}`);
  }
  return fecha.toISOString();
}

/** Datos del cliente, todos opcionales. */
function normalizarCliente(cliente) {
  if (cliente === null || cliente === undefined) {
    return null;
  }
  if (typeof cliente !== "object" || Array.isArray(cliente)) {
    throw new Error("El cliente debe ser un objeto");
  }

  const salida = {};
  for (const campo of ["nombre", "telefono", "email"]) {
    const valor = cliente[campo];
    if (valor === null || valor === undefined) {
      salida[campo] = null;
      continue;
    }
    salida[campo] = textoObligatorio(valor, `El ${campo} del cliente`);
  }
  return salida;
}

/**
 * Construye un pedido canonico.
 *
 * Reglas del modelo:
 * - El canal tiene que ser uno de CANALES.
 * - Un pedido necesita al menos una linea y no admite SKU repetidos.
 * - La suma de los pagos no puede superar el total del pedido.
 * - El identificador interno se genera aqui; la clave externa es la del canal.
 */
export function crearPedido({
  canal,
  claveExterna,
  creadoEn = new Date(),
  moneda = MONEDA_POR_DEFECTO,
  lineas,
  pagos = [],
  cliente = null,
  notas = null,
  id = randomUUID(),
}) {
  const canalCanonico = normalizarCanal(canal);
  const clave = textoObligatorio(claveExterna, "La clave externa del pedido");

  const monedaCanonica = textoObligatorio(moneda, "La moneda").toUpperCase();
  if (!/^[A-Z]{3}$/.test(monedaCanonica)) {
    throw new Error(`Moneda invalida: ${moneda}`);
  }

  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new Error("El pedido necesita al menos una linea");
  }
  const lineasCanonicas = lineas.map((linea) => {
    // Se aceptan tanto lineas ya construidas como datos sueltos.
    return Object.isFrozen(linea) && "subtotal" in linea ? linea : crearLinea(linea);
  });

  const vistos = new Set();
  for (const linea of lineasCanonicas) {
    const llave = linea.sku.toLowerCase();
    if (vistos.has(llave)) {
      throw new Error(`El SKU ${linea.sku} esta repetido en el pedido`);
    }
    vistos.add(llave);
  }

  if (!Array.isArray(pagos)) {
    throw new Error("Los pagos deben ser una lista");
  }
  const pagosCanonicos = pagos.map((pago) => {
    return Object.isFrozen(pago) && "monto" in pago ? pago : crearPago(pago);
  });

  const pedido = {
    id: textoObligatorio(id, "El id del pedido"),
    canal: canalCanonico,
    claveExterna: clave,
    creadoEn: aFechaISO(creadoEn, "La fecha del pedido"),
    moneda: monedaCanonica,
    lineas: lineasCanonicas,
    pagos: pagosCanonicos,
    cliente: normalizarCliente(cliente),
    notas: notas === null || notas === undefined ? null : textoObligatorio(notas, "Las notas"),
  };

  const resumen = calcularTotales(pedido);
  if (resumen.pagado > resumen.total) {
    throw new Error(
      `Los pagos superan el total del pedido: ${resumen.pagado} > ${resumen.total}`,
    );
  }

  return congelar(pedido);
}

/**
 * Calcula los totales de un pedido en centavos y el estado de pago.
 * No valida el pedido; sirve tambien para pedidos construidos a mano.
 */
export function calcularTotales(pedido) {
  if (!pedido || !Array.isArray(pedido.lineas)) {
    throw new Error("Se esperaba un pedido con lineas");
  }

  const subtotalBruto = sumar(pedido.lineas.map((linea) => linea.subtotalBruto ?? 0));
  const descuentos = sumar(pedido.lineas.map((linea) => linea.descuento ?? 0));
  const total = subtotalBruto - descuentos;

  const pagos = Array.isArray(pedido.pagos) ? pedido.pagos : [];
  const pagado = sumar(pagos.map((pago) => pago.monto ?? 0));
  const saldo = total - pagado;

  let estadoPago;
  if (pagado === 0) {
    estadoPago = "pendiente";
  } else if (saldo > 0) {
    estadoPago = "parcial";
  } else {
    estadoPago = "pagado";
  }
  if (!ESTADOS_PAGO.includes(estadoPago)) {
    throw new Error(`Estado de pago invalido: ${estadoPago}`);
  }

  return congelar({
    subtotalBruto,
    descuentos,
    total,
    pagado,
    saldo,
    estadoPago,
    unidades: sumar(pedido.lineas.map((linea) => linea.cantidad ?? 0)),
  });
}

/**
 * Devuelve un pedido nuevo con un pago mas. Como el pedido es inmutable, no se
 * modifica el original. Se vuelve a validar que los pagos no superen el total.
 */
export function agregarPago(pedido, pago) {
  const nuevoPago = Object.isFrozen(pago) && "monto" in pago ? pago : crearPago(pago);
  return crearPedido({
    ...pedido,
    pagos: [...pedido.pagos, nuevoPago],
  });
}

/** Devuelve el pedido como objeto plano listo para guardar o serializar. */
export function aObjeto(pedido) {
  return JSON.parse(JSON.stringify(pedido));
}
