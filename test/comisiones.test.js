import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURACION_POR_DEFECTO,
  calcularComision,
  conciliar,
  configuracionDeCanal,
  formatearFila,
  liquidar,
  normalizarConfiguracion,
} from "../src/comisiones.js";
import { aTexto } from "../src/dinero.js";
import { crearLinea, crearPedido } from "../src/pedido.js";
import { transicionar } from "../src/estado.js";

/** Lleva un pedido hasta entregado pasando por cada estado intermedio. */
function entregar(pedido) {
  return ["confirmado", "en_preparacion", "en_camino", "entregado"].reduce(
    (actual, estado) => transicionar(actual, estado),
    pedido,
  );
}

/** Pedido de Rappi recien recibido, sin avanzar de estado. */
function pedidoBase({ claveExterna = "RAP-1", cantidad = 1 } = {}) {
  return crearPedido({
    canal: "rappi",
    claveExterna,
    creadoEn: "2026-11-20T12:00:00Z",
    lineas: [crearLinea({ sku: "HAM-001", nombre: "Hamburguesa", cantidad, precioUnitario: 24900 })],
  });
}

/** Pedido de Rappi entregado por 24.900. */
function pedidoRappi(opciones = {}) {
  return entregar(pedidoBase(opciones));
}

/** Pedido de Shopify entregado, con cargo fijo por pedido. */
function pedidoShopify({ claveExterna = "SH-1", precio = 10000 } = {}) {
  const pedido = crearPedido({
    canal: "shopify",
    claveExterna,
    creadoEn: "2026-11-20T12:00:00Z",
    lineas: [crearLinea({ sku: "TEN-1", nombre: "Tenis", cantidad: 1, precioUnitario: precio })],
  });
  return entregar(pedido);
}

test("la comision se calcula sobre el total con descuento aplicado", () => {
  const pedido = crearPedido({
    canal: "rappi",
    claveExterna: "RAP-DESC",
    creadoEn: "2026-11-20T12:00:00Z",
    lineas: [
      crearLinea({
        sku: "HAM-001",
        nombre: "Hamburguesa",
        cantidad: 2,
        precioUnitario: 20000,
        descuento: 5000,
      }),
    ],
  });
  const entregado = entregar(pedido);

  const fila = calcularComision(entregado);
  assert.equal(fila.base, 35000, "base = bruto 40000 menos 5000 de descuento");
  assert.equal(fila.comision, 8750, "25% de 35000");
  assert.equal(fila.ivaComision, 1663, "19% de 8750 redondeado al centavo");
  assert.equal(fila.neto, 24587);
  assert.equal(fila.perdida, false);
  assert.equal(fila.causaComision, true);
});

test("el IVA se calcula sobre la comision y no sobre la venta", () => {
  const fila = calcularComision(pedidoRappi());
  assert.equal(fila.base, 24900);
  // 19% de 24900 seria 4731; sobre la comision de 6225 es 1183.
  assert.equal(fila.ivaComision, 1183);
});

test("un pedido cancelado no genera comision ni neto", () => {
  const cancelado = transicionar(pedidoBase({ claveExterna: "RAP-X" }), "cancelado", {
    motivo: "El cliente no contesto",
  });
  const fila = calcularComision(cancelado);

  assert.equal(fila.cancelado, true);
  assert.equal(fila.causaComision, false);
  assert.equal(fila.base, 24900, "la venta queda registrada");
  assert.equal(fila.comision, 0);
  assert.equal(fila.ivaComision, 0);
  assert.equal(fila.neto, 0);
});

test("un pedido en curso no se liquida todavia", () => {
  const pedido = crearPedido({
    canal: "glovo",
    claveExterna: "GLV-1",
    creadoEn: "2026-11-20T12:00:00Z",
    lineas: [crearLinea({ sku: "PIZ-1", nombre: "Pizza", cantidad: 1, precioUnitario: 30000 })],
  });
  const fila = calcularComision(pedido);

  assert.equal(fila.estado, "recibido");
  assert.equal(fila.comision, 0);
  assert.equal(fila.neto, 0);
});

test("una venta pequeña con cargo fijo sale marcada como perdida", () => {
  const fila = calcularComision(pedidoShopify({ precio: 1000 }));

  assert.equal(fila.cargoFijo, 90000);
  assert.ok(fila.neto < 0, "el cargo fijo supera la venta");
  assert.equal(fila.perdida, true);
});

test("la configuracion se valida y se devuelve congelada", () => {
  const configuracion = normalizarConfiguracion("rappi", {
    comisionBp: 2500,
    ivaComisionBp: 1900,
    cargoFijo: 0,
  });
  assert.ok(Object.isFrozen(configuracion));
  assert.equal(configuracion.comisionBp, 2500);

  assert.throws(
    () => normalizarConfiguracion("rappi", { comisionBp: 10001 }),
    /entre 0 y 10000/,
  );
  assert.throws(
    () => normalizarConfiguracion("rappi", { comisionBp: 2500, cargoFijo: -1 }),
    /cargo fijo de rappi/,
  );
  assert.throws(() => configuracionDeCanal("otro"), /Canal desconocido/);
  assert.throws(
    () => configuracionDeCanal("glovo", { rappi: CONFIGURACION_POR_DEFECTO.rappi }),
    /No hay tasas de comision configuradas para glovo/,
  );
});

