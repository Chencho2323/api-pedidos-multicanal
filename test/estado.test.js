import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTADO_INICIAL,
  ESTADOS,
  ESTADOS_FINALES,
  esEstadoFinal,
  normalizarEstado,
  puedeTransicionar,
  transicionar,
  transicionesPosibles,
  verificarTransicion,
} from "../src/estado.js";
import { leerPedido } from "../src/adaptadores.js";
import { crearPedido } from "../src/pedido.js";

const crudoRappi = {
  order_id: "RAP-9001",
  created_at: "2026-11-19T12:00:00Z",
  currency: "COP",
  items: [{ sku: "HAM-001", name: "Hamburguesa doble", quantity: 1, unit_price: "24.900" }],
  payments: [{ type: "card", amount: "24.900" }],
};

/** Recorre el camino feliz hasta el estado pedido. */
function pedidoEn(estado) {
  const camino = ["recibido", "confirmado", "en_preparacion", "en_camino", "entregado"];
  let pedido = leerPedido("rappi", crudoRappi);
  for (const paso of camino.slice(1, camino.indexOf(estado) + 1)) {
    pedido = transicionar(pedido, paso);
  }
  return pedido;
}

test("el pedido nace en recibido", () => {
  const pedido = crearPedido({
    canal: "rappi",
    claveExterna: "RAP-1",
    lineas: [{ sku: "A-1", nombre: "Algo", cantidad: 1, precioUnitario: 1000 }],
  });
  assert.equal(pedido.estado, ESTADO_INICIAL);
  assert.equal(pedido.estado, "recibido");
});

test("los estados son los seis del ciclo y dos son finales", () => {
  assert.deepEqual(
    [...ESTADOS],
    ["recibido", "confirmado", "en_preparacion", "en_camino", "entregado", "cancelado"],
  );
  assert.deepEqual([...ESTADOS_FINALES], ["entregado", "cancelado"]);
  assert.equal(esEstadoFinal("entregado"), true);
  assert.equal(esEstadoFinal("cancelado"), true);
  assert.equal(esEstadoFinal("en_camino"), false);
});

test("normalizarEstado acepta mayusculas y espacios", () => {
  assert.equal(normalizarEstado("  En Preparacion "), "en_preparacion");
  assert.equal(normalizarEstado("EN_CAMINO"), "en_camino");
  assert.throws(() => normalizarEstado("despachado"), /Estado desconocido: despachado/);
  assert.throws(() => normalizarEstado("  "), /El estado es obligatorio/);
  assert.throws(() => normalizarEstado(null), /El estado es obligatorio/);
});

test("el camino feliz avanza paso a paso", () => {
  assert.equal(puedeTransicionar("recibido", "confirmado"), true);
  assert.equal(puedeTransicionar("confirmado", "en_preparacion"), true);
  assert.equal(puedeTransicionar("en_preparacion", "en_camino"), true);
  assert.equal(puedeTransicionar("en_camino", "entregado"), true);
});

test("no se salta pasos ni se devuelve el pedido", () => {
  assert.equal(puedeTransicionar("recibido", "en_camino"), false);
  assert.equal(puedeTransicionar("recibido", "entregado"), false);
  assert.equal(puedeTransicionar("confirmado", "recibido"), false);
  assert.equal(puedeTransicionar("en_camino", "en_preparacion"), false);

  assert.throws(
    () => verificarTransicion("recibido", "en_camino"),
    /Transicion invalida de recibido a en_camino; desde recibido solo se puede pasar a confirmado o cancelado/,
  );
});

test("los estados finales no tienen salida", () => {
  assert.deepEqual([...transicionesPosibles("entregado")], []);
  assert.deepEqual([...transicionesPosibles("cancelado")], []);
  assert.throws(
    () => verificarTransicion("entregado", "en_camino"),
    /El pedido esta entregado, que es un estado final: no se puede pasar a en_camino/,
  );
});

test("no se puede cancelar un pedido que ya salio a la calle", () => {
  assert.equal(puedeTransicionar("en_camino", "cancelado"), false);
  assert.equal(puedeTransicionar("en_preparacion", "cancelado"), true);
  assert.equal(puedeTransicionar("recibido", "cancelado"), true);
});

test("repetir el mismo estado no es una transicion", () => {
  assert.throws(() => verificarTransicion("confirmado", "confirmado"), /ya esta en estado confirmado/);
});

test("transicionar devuelve un pedido nuevo y no toca el original", () => {
  const original = leerPedido("rappi", crudoRappi);
  const actualizado = transicionar(original, "confirmado", {
    ahora: new Date("2026-11-19T12:05:00Z"),
  });

  assert.equal(actualizado.estado, "confirmado");
  assert.equal(actualizado.actualizadoEn, "2026-11-19T12:05:00.000Z");
  assert.equal(original.estado, "recibido");
  assert.equal(actualizado.claveExterna, original.claveExterna);
  assert.throws(() => {
    actualizado.estado = "entregado";
  }, TypeError);
});

test("cancelar exige motivo y lo guarda", () => {
  const pedido = leerPedido("rappi", crudoRappi);
  assert.throws(() => transicionar(pedido, "cancelado"), /hay que indicar el motivo/);
  assert.throws(() => transicionar(pedido, "cancelado", { motivo: "   " }), /no puede estar vacio/);

  const cancelado = transicionar(pedido, "cancelado", { motivo: "El cliente no contesto" });
  assert.equal(cancelado.estado, "cancelado");
  assert.equal(cancelado.motivoEstado, "El cliente no contesto");
});

test("una transicion normal no arrastra motivo", () => {
  const pedido = leerPedido("rappi", crudoRappi);
  assert.equal(transicionar(pedido, "confirmado").motivoEstado, null);
});

test("transicionar rechaza pedidos invalidos y fechas malas", () => {
  assert.throws(() => transicionar(null, "confirmado"), /Se esperaba un pedido/);
  assert.throws(() => transicionar([], "confirmado"), /Se esperaba un pedido/);
  assert.throws(
    () => transicionar(leerPedido("rappi", crudoRappi), "confirmado", { ahora: "no es fecha" }),
    /no es valida/,
  );
});

test("transicionar deja avanzar un pedido hasta entregado y ahi se detiene", () => {
  const entregado = pedidoEn("entregado");
  assert.equal(entregado.estado, "entregado");
  assert.throws(() => transicionar(entregado, "cancelado"), /estado final/);
});
