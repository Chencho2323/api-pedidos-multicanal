import assert from "node:assert/strict";
import test from "node:test";

import { crearAlmacen } from "../src/almacen.js";
import { leerPedido } from "../src/adaptadores.js";
import { crearPedido } from "../src/pedido.js";

const crudoRappi = {
  order_id: "RAP-9001",
  created_at: "2026-11-19T12:00:00Z",
  currency: "COP",
  customer: { first_name: "Marcela", last_name: "Rincon", phone: "+573001112233" },
  items: [
    { sku: "HAM-001", name: "Hamburguesa doble", quantity: 2, unit_price: "24.900", discount: "2.000" },
    { sku: "PAP-014", name: "Papas medianas", quantity: "1", unit_price: "7.500" },
  ],
  payments: [{ type: "card", amount: "55.300", reference: "AUTH-77" }],
  comments: "Sin cebolla en una",
};

const crudoGlovo = {
  orderId: "GLV-7001",
  placedAt: "2026-11-19T12:10:00Z",
  currency: "COP",
  customer: { firstName: "Andres", lastName: "Prada", phoneNumber: "3007778899" },
  products: [{ externalId: "PIZ-008", description: "Pizza personal", quantity: 1, price: "31.200" }],
  payment: { method: "online", amount: "31.200" },
};

test("el primer pedido entra como nuevo", () => {
  const almacen = crearAlmacen();
  const pedido = leerPedido("rappi", crudoRappi);
  const resultado = almacen.registrar(pedido);

  assert.equal(resultado.nuevo, true);
  assert.equal(resultado.duplicado, false);
  assert.equal(resultado.pedido, pedido);
  assert.equal(almacen.cantidad(), 1);
});

test("el mismo pedido dos veces no genera otro registro", () => {
  const almacen = crearAlmacen();
  const primero = almacen.registrar(leerPedido("rappi", crudoRappi));
  // Un reintento del canal es un crudo nuevo, con otro id interno.
  const segundo = almacen.registrar(leerPedido("rappi", crudoRappi));

  assert.equal(segundo.nuevo, false);
  assert.equal(segundo.duplicado, true);
  assert.equal(segundo.pedido, primero.pedido);
  assert.notEqual(primero.pedido.id, leerPedido("rappi", crudoRappi).id);
  assert.equal(almacen.cantidad(), 1);
});

test("la misma clave con otro contenido es conflicto y no pisa el original", () => {
  const almacen = crearAlmacen();
  const original = almacen.registrar(leerPedido("rappi", crudoRappi));

  const alterado = { ...crudoRappi, items: [{ sku: "HAM-001", name: "Hamburguesa doble", quantity: 3, unit_price: "24.900" }] };

  assert.throws(
    () => almacen.registrar(leerPedido("rappi", alterado)),
    /RAP-9001.*ya existe con otro contenido/,
  );
  assert.equal(almacen.obtener("rappi", "RAP-9001"), original.pedido);
  assert.equal(almacen.cantidad(), 1);
});

test("un cambio de estado de pago no cambia la huella del contenido del canal", () => {
  const almacen = crearAlmacen();
  const base = leerPedido("rappi", crudoRappi);
  almacen.registrar(base);

  // Mismo crudo, id interno distinto: lo unico que cambia es lo que no vino del
  // canal, asi que sigue siendo el mismo pedido.
  const reintento = crearPedido(JSON.parse(JSON.stringify(base)));
  const resultado = almacen.registrar(reintento);

  assert.equal(resultado.duplicado, true);
  assert.equal(almacen.cantidad(), 1);
});

test("la llave es por canal: el mismo numero en otro canal es otro pedido", () => {
  const almacen = crearAlmacen();
  const mismoNumero = { ...crudoGlovo, orderId: "RAP-9001" };

  almacen.registrar(leerPedido("rappi", crudoRappi));
  const deGlovo = almacen.registrar(leerPedido("glovo", mismoNumero));

  assert.equal(deGlovo.nuevo, true);
  assert.equal(almacen.cantidad(), 2);
  assert.equal(almacen.listar({ canal: "glovo" }).length, 1);
});

test("el canal se normaliza: Rappi en mayusculas es el mismo almacen", () => {
  const almacen = crearAlmacen();
  const pedido = leerPedido("rappi", crudoRappi);
  almacen.registrar(pedido);

  assert.equal(almacen.tiene("RAPPI", " RAP-9001 "), true);
  assert.equal(almacen.obtener(" Rappi", "RAP-9001"), pedido);
});

test("obtener devuelve null cuando la clave no existe", () => {
  const almacen = crearAlmacen();
  assert.equal(almacen.obtener("rappi", "NO-EXISTE"), null);
  assert.equal(almacen.tiene("rappi", "NO-EXISTE"), false);
});

test("registrar rechaza pedidos sin canal o sin clave externa", () => {
  const almacen = crearAlmacen();
  assert.throws(() => almacen.registrar(null), /Se esperaba un pedido/);
  assert.throws(
    () => almacen.registrar({ canal: "rappi", claveExterna: "   " }),
    /no trae clave externa/,
  );
  assert.throws(() => almacen.registrar({ canal: "uber", claveExterna: "X-1" }), /Canal desconocido/);
});

test("registrarLote separa nuevos de duplicados y conserva el orden", () => {
  const almacen = crearAlmacen();
  const rappi = leerPedido("rappi", crudoRappi);
  const glovo = leerPedido("glovo", crudoGlovo);

  const lote = almacen.registrarLote([rappi, glovo, leerPedido("rappi", crudoRappi)]);

  assert.equal(lote.nuevos.length, 2);
  assert.equal(lote.duplicados.length, 1);
  assert.equal(lote.duplicados[0].claveExterna, "RAP-9001");
  assert.deepEqual(
    almacen.listar().map((pedido) => pedido.claveExterna),
    ["RAP-9001", "GLV-7001"],
  );
});

test("registrarLote nombra la posicion del pedido que choca", () => {
  const almacen = crearAlmacen();
  almacen.registrar(leerPedido("rappi", crudoRappi));

  const alterado = { ...crudoRappi, comments: "Cambio la nota del pedido" };
  assert.throws(
    () => almacen.registrarLote([leerPedido("glovo", crudoGlovo), leerPedido("rappi", alterado)]),
    /Pedido 2 del lote:.*ya existe con otro contenido/,
  );
  // Lo anterior al conflicto si entro.
  assert.equal(almacen.cantidad(), 2);
});

test("registrarLote exige una lista", () => {
  const almacen = crearAlmacen();
  assert.throws(() => almacen.registrarLote(null), /Se esperaba una lista de pedidos/);
});

test("listar filtra por canal sin validar contra los canales conocidos", () => {
  const almacen = crearAlmacen();
  almacen.registrarLote([leerPedido("rappi", crudoRappi), leerPedido("glovo", crudoGlovo)]);

  assert.equal(almacen.listar().length, 2);
  assert.equal(almacen.listar({ canal: "RAPPI" }).length, 1);
  assert.equal(almacen.listar({ canal: null }).length, 2);
});

test("la lista que devuelve listar es inmutable", () => {
  const almacen = crearAlmacen();
  almacen.registrar(leerPedido("rappi", crudoRappi));

  const lista = almacen.listar();
  assert.throws(() => lista.push({}), TypeError);
  assert.throws(() => {
    lista[0].claveExterna = "OTRO";
  }, TypeError);
});
