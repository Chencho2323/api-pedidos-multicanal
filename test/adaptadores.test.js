import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTADORES,
  canalesConAdaptador,
  leerPedido,
  obtenerAdaptador,
} from "../src/adaptadores.js";
import { CANALES, calcularTotales } from "../src/pedido.js";

const pedidoRappi = {
  order_id: "RAP-8842",
  created_at: "2026-11-18T14:05:00Z",
  currency: "COP",
  store: { id: "st-12", name: "Sucursal Chapinero" },
  customer: {
    first_name: "Marcela",
    last_name: "Rincon",
    phone: "+573001112233",
    email: "marcela@ejemplo.com",
  },
  items: [
    { sku: "HAM-001", name: "Hamburguesa doble", quantity: 2, unit_price: "24.900", discount: "2.000" },
    { sku: "PAP-014", name: "Papas medianas", quantity: "1", unit_price: "7.500" },
  ],
  payments: [{ type: "card", amount: "55.300", reference: "AUTH-77" }],
  comments: "Sin cebolla en una",
};

const pedidoGlovo = {
  orderId: "GLV-3321",
  placedAt: "2026-11-18T13:40:00Z",
  currency: "COP",
  customer: { firstName: "Andres", lastName: "Prada", phoneNumber: "3007778899" },
  products: [
    { externalId: "PIZ-008", description: "Pizza personal", quantity: 1, price: "31.200" },
    { externalId: "BEB-002", description: "Gaseosa 400 ml", quantity: 2, price: "4.500", discount: "500" },
  ],
  payment: { method: "online", amount: "39.700" },
  note: "Dejar en porteria",
};

const pedidoPedidosYa = {
  orderCode: "PY-7710",
  createdAt: "2026-11-18T12:15:00Z",
  currency: "COP",
  customer: { name: "Juliana Ospina", phone: "3102223344", email: "juliana@ejemplo.com" },
  details: [
    { code: "SUS-003", product: "Sushi 16 piezas", quantity: 1, unitPrice: "48.000" },
    { code: "POS-001", product: "Postre de arequipe", quantity: 2, unitPrice: "8.900" },
  ],
  paymentMethod: "credit_card",
  paymentAmount: "65.800",
  paymentReference: "PY-TX-991",
  notes: "Cubiertos aparte",
};

const pedidoShopify = {
  id: 5001234,
  name: "#1042",
  created_at: "2026-11-18T11:00:00Z",
  currency: "COP",
  customer: { first_name: "Camilo", last_name: "Vargas", email: "camilo@ejemplo.com" },
  line_items: [
    { sku: "CAM-010", title: "Camiseta negra", quantity: 1, price: "59.900", total_discount: "5.000" },
    { sku: "GOR-002", title: "Gorra bordada", quantity: 2, price: "34.900" },
  ],
  transactions: [
    { kind: "sale", status: "success", gateway: "shopify_payments", amount: "124.700", authorization: "ch_8821" },
    { kind: "sale", status: "failure", gateway: "shopify_payments", amount: "124.700" },
  ],
};

test("los cuatro canales tienen adaptador de entrada", () => {
  assert.deepEqual(canalesConAdaptador(), [...CANALES]);
  for (const canal of CANALES) {
    assert.equal(typeof ADAPTADORES[canal], "function");
    assert.equal(typeof obtenerAdaptador(canal), "function");
  }
});

test("rechaza un canal sin adaptador", () => {
  assert.throws(() => obtenerAdaptador("uber"), /Canal desconocido: uber/);
});

test("mapea un pedido de Rappi al modelo canonico", () => {
  const pedido = leerPedido("rappi", pedidoRappi);

  assert.equal(pedido.canal, "rappi");
  assert.equal(pedido.claveExterna, "RAP-8842");
  assert.equal(pedido.creadoEn, "2026-11-18T14:05:00.000Z");
  assert.equal(pedido.moneda, "COP");
  assert.equal(pedido.lineas.length, 2);
  assert.deepEqual(
    pedido.lineas.map((linea) => linea.sku),
    ["HAM-001", "PAP-014"],
  );
  assert.equal(pedido.lineas[0].precioUnitario, 2490000);
  assert.equal(pedido.lineas[0].descuento, 200000);
  assert.equal(pedido.lineas[1].cantidad, 1);
  assert.equal(pedido.cliente.nombre, "Marcela Rincon");
  assert.equal(pedido.pagos[0].metodo, "tarjeta");
  assert.equal(pedido.notas, "Sin cebolla en una");
  assert.ok(Object.isFrozen(pedido));

  const totales = calcularTotales(pedido);
  assert.equal(totales.total, 5530000);
  assert.equal(totales.pagado, 5530000);
  assert.equal(totales.estadoPago, "pagado");
});

