// Utilidades de dinero.
//
// Todo el dinero circula en centavos como entero. Los canales mandan los
// valores en formatos distintos y con decimales en texto; sumar en punto
// flotante produce diferencias de un centavo que despues no cuadran en la
// conciliacion.

export const MONEDA_POR_DEFECTO = "COP";

/**
 * Convierte un monto escrito como numero o texto a centavos.
 * Acepta "12.500,50", "12500.50", 12500.5 y 12500.
 * Lanza un error si el valor no es un monto valido.
 */
export function aCentavos(valor) {
  if (valor === null || valor === undefined) {
    throw new Error("El monto es obligatorio");
  }
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new Error(`Monto invalido: ${valor}`);
    }
    return Math.round(valor * 100);
  }
  if (typeof valor !== "string") {
    throw new Error(`Monto invalido: ${String(valor)}`);
  }

  const limpio = valor.trim().replace(/\s|\u00a0/g, "");
  if (limpio === "") {
    throw new Error("El monto esta vacio");
  }

  const normalizado = normalizarSeparadores(limpio);
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalizado)) {
    throw new Error(`Monto invalido: ${valor}`);
  }

  const negativo = normalizado.startsWith("-");
  const [entero, decimales = ""] = normalizado.replace(/^-/, "").split(".");
  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
  return negativo ? -centavos : centavos;
}

/**
 * Decide si la coma o el punto hacen de separador decimal y deja el monto en
 * forma canonica con punto decimal. Si el texto no se puede interpretar tal
 * cual, se devuelve sin cambios y la validacion posterior lo rechaza.
 */
function normalizarSeparadores(texto) {
  const tieneComa = texto.includes(",");
  const tienePunto = texto.includes(".");

  if (tieneComa && tienePunto) {
    // El ultimo en aparecer es el decimal; el otro agrupa los miles.
    const decimal = texto.lastIndexOf(",") > texto.lastIndexOf(".") ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    const unido = texto.split(miles).join("");
    const corte = unido.lastIndexOf(decimal);
    return `${unido.slice(0, corte)}.${unido.slice(corte + 1)}`;
  }

  const separador = tieneComa ? "," : tienePunto ? "." : null;
  if (separador === null) {
    return texto;
  }

  const partes = texto.split(separador);
  // Varios grupos de tres digitos: es separador de miles.
  if (partes.length > 2) {
    return gruposValidos(partes) ? partes.join("") : texto;
  }
  // Un solo separador: es de miles si deja exactamente tres digitos y el
  // monto no tiene decimales aparte ("1,500" y "12.500" son miles).
  if (partes[1].length === 3 && partes[0].length > 0) {
    return partes.join("");
  }
  return `${partes[0]}.${partes[1]}`;
}

/** Un separador de miles solo agrupa el primer bloque y luego tríos exactos. */
function gruposValidos(grupos) {
  if (grupos[0] === "" || grupos[0].replace(/^-/, "").length > 3) {
    return false;
  }
  return grupos.slice(1).every((grupo) => /^\d{3}$/.test(grupo));
}

/** Devuelve los centavos como texto con dos decimales y punto decimal. */
export function aTexto(centavos) {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Se esperaban centavos enteros: ${centavos}`);
  }
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const entero = Math.floor(abs / 100);
  const resto = String(abs % 100).padStart(2, "0");
  return `${negativo ? "-" : ""}${entero}.${resto}`;
}

/** Suma una lista de montos en centavos sin perder precision. */
export function sumar(centavos) {
  return centavos.reduce((total, valor) => {
    if (!Number.isInteger(valor)) {
      throw new Error(`Se esperaban centavos enteros: ${valor}`);
    }
    return total + valor;
  }, 0);
}

/**
 * Aplica una tasa en puntos base (10000 = 100%) y redondea al centavo.
 * Se usa puntos base para que la tasa de comision de cada canal sea un entero
 * y no un decimal que se arrastre en las multiplicaciones.
 */
export function aplicarTasa(centavos, puntosBase) {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Se esperaban centavos enteros: ${centavos}`);
  }
  if (!Number.isInteger(puntosBase)) {
    throw new Error(`Se esperaban puntos base enteros: ${puntosBase}`);
  }
  return Math.round((centavos * puntosBase) / 10000);
}
