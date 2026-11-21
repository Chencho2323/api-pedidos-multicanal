// Comisiones y neto por canal.
//
// Cada canal cobra distinto: un porcentaje sobre la venta, a veces un cargo
// fijo por pedido, y el IVA sobre esa comision. El comercio no ve el total del
// pedido como ingreso, ve el neto despues de lo que se queda el canal. Si ese
// calculo se hace a mano cada mes, un pedido que se cobro dos veces o una
// comision que se aplico sobre el valor equivocado no aparece hasta que la
// caja no cuadra.
//
// Reglas:
// - Las tasas van en puntos base enteros (10000 = 100%) para no arrastrar
//   decimales en las multiplicaciones.
// - La base de la comision es el total del pedido, ya con los descuentos de
//   linea aplicados: el canal cobra sobre lo que efectivamente se vendio.
// - El IVA se calcula sobre la comision, no sobre la venta.
// - Solo el pedido entregado causa comision. Uno cancelado no se le factura al
//   comercio y uno en curso todavia no cerro: cobrarlo antes es adelantar plata
//   que puede no llegar.
// - El neto es lo que le queda al comercio. Puede salir negativo si el cargo
//   fijo del canal supera una venta pequeña; se devuelve asi, marcado, para
//   que la liquidacion no esconda una perdida.
// - La liquidacion no cuenta dos veces el mismo pedido: el webhook reintenta.

import { MONEDA_POR_DEFECTO, aTexto, aplicarTasa, sumar } from "./dinero.js";
import { calcularTotales, normalizarCanal } from "./pedido.js";

/**
 * Tasas por canal.
 *
 * Estos valores son de ejemplo y se cambian por los del contrato de cada
 * cliente. El codigo no los toma de ningun lado remoto: entran por parametro.
 */
export const CONFIGURACION_POR_DEFECTO = Object.freeze({
  rappi: Object.freeze({ comisionBp: 2500, ivaComisionBp: 1900, cargoFijo: 0 }),
  glovo: Object.freeze({ comisionBp: 3000, ivaComisionBp: 1900, cargoFijo: 0 }),
  pedidosya: Object.freeze({ comisionBp: 2200, ivaComisionBp: 1900, cargoFijo: 0 }),
  shopify: Object.freeze({ comisionBp: 290, ivaComisionBp: 1900, cargoFijo: 90000 }),
});

/** Estados que cuentan como venta cerrada para la liquidacion. */
export const ESTADO_QUE_CAUSA_COMISION = "entregado";

/** Entero en un rango, con el nombre del campo en el error. */
function enteroEnRango(valor, campo, maximo) {
  if (!Number.isInteger(valor)) {
    throw new Error(`${campo} debe ser un entero: ${valor}`);
  }
  if (valor < 0 || valor > maximo) {
    throw new Error(`${campo} debe estar entre 0 y ${maximo}: ${valor}`);
  }
  return valor;
}

/**
 * Valida la configuracion de un canal y la devuelve congelada.
 * El cargo fijo va en centavos.
 */
export function normalizarConfiguracion(canal, configuracion) {
  const nombre = normalizarCanal(canal);
  if (configuracion === null || typeof configuracion !== "object") {
    throw new Error(`Falta la configuracion de comision del canal ${nombre}`);
  }

  const comisionBp = enteroEnRango(
    configuracion.comisionBp,
    `La comision de ${nombre} en puntos base`,
    10000,
  );
  const ivaComisionBp = enteroEnRango(
    configuracion.ivaComisionBp ?? 0,
    `El IVA de la comision de ${nombre} en puntos base`,
    10000,
  );
  const cargoFijo = configuracion.cargoFijo ?? 0;
  if (!Number.isInteger(cargoFijo) || cargoFijo < 0) {
    throw new Error(`El cargo fijo de ${nombre} debe ser un entero de centavos: ${cargoFijo}`);
  }

  return Object.freeze({ comisionBp, ivaComisionBp, cargoFijo });
}

/** Devuelve la configuracion validada del canal. */
export function configuracionDeCanal(canal, configuracion = CONFIGURACION_POR_DEFECTO) {
  const nombre = normalizarCanal(canal);
  const tasas = configuracion[nombre];
  if (tasas === null || tasas === undefined) {
    throw new Error(`No hay tasas de comision configuradas para ${nombre}`);
  }
  return normalizarConfiguracion(nombre, tasas);
}

/**
 * Calcula la comision, el IVA sobre la comision y el neto de un pedido.
 *
 * La base sale de los totales del pedido, no de los pagos: un pedido entregado
 * y sin cobrar sigue generando comision, porque la venta existio y el cobro es
 * un problema aparte.
 */
export function calcularComision(pedido, { configuracion = CONFIGURACION_POR_DEFECTO } = {}) {
  if (pedido === null || typeof pedido !== "object" || Array.isArray(pedido)) {
    throw new Error("Se esperaba un pedido para calcular la comision");
  }

  const canal = normalizarCanal(pedido.canal);
  const tasas = configuracionDeCanal(canal, configuracion);
  const totales = calcularTotales(pedido);
  const base = totales.total;

  const estado = pedido.estado ?? null;
  const cancelado = estado === "cancelado";
  const causaComision = estado === ESTADO_QUE_CAUSA_COMISION;

  // Solo el pedido entregado se liquida. Cancelado y en curso quedan en cero,
  // pero conservan su base para que el resumen del canal muestre la venta.
  const comision = causaComision ? aplicarTasa(base, tasas.comisionBp) : 0;
  const ivaComision = causaComision ? aplicarTasa(comision, tasas.ivaComisionBp) : 0;
  const cargoFijo = causaComision ? tasas.cargoFijo : 0;
  const neto = causaComision ? base - comision - ivaComision - cargoFijo : 0;

  return Object.freeze({
    pedidoId: pedido.id ?? null,
    canal,
    claveExterna: pedido.claveExterna ?? null,
    estado,
    moneda: pedido.moneda ?? MONEDA_POR_DEFECTO,
    base,
    comisionBp: causaComision ? tasas.comisionBp : 0,
    comision,
    ivaComision,
    cargoFijo,
    neto,
    perdida: neto < 0,
    cancelado,
    causaComision,
  });
}