test("mapea un pedido de Glovo y suma el descuento de la linea", () => {
  const pedido = leerPedido("glovo", pedidoGlovo);

  assert.equal(pedido.canal, "glovo");
  assert.equal(pedido.claveExterna, "GLV-3321");
  assert.equal(pedido.cliente.nombre, "Andres Prada");
  assert.equal(pedido.cliente.email, null);
  assert.equal(pedido.pagos[0].metodo, "tarjeta");
  assert.equal(pedido.notas, "Dejar en porteria");

  const totales = calcularTotales(pedido);
  // 31.200 + 2 x 4.500 - 500 = 39.700, que es justo lo cobrado.
  assert.equal(totales.total, 3970000);
  assert.equal(totales.estadoPago, "pagado");
  assert.equal(totales.saldo, 0);
});

test("mapea un pedido de PedidosYa con un solo pago por el total", () => {
  const pedido = leerPedido("pedidosya", pedidoPedidosYa);

  assert.equal(pedido.canal, "pedidosya");
  assert.equal(pedido.claveExterna, "PY-7710");
  assert.equal(pedido.lineas.length, 2);
  assert.equal(pedido.pagos.length, 1);
  assert.equal(pedido.pagos[0].metodo, "tarjeta");
  assert.equal(pedido.pagos[0].referencia, "PY-TX-991");
  assert.equal(calcularTotales(pedido).estadoPago, "pagado");
});

test("mapea Shopify y descarta las transacciones no cobradas", () => {
  const pedido = leerPedido("shopify", pedidoShopify);

  assert.equal(pedido.canal, "shopify");
  assert.equal(pedido.claveExterna, "5001234");
  assert.equal(pedido.lineas[0].descuento, 500000);
  assert.equal(pedido.pagos.length, 1);
  assert.equal(pedido.pagos[0].metodo, "tarjeta");
  assert.equal(pedido.pagos[0].referencia, "ch_8821");

  const totales = calcularTotales(pedido);
  // 59.900 - 5.000 + 2 x 34.900 = 124.700.
  assert.equal(totales.total, 12470000);
  assert.equal(totales.estadoPago, "pagado");
});

test("acepta el nombre del canal en mayusculas y con espacios", () => {
  const pedido = leerPedido("  GLOVO ", pedidoGlovo);
  assert.equal(pedido.canal, "glovo");
});

test("un pedido sin lineas se rechaza con el canal en el mensaje", () => {
  const crudo = { ...pedidoRappi, items: [] };
  assert.throws(() => leerPedido("rappi", crudo), /No se pudo leer el pedido de rappi: .*lineas/);
});

test("un item sin SKU se rechaza y nombra el campo", () => {
  const crudo = {
    ...pedidoRappi,
    items: [{ name: "Sin SKU", quantity: 1, unit_price: "1.000" }],
  };
  assert.throws(() => leerPedido("rappi", crudo), /SKU del item 1/);
});

test("una cantidad en texto con decimales se rechaza", () => {
  const crudo = {
    ...pedidoGlovo,
    products: [{ externalId: "X-1", description: "Algo", quantity: "1.5", price: "1.000" }],
  };
  assert.throws(() => leerPedido("glovo", crudo), /cantidad del producto 1/);
});

test("un monto invalido se rechaza con el campo", () => {
  const crudo = {
    ...pedidoPedidosYa,
    details: [{ code: "X-1", product: "Algo", quantity: 1, unitPrice: "mil pesos" }],
  };
  assert.throws(() => leerPedido("pedidosya", crudo), /precio unitario del detalle 1/);
});

test("un metodo de pago desconocido no se adivina", () => {
  const crudo = { ...pedidoGlovo, payment: { method: "crypto", amount: "39.200" } };
  assert.throws(() => leerPedido("glovo", crudo), /metodo de pago desconocido en glovo: crypto/);
});

test("un pedido crudo que no es objeto se rechaza", () => {
  assert.throws(() => leerPedido("rappi", null), /debe ser un objeto/);
  assert.throws(() => leerPedido("rappi", []), /debe ser un objeto/);
});

test("los pagos que superan el total se rechazan al construir el pedido", () => {
  const crudo = { ...pedidoGlovo, payment: { method: "cash", amount: "99.000" } };
  assert.throws(() => leerPedido("glovo", crudo), /superan el total/);
});
