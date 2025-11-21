/****************************************************
 * APP CAJA MERCADO LIMPIO – TERMINAL LAURA
 * Frontend para GitHub Pages + Cloudflare Worker
 *
 * Worker:
 *  https://cajamercadolimpio.santamariapablodaniel.workers.dev/
 *
 * Backend esperado (Apps Script, vía Worker):
 *  - getEstadoCaja()
 *  - registrarMovimientoCaja(tipo, formaPago, importe, categoria, repartidor, turno, banco, nroCheque, usuario, observacion)
 *  - getDatosRendicionEsperada(fecha, turno, repartidor)
 *  - procesarRendicionDesdeRecibo(fechaStr, turno, repartidor, efectivoContado, usuario)
 *  - registrarArqueo(usuario, efectivoFisico)
 ****************************************************/

const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";

// Usuario fijo (Laura). Si después querés login, se adapta fácil.
const USUARIO = "Laura";

// Estado simple en memoria
const estado = {
  saldo: {
    efectivo: 0,
    cheques: 0,
    banco: 0,
    total: 0,
  },
  rendicion: {
    esperado: null,
    contado: 0,
    diferencia: 0,
    estado: null, // "Exacto" / "Sobrante" / "Faltante"
    fileId: null,
  },
};

/****************************************************
 * 🔗 HELPER API – LLAMADA AL WORKER
 ****************************************************/

/**
 * Llama al worker con un payload { fn, params }
 * Se asume que el worker reenvía al Apps Script.
 */
async function apiCall(fn, params = {}) {
  mostrarLoading(true);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fn, params }),
    });

    if (!res.ok) {
      throw new Error("Error HTTP " + res.status);
    }

    const data = await res.json();
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    console.error("apiCall error:", err);
    mostrarToast("Error", err.message || "Error llamando al servidor", "error");
    throw err;
  } finally {
    mostrarLoading(false);
  }
}

/****************************************************
 * ⏱ INICIO SEGURO
 ****************************************************/

document.addEventListener("DOMContentLoaded", () => {
  inicializarUIBasica();
  configurarTabs();
  configurarBotonesAcciones();
  configurarModalMovimiento();
  configurarContadorBilletes();
  configurarRendicion();
  configurarArqueo();

  actualizarEstadoCaja();
});

/****************************************************
 * 🧱 UI BASICA: FECHA / TURNO
 ****************************************************/

function inicializarUIBasica() {
  // Fecha
  const hoy = new Date();
  const spanFecha = document.getElementById("fecha-hoy");
  spanFecha.textContent = formatearFechaCorta(hoy);

  // Turno
  const turno = detectarTurno(hoy);
  const spanTurno = document.getElementById("turno-actual");
  spanTurno.textContent = `Turno ${turno}`;

  // Setear en selector de turno / fecha rendición
  const selectTurno = document.getElementById("select-turno");
  if (selectTurno) selectTurno.value = turno;

  const inputFechaRend = document.getElementById("fecha-rendicion");
  if (inputFechaRend) {
    inputFechaRend.value = hoy.toISOString().slice(0, 10);
  }
}

/****************************************************
 * 🧮 DETECTAR TURNO (igual lógica que backend)
 ****************************************************/

function detectarTurno(fecha = new Date()) {
  const hh = fecha.getHours();
  const mm = fecha.getMinutes();
  const totalMin = hh * 60 + mm;

  // Mañana: 06:00 (360) a 14:00 (840)
  // Tarde: 14:01 (841) a 23:59 (1439)
  if (totalMin >= 360 && totalMin <= 840) return "Mañana";
  if (totalMin >= 841 && totalMin <= 1439) return "Tarde";
  return "Mañana";
}

/****************************************************
 * 📅 FORMATOS FECHA / MONEDA
 ****************************************************/

function formatearFechaCorta(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatearMoneda(valor) {
  if (valor == null || isNaN(valor)) return "–";
  const n = Number(valor);
  return (
    "$" +
    n
      .toFixed(0)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  );
}

/****************************************************
 * 🔄 LOADING BAR
 ****************************************************/

function mostrarLoading(show) {
  const bar = document.getElementById("loading-bar");
  if (!bar) return;
  bar.classList.toggle("hidden", !show);
}

/****************************************************
 * 🔔 TOASTS
 ****************************************************/

function mostrarToast(titulo, mensaje, tipo = "info", duracion = 4000) {
  const cont = document.getElementById("toast-container");
  if (!cont) return;

  const toast = document.createElement("div");
  toast.className = "toast";

  if (tipo === "success") toast.classList.add("toast-success");
  else if (tipo === "error") toast.classList.add("toast-error");
  else toast.classList.add("toast-info");

  toast.innerHTML = `
    <div class="toast-title">${titulo}</div>
    <div class="toast-message">${mensaje}</div>
  `;

  cont.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => {
      toast.remove();
    }, 180);
  }, duracion);
}

