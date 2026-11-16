import test from "node:test";
import assert from "node:assert/strict";

import {
  aCentavos,
  aTexto,
  aplicarTasa,
  sumar,
  MONEDA_POR_DEFECTO,
} from "../src/dinero.js";

test("la moneda por defecto es el peso colombiano", () => {
  assert.equal(MONEDA_POR_DEFECTO, "COP");
});

test("convierte numeros a centavos sin errores de punto flotante", () => {
  assert.equal(aCentavos(10), 1000);
  assert.equal(aCentavos(0.1 + 0.2), 30);
  assert.equal(aCentavos(12500.5), 1250050);
});

test("convierte textos con punto decimal", () => {
  assert.equal(aCentavos("12500.50"), 1250050);
  assert.equal(aCentavos("0.99"), 99);
  assert.equal(aCentavos("-3.5"), -350);
});

test("convierte textos con coma decimal", () => {
  assert.equal(aCentavos("12500,50"), 1250050);
  assert.equal(aCentavos("0,05"), 5);
});

test("entiende el separador de miles", () => {
  assert.equal(aCentavos("12.500,50"), 1250050);
  assert.equal(aCentavos("1.234.567,89"), 123456789);
  assert.equal(aCentavos("1,234.56"), 123456);
});

test("rechaza montos invalidos", () => {
  assert.throws(() => aCentavos("abc"), /Monto invalido/);
  assert.throws(() => aCentavos(""), /vacio/);
  assert.throws(() => aCentavos(null), /obligatorio/);
  assert.throws(() => aCentavos("12.345.6"), /Monto invalido/);
  assert.throws(() => aCentavos(Number.NaN), /Monto invalido/);
});

test("devuelve el monto como texto de dos decimales", () => {
  assert.equal(aTexto(1250050), "12500.50");
  assert.equal(aTexto(5), "0.05");
  assert.equal(aTexto(-350), "-3.50");
  assert.equal(aTexto(0), "0.00");
});

test("aTexto rechaza valores que no son centavos enteros", () => {
  assert.throws(() => aTexto(10.5), /centavos enteros/);
});

test("suma montos en centavos", () => {
  assert.equal(sumar([1000, 250, 5]), 1255);
  assert.equal(sumar([]), 0);
  assert.throws(() => sumar([1.5]), /centavos enteros/);
});

test("aplica una tasa en puntos base redondeando al centavo", () => {
  // 23% de 100000 centavos = 23000
  assert.equal(aplicarTasa(100000, 2300), 23000);
  // 15,5% de 10000 centavos = 1550
  assert.equal(aplicarTasa(10000, 1550), 1550);
  // 7,5% de 999 centavos = 74,925 -> 75
  assert.equal(aplicarTasa(999, 750), 75);
});

test("aplicarTasa exige enteros", () => {
  assert.throws(() => aplicarTasa(100.5, 1000), /centavos enteros/);
  assert.throws(() => aplicarTasa(100, 10.5), /puntos base enteros/);
});