test("liquidar agrupa por canal y descarta el pedido repetido", () => {
  const uno = pedidoRappi({ claveExterna: "RAP-1" });
  const dos = pedidoRappi({ claveExterna: "RAP-2", cantidad: 2 });
  const shopify = pedidoShopify();

  // El mismo pedido llega dos veces: el webhook reintento.
  const liquidacion = liquidar([uno, dos, uno, shopify]);

  assert.equal(liquidacion.totales.pedidos, 3);
  assert.deepEqual([...liquidacion.canales], ["rappi", "shopify"]);
  assert.equal(liquidacion.porCanal.rappi.pedidos, 2);
  assert.equal(liquidacion.porCanal.rappi.entregados, 2);
  assert.equal(liquidacion.porCanal.rappi.base, 24900 + 49800);
  assert.equal(liquidacion.totales.base, 24900 + 49800 + 10000);
  assert.equal(
    liquidacion.totales.neto,
    liquidacion.porCanal.rappi.neto + liquidacion.porCanal.shopify.neto,
  );
  assert.equal(liquidacion.porCanal.rappi.comision, 18675, "25% de 74700");
  assert.equal(liquidacion.porCanal.shopify.comision, 290, "2.9% de 10000");
  assert.equal(liquidacion.totales.comision, 18965, "18675 + 290");
  assert.equal(liquidacion.totales.ivaComision, 3604, "el IVA se redondea pedido a pedido");
  assert.equal(liquidacion.totales.cargoFijo, 90000);
  assert.equal(liquidacion.totales.neto, -27869);
  assert.ok(Object.isFrozen(liquidacion.totales));
});

test("liquidar cuenta por separado entregados, cancelados y en curso", () => {
  const entregado = pedidoRappi({ claveExterna: "RAP-E" });
  const cancelado = transicionar(pedidoBase({ claveExterna: "RAP-C" }), "cancelado", {
    motivo: "Direccion errada",
  });
  const enCurso = crearPedido({
    canal: "rappi",
    claveExterna: "RAP-P",
    creadoEn: "2026-11-20T12:00:00Z",
    lineas: [crearLinea({ sku: "HAM-9", nombre: "Hamburguesa", cantidad: 1, precioUnitario: 24900 })],
  });

  const liquidacion = liquidar([entregado, cancelado, enCurso]);
  const fila = liquidacion.porCanal.rappi;

  assert.equal(fila.pedidos, 3);
  assert.equal(fila.entregados, 1);
  assert.equal(fila.cancelados, 1);
  assert.equal(fila.enCurso, 1);
  assert.equal(fila.comision, 6225, "solo el entregado paga comision");
});

test("liquidar rechaza una lista con monedas mezcladas", () => {
  const pesos = pedidoRappi({ claveExterna: "RAP-COP" });
  const dolares = crearPedido({
    canal: "shopify",
    claveExterna: "SH-USD",
    creadoEn: "2026-11-20T12:00:00Z",
    moneda: "USD",
    lineas: [crearLinea({ sku: "TEN-1", nombre: "Tenis", cantidad: 1, precioUnitario: 10000 })],
  });

  assert.throws(() => liquidar([pesos, dolares]), /mezcla monedas: COP, USD/);
  assert.throws(() => liquidar("nada"), /lista de pedidos/);
});

test("liquidar una lista vacia devuelve totales en cero", () => {
  const liquidacion = liquidar([]);
  assert.equal(liquidacion.totales.pedidos, 0);
  assert.equal(liquidacion.totales.comision, 0);
  assert.equal(liquidacion.totales.neto, 0);
  assert.deepEqual([...liquidacion.canales], []);
  assert.equal(liquidacion.moneda, "COP");
});

test("conciliar marca la diferencia contra lo reportado por el canal", () => {
  const liquidacion = liquidar([pedidoRappi({ claveExterna: "RAP-1" }), pedidoShopify()]);
  const cuadra = conciliar(liquidacion, { rappi: 6225, shopify: 290 });
  assert.equal(cuadra.cuadra, true);
  assert.equal(cuadra.diferencias.rappi.diferencia, 0);

  const descuadre = conciliar(liquidacion, { rappi: 6000, shopify: 290 });
  assert.equal(descuadre.cuadra, false);
  assert.equal(descuadre.diferencias.rappi.diferencia, 225);
  assert.equal(descuadre.diferencias.rappi.cuadra, false);

  assert.throws(() => conciliar(liquidacion, { rappi: 62.25 }), /centavos enteros/);
  assert.throws(() => conciliar(liquidacion, null), /reporte de comisiones/);
});

test("formatearFila imprime los montos en texto con dos decimales", () => {
  const liquidacion = liquidar([pedidoRappi({ claveExterna: "RAP-1" })]);
  const texto = formatearFila("rappi", liquidacion.porCanal.rappi);

  assert.match(texto, /^rappi pedidos=1 /);
  assert.ok(texto.includes(`base=${aTexto(24900)}`));
  assert.ok(texto.includes(`neto=${aTexto(17492)}`));
});