/****************************************************
 * 📌 TABS
 ****************************************************/

function configurarTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute("data-tab");

      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const panel = document.getElementById(id);
      if (panel) panel.classList.add("active");
    });
  });

  // Tab por defecto ya está activa en HTML
}

/****************************************************
 * 💰 ESTADO DE CAJA (SALDOS)
 ****************************************************/

async function actualizarEstadoCaja() {
  try {
    const data = await apiCall("getEstadoCaja", {});
    if (!data) return;

    estado.saldo.efectivo = data.efectivo || 0;
    estado.saldo.cheques = data.cheques || 0;
    estado.saldo.banco = data.banco || 0;
    estado.saldo.total = data.total || 0;

    document.getElementById("saldo-efectivo").textContent = formatearMoneda(
      estado.saldo.efectivo
    );
    document.getElementById("saldo-cheques").textContent = formatearMoneda(
      estado.saldo.cheques
    );
    document.getElementById("saldo-banco").textContent = formatearMoneda(
      estado.saldo.banco
    );
    document.getElementById("saldo-total").textContent = formatearMoneda(
      estado.saldo.total
    );

    // También usar para arqueo
    const spanArq = document.getElementById("arqueo-efectivo-sistema");
    if (spanArq) spanArq.textContent = formatearMoneda(estado.saldo.efectivo);
  } catch (err) {
    // ya notificado en apiCall
  }
}

const btnActualizarEstado = document.getElementById("btn-actualizar-estado");
if (btnActualizarEstado) {
  btnActualizarEstado.addEventListener("click", () => actualizarEstadoCaja());
}

/****************************************************
 * ⚡ MOVIMIENTOS RÁPIDOS – ACCIONES
 ****************************************************/

function configurarBotonesAcciones() {
  const cards = document.querySelectorAll(".action-card");
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const action = card.getAttribute("data-action");
      abrirModalMovimiento(action);
    });
  });
}

/****************************************************
 * 🧾 MODAL MOVIMIENTO
 ****************************************************/

const modalMovimiento = document.getElementById("modal-movimiento");
const modalTitle = document.getElementById("modal-mov-title");
const modalClose = document.getElementById("modal-mov-close");
const modalCancel = document.getElementById("modal-mov-cancel");
const modalSave = document.getElementById("modal-mov-save");

function configurarModalMovimiento() {
  if (modalClose) {
    modalClose.addEventListener("click", cerrarModalMovimiento);
  }
  if (modalCancel) {
    modalCancel.addEventListener("click", cerrarModalMovimiento);
  }
  if (modalMovimiento) {
    modalMovimiento.addEventListener("click", (e) => {
      if (e.target === modalMovimiento) cerrarModalMovimiento();
    });
  }
  if (modalSave) {
    modalSave.addEventListener("click", onGuardarMovimiento);
  }

  // Cambio de forma de pago → mostrar banco/cheque
  const selectForma = document.getElementById("mov-forma-pago");
  if (selectForma) {
    selectForma.addEventListener("change", actualizarCamposBancoCheque);
  }
}

function mostrarCampo(selector, show) {
  const el = document.querySelector(`[data-field="${selector}"]`);
  if (!el) return;
  el.style.display = show ? "flex" : "none";
}

function actualizarCamposBancoCheque() {
  const forma = document.getElementById("mov-forma-pago").value;
  if (forma === "Cheque") {
    mostrarCampo("banco", true);
    mostrarCampo("cheque", true);
  } else if (forma === "Banco") {
    mostrarCampo("banco", true);
    mostrarCampo("cheque", false);
  } else {
    mostrarCampo("banco", false);
    mostrarCampo("cheque", false);
  }
}

