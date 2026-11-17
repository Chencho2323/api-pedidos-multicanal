import test from "node:test";
import assert from "node:assert/strict";

import {
  CANALES,
  METODOS_PAGO,
  agregarPago,
  aObjeto,
  calcularTotales,
  crearLinea,
  crearPago,
  crearPedido,
  normalizarCanal,
} from "../src/pedido.js";

const lineaBase = {
  sku: "EMP-001",
  nombre: "Hamburguesa clasica",
  cantidad: 2,
  precioUnitario: 1250050,
};

const pedidoBase = {
  canal: "rappi",
  claveExterna: "RAPPI-8891",
  creadoEn: "2026-11-17T10:00:00.000Z",
  lineas: [lineaBase],
};

test("reconoce los canales soportados", () => {
  assert.deepEqual(CANALES, ["rappi", "glovo", "pedidosya", "shopify"]);
  assert.equal(normalizarCanal("Rappi"), "rappi");
  assert.throws(() => normalizarCanal("uber"), /Canal desconocido/);
  assert.throws(() => normalizarCanal(""), /obligatorio/);
});

test("reconoce los metodos de pago", () => {
  assert.ok(METODOS_PAGO.includes("tarjeta"));
  assert.throws(() => crearPago({ metodo: "cheque", monto: 100 }), /Metodo de pago desconocido/);
});

test("crea una linea con subtotal bruto y con descuento", () => {
  const linea = crearLinea(lineaBase);
  assert.equal(linea.subtotalBruto, 2500100);
  assert.equal(linea.subtotal, 2500100);
  assert.equal(linea.descuento, 0);
  assert.ok(Object.isFrozen(linea));

  const conDescuento = crearLinea({ ...lineaBase, descuento: 1000 });
  assert.equal(conDescuento.subtotal, 2499100);
});

test("rechaza lineas mal formadas", () => {
  assert.throws(() => crearLinea({ ...lineaBase, cantidad: 0 }), /no puede ser menor que 1/);
  assert.throws(() => crearLinea({ ...lineaBase, cantidad: 1.5 }), /debe ser un entero/);
  assert.throws(() => crearLinea({ ...lineaBase, precioUnitario: -1 }), /no puede ser menor que 0/);
  assert.throws(() => crearLinea({ ...lineaBase, sku: " " }), /SKU/);
  assert.throws(() => crearLinea({ ...lineaBase, descuento: 999999999 }), /supera su subtotal/);
});

test("crea un pedido canonico con montos en centavos", () => {
  const pedido = crearPedido(pedidoBase);
  assert.equal(pedido.canal, "rappi");
  assert.equal(pedido.claveExterna, "RAPPI-8891");
  assert.equal(pedido.creadoEn, "2026-11-17T10:00:00.000Z");
  assert.equal(pedido.moneda, "COP");
  assert.equal(pedido.lineas.length, 1);
  assert.match(pedido.id, /^[0-9a-f-]{36}$/);
  assert.ok(Object.isFrozen(pedido));
  assert.ok(Object.isFrozen(pedido.lineas));
});

test("acepta lineas ya construidas sin envolverlas de nuevo", () => {
  const linea = crearLinea(lineaBase);
  const pedido = crearPedido({ ...pedidoBase, lineas: [linea] });
  assert.equal(pedido.lineas[0], linea);
});

test("exige al menos una linea", () => {
  assert.throws(() => crearPedido({ ...pedidoBase, lineas: [] }), /al menos una linea/);
  assert.throws(() => crearPedido({ ...pedidoBase, lineas: undefined }), /al menos una linea/);
});

test("rechaza SKU repetidos sin importar mayusculas", () => {
  assert.throws(
    () =>
      crearPedido({
        ...pedidoBase,
        lineas: [lineaBase, { ...lineaBase, sku: "emp-001" }],
      }),
    /repetido/,
  );
});

test("calcula totales y estado de pago", () => {
  const pedido = crearPedido(pedidoBase);
  const totales = calcularTotales(pedido);
  assert.equal(totales.subtotalBruto, 2500100);
  assert.equal(totales.descuentos, 0);
  assert.equal(totales.total, 2500100);
  assert.equal(totales.unidades, 2);
  assert.equal(totales.estadoPago, "pendiente");
  assert.equal(totales.saldo, 2500100);
});

test("el pago parcial deja saldo y estado parcial", () => {
  const pedido = crearPedido({
    ...pedidoBase,
    pagos: [{ metodo: "tarjeta", monto: 1000000, referencia: "AUT-7781" }],
  });
  const totales = calcularTotales(pedido);
  assert.equal(totales.pagado, 1000000);
  assert.equal(totales.saldo, 1500100);
  assert.equal(totales.estadoPago, "parcial");
  assert.equal(pedido.pagos[0].referencia, "AUT-7781");
});

test("el pago completo deja el pedido pagado", () => {
  const pedido = crearPedido({
    ...pedidoBase,
    pagos: [{ metodo: "efectivo", monto: 2500100 }],
  });
  assert.equal(calcularTotales(pedido).estadoPago, "pagado");
  assert.equal(calcularTotales(pedido).saldo, 0);
});

test("no acepta pagos que superen el total", () => {
  assert.throws(
    () => crearPedido({ ...pedidoBase, pagos: [{ metodo: "tarjeta", monto: 2500200 }] }),
    /superan el total/,
  );
});

test("agregar un pago devuelve un pedido nuevo sin mutar el anterior", () => {
  const pedido = crearPedido(pedidoBase);
  const conPago = agregarPago(pedido, { metodo: "billetera", monto: 500000 });
  assert.equal(pedido.pagos.length, 0);
  assert.equal(conPago.pagos.length, 1);
  assert.equal(calcularTotales(conPago).saldo, 2000100);
  assert.throws(() => agregarPago(conPago, { metodo: "tarjeta", monto: 5000000 }), /superan el total/);
});

test("normaliza cliente opcional y notas", () => {
  const pedido = crearPedido({
    ...pedidoBase,
    cliente: { nombre: "  Ana ", telefono: "3001234567" },
    notas: "Sin cebolla",
  });
  assert.deepEqual(pedido.cliente, {
    nombre: "Ana",
    telefono: "3001234567",
    email: null,
  });
  assert.equal(pedido.notas, "Sin cebolla");
});

test("cliente ausente queda en null", () => {
  const pedido = crearPedido(pedidoBase);
  assert.equal(pedido.cliente, null);
  assert.equal(pedido.notas, null);
});

test("rechaza fechas y monedas invalidas", () => {
  assert.throws(() => crearPedido({ ...pedidoBase, creadoEn: "ayer" }), /fecha valida/);
  assert.throws(() => crearPedido({ ...pedidoBase, moneda: "peso" }), /Moneda invalida/);
});

test("acepta una fecha como objeto Date y la devuelve en ISO", () => {
  const pedido = crearPedido({ ...pedidoBase, creadoEn: new Date("2026-11-17T05:00:00Z") });
  assert.equal(pedido.creadoEn, "2026-11-17T05:00:00.000Z");
});

test("aObjeto devuelve una copia plana y serializable", () => {
  const pedido = crearPedido(pedidoBase);
  const plano = aObjeto(pedido);
  assert.deepEqual(plano, JSON.parse(JSON.stringify(pedido)));
  assert.equal(Object.isFrozen(plano), false);
  assert.notEqual(plano.lineas, pedido.lineas);
});