/** Llave estable de un pedido para no contarlo dos veces en la liquidacion. */
function llaveDe(pedido) {
  return `${pedido.canal}\u0000${pedido.claveExterna ?? pedido.id}`;
}

/**
 * Liquida una lista de pedidos y agrupa el resultado por canal.
 *
 * La lista puede traer el mismo pedido repetido: el webhook reintento y el
 * llamador volco la cola completa. Se cuenta una sola vez por (canal, clave
 * externa). La moneda tiene que ser la misma en toda la lista: sumar pesos con
 * dolares da un numero que no significa nada.
 */
export function liquidar(pedidos, { configuracion = CONFIGURACION_POR_DEFECTO } = {}) {
  if (!Array.isArray(pedidos)) {
    throw new Error("La liquidacion espera una lista de pedidos");
  }

  const vistos = new Set();
  const unicos = [];
  for (const pedido of pedidos) {
    const llave = llaveDe(pedido);
    if (vistos.has(llave)) {
      continue;
    }
    vistos.add(llave);
    unicos.push(pedido);
  }

  const monedas = new Set(unicos.map((pedido) => pedido.moneda ?? MONEDA_POR_DEFECTO));
  if (monedas.size > 1) {
    throw new Error(`La liquidacion mezcla monedas: ${[...monedas].sort().join(", ")}`);
  }

  const porCanal = {};
  for (const pedido of unicos) {
    const linea = calcularComision(pedido, { configuracion });
    const acumulado = (porCanal[linea.canal] ??= {
      pedidos: 0,
      entregados: 0,
      cancelados: 0,
      enCurso: 0,
      base: 0,
      comision: 0,
      ivaComision: 0,
      cargoFijo: 0,
      neto: 0,
    });

    acumulado.pedidos += 1;
    if (linea.cancelado) {
      acumulado.cancelados += 1;
    } else if (linea.causaComision) {
      acumulado.entregados += 1;
    } else {
      acumulado.enCurso += 1;
    }
    acumulado.base += linea.base;
    acumulado.comision += linea.comision;
    acumulado.ivaComision += linea.ivaComision;
    acumulado.cargoFijo += linea.cargoFijo;
    acumulado.neto += linea.neto;
  }

  const canales = Object.keys(porCanal).sort();
  const resumen = {
    moneda: unicos.length === 0 ? MONEDA_POR_DEFECTO : monedas.values().next().value,
    pedidos: unicos.length,
    base: sumar(unicos.map((pedido) => calcularTotales(pedido).total)),
    comision: 0,
    ivaComision: 0,
    cargoFijo: 0,
    neto: 0,
  };
  for (const canal of canales) {
    resumen.comision += porCanal[canal].comision;
    resumen.ivaComision += porCanal[canal].ivaComision;
    resumen.cargoFijo += porCanal[canal].cargoFijo;
    resumen.neto += porCanal[canal].neto;
  }

  return Object.freeze({
    moneda: resumen.moneda,
    porCanal: Object.freeze(porCanal),
    canales: Object.freeze(canales),
    totales: Object.freeze(resumen),
  });
}

/**
 * Cuadra la liquidacion contra lo que el canal reporto como comision cobrada.
 * La diferencia es lo que hay que reclamar (positiva) o lo que el canal cobro
 * de mas (negativa). Se compara por canal y en centavos, sin tolerancias: un
 * centavo de diferencia es un pedido mal leido.
 */
export function conciliar(liquidacion, reportadoPorCanal) {
  if (liquidacion === null || typeof liquidacion !== "object") {
    throw new Error("Falta la liquidacion para conciliar");
  }
  if (reportadoPorCanal === null || typeof reportadoPorCanal !== "object") {
    throw new Error("Falta el reporte de comisiones del canal");
  }

  const diferencias = {};
  const canales = new Set([
    ...Object.keys(liquidacion.porCanal ?? {}),
    ...Object.keys(reportadoPorCanal),
  ]);

  for (const canal of [...canales].sort()) {
    const calculado = liquidacion.porCanal?.[canal]?.comision ?? 0;
    const reportado = reportadoPorCanal[canal];
    if (!Number.isInteger(reportado)) {
      throw new Error(`La comision reportada de ${canal} debe ir en centavos enteros: ${reportado}`);
    }
    diferencias[canal] = Object.freeze({
      calculado,
      reportado,
      // Positivo: el canal cobro menos de lo que le toca y falta cobrar.
      diferencia: calculado - reportado,
      cuadra: calculado === reportado,
    });
  }

  return Object.freeze({
    moneda: liquidacion.moneda ?? MONEDA_POR_DEFECTO,
    diferencias: Object.freeze(diferencias),
    cuadra: Object.values(diferencias).every((fila) => fila.cuadra),
  });
}

/** Arma el texto de una fila de liquidacion, con montos ya formateados. */
export function formatearFila(canal, fila) {
  const montos = ["base", "comision", "ivaComision", "cargoFijo", "neto"]
    .map((campo) => `${campo}=${aTexto(fila[campo])}`)
    .join(" ");
  return `${canal} pedidos=${fila.pedidos} ${montos}`;
}