function abrirModalMovimiento(tipoAccion) {
  // Reseteo mínimo de campos
  document.getElementById("form-movimiento").reset();
  mostrarCampo("proveedor", false);
  mostrarCampo("vehiculo", false);
  mostrarCampo("empleado", false);
  mostrarCampo("banco", false);
  mostrarCampo("cheque", false);

  let titulo = "Nuevo movimiento";
  let tipoOperacion = "Egreso";
  let categoria = "";
  let obsPlaceholder = "Descripción del movimiento";

  if (tipoAccion === "proveedor") {
    titulo = "Pago a proveedor";
    tipoOperacion = "Egreso";
    categoria = "Pago proveedor";
    mostrarCampo("proveedor", true);
    obsPlaceholder = "Pago a proveedor (ej. Maqe)";
  } else if (tipoAccion === "combustible") {
    titulo = "Carga de combustible";
    tipoOperacion = "Egreso";
    categoria = "Combustible";
    mostrarCampo("vehiculo", true);
    obsPlaceholder = "Combustible / Nafta – vehículo";
  } else if (tipoAccion === "adelanto") {
    titulo = "Adelanto a empleado";
    tipoOperacion = "Egreso";
    categoria = "Adelanto";
    mostrarCampo("empleado", true);
    obsPlaceholder = "Adelanto de sueldo a empleado";
  } else if (tipoAccion === "haberes") {
    titulo = "Pago de haberes";
    tipoOperacion = "Egreso";
    categoria = "Haberes";
    mostrarCampo("empleado", true);
    obsPlaceholder = "Pago de sueldo a empleado";
  } else if (tipoAccion === "libre") {
    titulo = "Movimiento libre";
    tipoOperacion = "Egreso"; // por defecto, se puede adaptar en backend si hace falta
    categoria = "Movimiento libre";
    obsPlaceholder = "Detalle del ingreso/egreso";
  }

  modalTitle.textContent = titulo;
  document.getElementById("mov-tipo").value = tipoOperacion;
  document.getElementById("mov-categoria").value = categoria;
  document.getElementById("mov-tipo-operacion").value = tipoOperacion;
  document.getElementById("mov-observacion").placeholder = obsPlaceholder;

  // Forma de pago default: efectivo
  const selectForma = document.getElementById("mov-forma-pago");
  if (selectForma) {
    selectForma.value = "Efectivo";
    actualizarCamposBancoCheque();
  }

  modalMovimiento.classList.remove("hidden");
}

function cerrarModalMovimiento() {
  modalMovimiento.classList.add("hidden");
}

async function onGuardarMovimiento() {
  try {
    const tipo = document.getElementById("mov-tipo").value || "Egreso";
    const categoria = document.getElementById("mov-categoria").value || "";
    const formaPago = document.getElementById("mov-forma-pago").value || "Efectivo";
    const importe = Number(document.getElementById("mov-importe").value || 0);
    const proveedor = document.getElementById("mov-proveedor").value || "";
    const vehiculo = document.getElementById("mov-vehiculo").value || "";
    const empleado = document.getElementById("mov-empleado").value || "";
    const banco = document.getElementById("mov-banco").value || "";
    const nroCheque = document.getElementById("mov-nro-cheque").value || "";
    const observacionManual =
      document.getElementById("mov-observacion").value || "";

    if (!importe || importe <= 0) {
      mostrarToast("Atención", "Ingresá un importe válido.", "error");
      return;
    }

    // Construcción automática de observación
    let observacion = observacionManual;
    if (!observacion) {
      if (categoria === "Pago proveedor" && proveedor) {
        observacion = `Pago a proveedor ${proveedor}`;
      } else if (categoria === "Combustible" && vehiculo) {
        observacion = `Combustible – ${vehiculo}`;
      } else if (categoria === "Adelanto" && empleado) {
        observacion = `Adelanto a ${empleado}`;
      } else if (categoria === "Haberes" && empleado) {
        observacion = `Pago de haberes a ${empleado}`;
      }
    }

    // Repartidor y turno: para estos movimientos, normalmente vacíos
    const repartidor = "";
    const turno = "";

    await apiCall("registrarMovimientoCaja", {
      tipo,
      formaPago,
      importe,
      categoria,
      repartidor,
      turno,
      banco,
      nroCheque,
      usuario: USUARIO,
      observacion,
    });

    mostrarToast(
      "Movimiento registrado",
      `${tipo} ${formatearMoneda(importe)} - ${categoria || formaPago}`,
      "success"
    );
    cerrarModalMovimiento();
    actualizarEstadoCaja();
  } catch (err) {
    // Ya fue informado en apiCall
  }
}

/****************************************************
 * 🔢 CONTADOR DE BILLETES
 ****************************************************/

function configurarContadorBilletes() {
  const inputs = document.querySelectorAll(".input-denom");
  inputs.forEach((input) => {
    input.addEventListener("input", actualizarContadorDesdeInputs);
  });

  const btnLimpiar = document.getElementById("btn-limpiar-contador");
  if (btnLimpiar) {
    btnLimpiar.addEventListener("click", () => {
      inputs.forEach((inp) => (inp.value = ""));
      actualizarContadorDesdeInputs();
    });
  }

  // Inicial
  actualizarContadorDesdeInputs();
}

function actualizarContadorDesdeInputs() {
  let total = 0;

  const filas = document.querySelectorAll(".denom-row");
  filas.forEach((fila) => {
    const valor = Number(fila.getAttribute("data-valor"));
    const input = fila.querySelector(".input-denom");
    const totalLinea = fila.querySelector('[data-role="total-linea"]');

    const cantidad = Number(input.value || 0);
    const subtotal = valor * cantidad;
    total += subtotal;

    if (totalLinea) totalLinea.textContent = formatearMoneda(subtotal);
  });

  estado.rendicion.contado = total;
  const spanTotal = document.getElementById("contador-total");
  if (spanTotal) spanTotal.textContent = formatearMoneda(total);

  // Actualizar resumen si hay esperado
  actualizarResumenRendicion();
}

/****************************************************
 * 📦 RENDICIÓN (ESPERADO VS CONTADO)
 ****************************************************/

function configurarRendicion() {
  const btnEsperado = document.getElementById("btn-cargar-esperado");
  if (btnEsperado) {
    btnEsperado.addEventListener("click", obtenerEfectivoEsperado);
  }

  const btnProcesar = document.getElementById("btn-procesar-rendicion");
  if (btnProcesar) {
    btnProcesar.addEventListener("click", procesarRendicion);
  }
}

async function obtenerEfectivoEsperado() {
  try {
    const repartidor = document.getElementById("select-repartidor").value || "Nico";
    const turno = document.getElementById("select-turno").value || detectarTurno();
    const fechaStr = document.getElementById("fecha-rendicion").value;

    if (!fechaStr) {
      mostrarToast("Atención", "Seleccioná la fecha de la rendición.", "error");
      return;
    }

    const fecha = new Date(fechaStr);

    const data = await apiCall("getDatosRendicionEsperada", {
      fecha: fecha.toISOString(),
      turno,
      repartidor,
    });

    if (!data) return;

    estado.rendicion.esperado = Number(data.efectivoEsperado || 0);
    estado.rendicion.fileId = data.fileId || null;

    document.getElementById("rend-efectivo-esperado").textContent = formatearMoneda(
      estado.rendicion.esperado
    );

    actualizarResumenRendicion();
    mostrarToast(
      "Esperado cargado",
      `Efectivo esperado para ${repartidor} (${turno})`,
      "success"
    );
  } catch (err) {
    // ya notificado
  }
}

function actualizarResumenRendicion() {
  const esperado = estado.rendicion.esperado;
  const contado = estado.rendicion.contado;

  // Mostrar contado
  document.getElementById("rend-efectivo-contado").textContent =
    formatearMoneda(contado);

  // Si no hay esperado todavía, no hay diferencia
  const spanDif = document.getElementById("rend-diferencia");
  const spanEstado = document.getElementById("rend-estado");

  if (esperado == null) {
    spanDif.textContent = "–";
    spanDif.classList.remove("positivo", "negativo");
    spanEstado.textContent = "Esperando esperado…";
    spanEstado.className = "resumen-estado pill pill-soft";
    return;
  }

  const dif = contado - esperado;
  estado.rendicion.diferencia = dif;

  spanDif.textContent = formatearMoneda(dif);
  spanDif.classList.remove("positivo", "negativo");
  if (dif > 0) spanDif.classList.add("positivo");
  else if (dif < 0) spanDif.classList.add("negativo");

  let estadoTxt = "Exacto";
  let pillClass = "resumen-estado pill pill-soft";

  if (dif > 0) {
    estadoTxt = "Sobrante";
    pillClass += " pill-accent";
  } else if (dif < 0) {
    estadoTxt = "Faltante";
    pillClass += " toast-error";
  } else {
    pillClass += " toast-success";
  }

  estado.rendicion.estado = estadoTxt;
  spanEstado.textContent = estadoTxt;
  spanEstado.className = pillClass;
}

async function procesarRendicion() {
  try {
    const esperado = estado.rendicion.esperado;
    const contado = estado.rendicion.contado;

    if (esperado == null) {
      mostrarToast("Atención", "Tenés que obtener el efectivo esperado primero.", "error");
      return;
    }

    if (!contado || contado <= 0) {
      mostrarToast(
        "Atención",
        "El contador de billetes todavía está en cero.",
        "error"
      );
      return;
    }

    const repartidor = document.getElementById("select-repartidor").value || "Nico";
    const turno = document.getElementById("select-turno").value || detectarTurno();
    const fechaStr = document.getElementById("fecha-rendicion").value;

    if (!fechaStr) {
      mostrarToast("Atención", "Seleccioná la fecha de la rendición.", "error");
      return;
    }

    // Confirmación
    const dif = contado - esperado;
    let msgDif = "Exacto";
    if (dif > 0) msgDif = `Sobrante ${formatearMoneda(dif)}`;
    else if (dif < 0) msgDif = `Faltante ${formatearMoneda(Math.abs(dif))}`;

    const ok = confirm(
      `¿Confirmás cargar la rendición?\n\nEsperado: ${formatearMoneda(
        esperado
      )}\nContado: ${formatearMoneda(contado)}\nDiferencia: ${msgDif}`
    );
    if (!ok) return;

    const res = await apiCall("procesarRendicionDesdeRecibo", {
      fechaStr,
      turno,
      repartidor,
      efectivoContado: contado,
      usuario: USUARIO,
    });

    if (res && res.ok) {
      mostrarToast(
        "Rendición procesada",
        `Diferencia: ${formatearMoneda(res.diferencia)} (${res.tipoDiferencia})`,
        "success"
      );

      // Actualizar estado
      await actualizarEstadoCaja();
    } else {
      mostrarToast("Atención", "No se pudo procesar la rendición.", "error");
    }
  } catch (err) {
    // ya notificado
  }
}

/****************************************************
 * 🧮 ARQUEO
 ****************************************************/

function configurarArqueo() {
  const btnCalc = document.getElementById("btn-calcular-arqueo");
  const btnReg = document.getElementById("btn-registrar-arqueo");

  if (btnCalc) {
    btnCalc.addEventListener("click", calcularArqueoLocal);
  }
  if (btnReg) {
    btnReg.addEventListener("click", registrarArqueoServidor);
  }
}

function calcularArqueoLocal() {
  const fisico = Number(
    document.getElementById("arqueo-efectivo-fisico").value || 0
  );
  const sistema = estado.saldo.efectivo;

  const dif = fisico - sistema;
  const spanDif = document.getElementById("arqueo-diferencia");
  const spanRes = document.getElementById("arqueo-resultado");

  spanDif.textContent = formatearMoneda(dif);

  let resTxt = "OK";
  let pillClass = "pill pill-soft";

  if (dif > 0) {
    resTxt = "Sobrante";
    pillClass += " toast-info";
  } else if (dif < 0) {
    resTxt = "Faltante";
    pillClass += " toast-error";
  } else {
    pillClass += " toast-success";
  }

  spanRes.textContent = resTxt;
  spanRes.className = pillClass;
}

async function registrarArqueoServidor() {
  try {
    const fisico = Number(
      document.getElementById("arqueo-efectivo-fisico").value || 0
    );
    if (!fisico || fisico <= 0) {
      mostrarToast("Atención", "Ingresá el efectivo físico contado.", "error");
      return;
    }

    const ok = confirm(
      `¿Registrar arqueo con efectivo físico = ${formatearMoneda(fisico)}?`
    );
    if (!ok) return;

    const res = await apiCall("registrarArqueo", {
      usuario: USUARIO,
      efectivoFisico: fisico,
    });

    if (res) {
      mostrarToast(
        "Arqueo registrado",
        `Resultado: ${res.resultado} – Diferencia ${formatearMoneda(
          res.diferencia
        )}`,
        "success"
      );
      await actualizarEstadoCaja();
    }
  } catch (err) {
    // ya notificado
  }
}
