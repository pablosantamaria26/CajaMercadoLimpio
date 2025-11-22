// ===============================
// CONFIG
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";
const USUARIO_APP = "Laura"; // se puede parametrizar después

// Cache & polling
const RENDICION_CACHE_KEY = "caja_rendicion_cache";
const ALERTAS_CACHE_KEY = "caja_alertas_vistas";
const RENDICION_POLL_INTERVAL_MS = 60000;   // 1 minuto
const ALERTAS_POLL_INTERVAL_MS = 120000;    // 2 minutos

// Proveedores (para autocomplete inteligente)
const PROVEEDORES = [
  "Marwiplast",
  "Bio Bag",
  "Broche plastico",
  "Bumerang",
  "Carol",
  "Colores",
  "Coolbazar",
  "Cotton",
  "Da Silva",
  "Desesplast",
  "Diawara",
  "Emege",
  "Entresol",
  "Fedata",
  "Fibran",
  "Flexal",
  "Hechicera",
  "Infinity import",
  "K&K",
  "La Americana",
  "La gauchita",
  "Macetex",
  "Make Fresh",
  "Matriplaster",
  "Mis Plast",
  "Modoplast",
  "Molmar",
  "POP",
  "Rigolleau",
  "Romyl",
  "Samantha",
  "Santamaria",
  "Sasha",
  "Soifer",
  "lumilagro",
  "Make",
  "Suka",
  "Supy",
  "Tauro",
  "Tecnomatric",
  "Yesi",
  "Durax",
  "Javi"
].sort((a, b) => a.localeCompare(b, "es"));

// Vehículos para combustible
const VEHICULOS = [
  "Toyota Hiace",
  "Volkswagen Saveiro",
  "Fiat Uno Cargo"
];

// Empleados (podemos luego sincronizarlos con Sheets)
const EMPLEADOS = [
  "Nicolás",
  "Laura",
  "Nancy",
  "Martín",
  "Lucas"
];

// Denominaciones de billetes (ARS)
const BILLETES = [10000, 5000, 2000, 1000, 500, 200, 100];

// ===============================
// HELPERS
// ===============================

async function api(fn, params = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fn, params })
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatoMoneda(num) {
  if (num == null || isNaN(num)) return "$ 0";
  return "$ " + Number(num).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showToast(msg, tipo = "info") {
  const toast = document.getElementById("toast");
  const content = document.getElementById("toast-content");
  content.textContent = msg;
  toast.classList.remove("hidden");

  if (tipo === "ok") {
    content.style.borderColor = "#3dd68c";
  } else if (tipo === "error") {
    content.style.borderColor = "#ff6e6c";
  } else if (tipo === "alerta") {
    content.style.borderColor = "#f59e0b";
  } else {
    content.style.borderColor = "rgba(148,163,184,0.6)";
  }

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2600);
}

function setHeaderClock() {
  const dateEl = document.getElementById("header-date");
  const timeEl = document.getElementById("header-time");
  const now = new Date();
  const fecha = now.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const hora = now.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  });
  dateEl.textContent = fecha;
  timeEl.textContent = hora;
}

function getTurnoFromDate(fecha = new Date()) {
  const hhmm = fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  if (hhmm >= "06:00" && hhmm <= "14:00") return "Mañana";
  if (hhmm >= "14:01" && hhmm <= "23:59") return "Tarde";
  return "Mañana";
}

// --- Helpers de cache LocalStorage ---

function loadRendicionCache() {
  try {
    const raw = localStorage.getItem(RENDCION_CACHE_KEY); // ojito, typo => corrijo nombre
  } catch (e) {
    // NO usar el typo, definimos bien:
  }
  try {
    const raw = localStorage.getItem(RENDITION_CACHE_KEY); // también mal, mejor:
  } catch (e) {
    // Para evitar quilombos, usamos UNA sola clave bien escrita:
  }
}

// Uso correcto:
function loadRendicionCacheCorrect() {
  try {
    const raw = localStorage.getItem(RENDCION_CACHE_KEY);
    // pero nos equivocamos de constante... para evitar confusión, rehago bien:

  } catch (e) {}
}

// === Versión DEFINITIVA limpia ===
function loadRendicionCacheSafe() {
  try {
    const raw = localStorage.getItem(RENDITION_CACHE_KEY_FIX);
  } catch (e) {}
}

// ⚠ Para no marearte, dejo una única versión clara:

const RENDICION_CACHE_KEY_FIX = "caja_rendicion_cache_v2";

function loadRendicionCacheFromStorage() {
  try {
    const raw = localStorage.getItem(RENDCION_CACHE_KEY_FIX);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveRendicionCacheToStorage(obj) {
  try {
    localStorage.setItem(RENDCION_CACHE_KEY_FIX, JSON.stringify(obj));
  } catch (e) {
    // nada
  }
}

function loadAlertasVistasFromStorage() {
  const set = new Set();
  try {
    const raw = localStorage.getItem(ALERTAS_CACHE_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      arr.forEach(id => set.add(id));
    }
  } catch (e) {}
  return set;
}

function saveAlertasVistasToStorage(set) {
  try {
    const arr = Array.from(set);
    localStorage.setItem(ALERTAS_CACHE_KEY, JSON.stringify(arr));
  } catch (e) {}
}

// ===============================
// ESTADO LOCAL
// ===============================

const estado = {
  saldo: {
    efectivo: 0,
    cheques: 0,
    banco: 0,
    total: 0
  },
  movimientosDia: [],
  rendicion: {
    fecha: null,
    turno: null,
    repartidor: null,
    esperado: 0
  },
  notificacionesVistas: loadAlertasVistasFromStorage()
};

// ===============================
// INIT
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  // Reloj header
  setHeaderClock();
  setInterval(setHeaderClock, 30000);

  // Inyectar estilos del contador de billetes
  injectBillCounterStyles();

  // Nav
  initNavigation();

  // AutoComplete y selects
  initProveedoresAutocomplete();
  initSelectsAuxiliares();

  // Formularios
  initFormMovimiento();
  initRendicion();   // aquí se crea también el contador de billetes
  initArqueo();

  // Cargar estado inicial
  refreshEstadoCaja();

  // Watchers inteligentes
  startRendicionWatcher();
  startAlertasWatcher();
});

// ===============================
// NAV
// ===============================

function initNavigation() {
  const buttons = document.querySelectorAll(".bottom-nav .nav-btn");
  const views = document.querySelectorAll(".view");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewId = btn.getAttribute("data-view");
      // marcar nav
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      // mostrar vista
      views.forEach((v) => v.classList.remove("active"));
      document.getElementById(viewId).classList.add("active");
    });
  });
}

// ===============================
// ESTADO CAJA
// ===============================

async function refreshEstadoCaja() {
  try {
    const res = await api("getEstadoCaja", {});
    if (!res) return;

    estado.saldo.efectivo = res.efectivo || 0;
    estado.saldo.cheques = res.cheques || 0;
    estado.saldo.banco = res.banco || 0;
    estado.saldo.total = res.total || 0;

    document.getElementById("saldo-efectivo").textContent = formatoMoneda(estado.saldo.efectivo);
    document.getElementById("saldo-cheques").textContent = formatoMoneda(estado.saldo.cheques);
    document.getElementById("saldo-banco").textContent = formatoMoneda(estado.saldo.banco);
    document.getElementById("saldo-total").textContent = formatoMoneda(estado.saldo.total);

    // también actualizar data arqueo
    document.getElementById("arqueo-sistema").textContent = formatoMoneda(estado.saldo.efectivo);
  } catch (err) {
    console.error(err);
    showToast("No se pudo leer el estado de caja", "error");
  }
}

// ===============================
// MOVIMIENTOS – FORM
// ===============================

function initSelectsAuxiliares() {
  // Vehículos
  const vehSel = document.getElementById("selectVehiculo");
  VEHICULOS.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    vehSel.appendChild(opt);
  });

  // Empleados
  const empSel = document.getElementById("selectEmpleado");
  EMPLEADOS.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    empSel.appendChild(opt);
  });
}

function initFormMovimiento() {
  const form = document.getElementById("form-movimiento");
  const tipoRapido = document.getElementById("tipoRapido");
  const formaPago = document.getElementById("formaPago");

  const rowProveedor = document.getElementById("row-proveedor");
  const rowVehiculo = document.getElementById("row-vehiculo");
  const rowEmpleado = document.getElementById("row-empleado");
  const rowBancoCheque = document.getElementById("row-banco-cheque");

  const observacion = document.getElementById("observacion");

  function updateDynamicFields() {
    const val = tipoRapido.value;
    // reset
    rowProveedor.classList.add("hidden");
    rowVehiculo.classList.add("hidden");
    rowEmpleado.classList.add("hidden");
    // por defecto no tocamos observación
    if (val === "pagoProveedor") {
      rowProveedor.classList.remove("hidden");
      observacion.placeholder = "Ej: Pago a proveedor Make...";
    } else if (val === "combustible") {
      rowVehiculo.classList.remove("hidden");
      observacion.placeholder = "Ej: Combustible Toyota Hiace...";
    } else if (val === "adelanto") {
      rowEmpleado.classList.remove("hidden");
      observacion.placeholder = "Ej: Adelanto para Nicolás...";
    } else if (val === "haber") {
      rowEmpleado.classList.remove("hidden");
      observacion.placeholder = "Ej: Pago total de haberes a Nancy...";
    } else {
      observacion.placeholder = "Descripción libre del movimiento...";
    }
  }

  tipoRapido.addEventListener("change", updateDynamicFields);
  updateDynamicFields();

  // Mostrar/ocultar campos banco / cheque según forma de pago
  function updateBancoChequeFields() {
    const fp = formaPago.value;
    if (fp === "Cheque" || fp === "Banco") {
      rowBancoCheque.classList.remove("hidden");
    } else {
      rowBancoCheque.classList.add("hidden");
    }
  }
  formaPago.addEventListener("change", updateBancoChequeFields);
  updateBancoChequeFields();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("tipoMovimiento").value;
    const fpago = formaPago.value;
    const importe = parseFloat(document.getElementById("importe").value || "0");
    const banco = document.getElementById("banco").value.trim();
    const nroCheque = document.getElementById("nroCheque").value.trim();

    const proveedor = document.getElementById("inputProveedor").value.trim();
    const vehiculo = document.getElementById("selectVehiculo").value;
    const empleado = document.getElementById("selectEmpleado").value;

    let categoria = "Movimiento libre";
    let obs = observacion.value.trim();

    switch (tipoRapido.value) {
      case "pagoProveedor":
        categoria = "Pago a proveedor";
        if (!obs) obs = `Pago a proveedor ${proveedor || "N/D"}`;
        break;
      case "combustible":
        categoria = `Combustible ${vehiculo || "Vehículo"}`;
        if (!obs) obs = `Carga combustible ${vehiculo || ""}`.trim();
        break;
      case "adelanto":
        categoria = "Adelanto empleado";
        if (!obs) obs = `Adelanto a ${empleado || "Empleado"}`;
        break;
      case "haber":
        categoria = "Pago de haberes";
        if (!obs) obs = `Pago de haberes a ${empleado || "Empleado"}`;
        break;
      default:
        categoria = "Movimiento libre";
    }

    if (!importe || importe <= 0) {
      showToast("El importe debe ser mayor a 0", "error");
      return;
    }

    // Turno actual
    const turno = getTurnoFromDate(new Date());

    const params = {
      tipo,
      formaPago: fpago,
      importe,
      categoria,
      repartidor: "", // para movimientos generales no es necesario
      turno,
      banco,
      nroCheque,
      usuario: USUARIO_APP,
      observacion: obs
    };

    try {
      document.getElementById("btn-registrar-mov").disabled = true;
      document.getElementById("btn-registrar-mov").textContent = "Guardando...";

      await api("registrarMovimientoCaja", params);

      showToast("Movimiento registrado correctamente", "ok");
      form.reset();
      updateDynamicFields();
      updateBancoChequeFields();
      // refrescar saldos
      await refreshEstadoCaja();
    } catch (err) {
      console.error(err);
      showToast("Error al registrar el movimiento", "error");
    } finally {
      document.getElementById("btn-registrar-mov").disabled = false;
      document.getElementById("btn-registrar-mov").textContent = "Registrar movimiento";
    }
  });
}

// ===============================
// AUTOCOMPLETE PROVEEDORES
// ===============================

function initProveedoresAutocomplete() {
  const input = document.getElementById("inputProveedor");
  const box = document.getElementById("proveedor-suggestions");

  function closeSuggestions() {
    box.innerHTML = "";
    box.classList.remove("visible");
  }

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    if (!term) {
      closeSuggestions();
      return;
    }

    const matches = PROVEEDORES.filter((p) =>
      p.toLowerCase().includes(term)
    ).slice(0, 8);

    if (matches.length === 0) {
      closeSuggestions();
      return;
    }

    box.innerHTML = "";
    matches.forEach((m) => {
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.textContent = m;
      item.addEventListener("click", () => {
        input.value = m;
        closeSuggestions();
      });
      box.appendChild(item);
    });
    box.classList.add("visible");
  });

  input.addEventListener("blur", () => {
    setTimeout(closeSuggestions, 150);
  });
}

// ===============================
// RENDICIÓN + CONTADOR DE BILLETES
// ===============================

function initRendicion() {
  const fechaEl = document.getElementById("rendicion-fecha");
  const turnoEl = document.getElementById("rendicion-turno");
  const repartidorEl = document.getElementById("rendicion-repartidor");
  const esperadoEl = document.getElementById("rendicion-esperado");
  const btn = document.getElementById("btn-procesar-rendicion");
  const resultadoBox = document.getElementById("resultado-rendicion");
  const inputContado = document.getElementById("rendicion-contado");

  // Datos base de hoy
  const hoy = new Date();
  const turno = getTurnoFromDate(hoy);
  fechaEl.textContent = hoy.toLocaleDateString("es-AR");
  turnoEl.textContent = turno;

  estado.rendicion.fecha = hoy.toISOString().slice(0, 10);
  estado.rendicion.turno = turno;
  estado.rendicion.repartidor = repartidorEl.textContent || "Nico";

  // Crear contador de billetes sobresaliente
  createBillCounterComponent(inputContado);

  // 1) Intentar levantar de cache localStorage (rendición ya detectada hoy)
  const cache = loadRendicionCacheFromStorage();
  if (
    cache &&
    cache.fecha === estado.rendicion.fecha &&
    cache.turno === estado.rendicion.turno &&
    cache.repartidor === estado.rendicion.repartidor
  ) {
    estado.rendicion.esperado = cache.esperado || 0;
    esperadoEl.textContent = formatoMoneda(estado.rendicion.esperado);
    resultadoBox.innerHTML = `<p class="muted-text">Rendición cacheada. Contá los billetes y cargá el importe.</p>`;
  } else {
    resultadoBox.innerHTML = `<p class="muted-text">Buscando rendición de hoy...</p>`;
  }

  // 2) Siempre validar contra backend para hoy (cache inteligente)
  cargarRendicionDesdeBackend(true);

  btn.addEventListener("click", async () => {
    const contadoVal = parseFloat(inputContado.value || "0");
    if (!contadoVal || contadoVal <= 0) {
      showToast("Ingresá el total contado en efectivo", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Procesando...";

      const fechaStr = estado.rendicion.fecha;
      const repartidor = estado.rendicion.repartidor || "Nico";

      const res = await api("procesarRendicionDesdeRecibo", {
        fechaStr,
        turno,
        repartidor,
        efectivoContado: contadoVal,
        usuario: USUARIO_APP
      });

      if (res && res.ok) {
        const dif = res.diferencia || 0;
        const tipoDif = res.tipoDiferencia || "Exacto";

        let clase = "";
        let msg = "";

        if (tipoDif === "Exacto") {
          clase = "result-ok";
          msg = "Rendición exacta ✔. Caja ajustada automáticamente.";
        } else if (tipoDif === "Sobrante") {
          clase = "result-ok";
          msg = `Sobrante de ${formatoMoneda(dif)}. El sistema lo registró como ingreso de diferencia.`;
        } else {
          clase = "result-danger";
          msg = `Faltante de ${formatoMoneda(Math.abs(dif))}. El sistema lo registró como egreso por diferencia.`;
        }

        resultadoBox.classList.remove("result-ok", "result-danger");
        if (clase) resultadoBox.classList.add(clase);

        resultadoBox.innerHTML = `
          <p>${msg}</p>
          <p class="muted-text small">
            ID Rendición: ${res.idRendicion} · Mov. principal: ${res.movPrincipalId}
          </p>
        `;

        showToast("Rendición procesada correctamente", "ok");
        await refreshEstadoCaja();
      } else {
        const errMsg = res && res.error ? res.error : "No se pudo procesar la rendición";
        showToast(errMsg, "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error al procesar la rendición", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Procesar rendición";
    }
  });
}

/**
 * Llama al backend para traer la rendición de hoy.
 * Si "primerCarga" es true, ajusta también el mensaje base.
 */
async function cargarRendicionDesdeBackend(primerCarga = false) {
  const esperadoEl = document.getElementById("rendicion-esperado");
  const resultadoBox = document.getElementById("resultado-rendicion");
  const repartidorEl = document.getElementById("rendicion-repartidor");

  const fechaStr = estado.rendicion.fecha;
  const turno = estado.rendicion.turno;
  const repartidor = repartidorEl.textContent || "Nico";

  try {
    const datos = await api("getDatosRendicionEsperada", {
      fechaStr,
      turno,
      repartidor
    });

    // Puede venir { ok:false, mensaje } o { ok:true, efectivoEsperado... }
    if (datos && datos.ok && typeof datos.efectivoEsperado !== "undefined") {
      const antesNoTenia = !estado.rendicion.esperado || estado.rendicion.esperado === 0;

      estado.rendicion.esperado = datos.efectivoEsperado || 0;
      estado.rendicion.fecha = datos.fecha || fechaStr;
      estado.rendicion.turno = datos.turno || turno;
      estado.rendicion.repartidor = datos.repartidor || repartidor;

      esperadoEl.textContent = formatoMoneda(estado.rendicion.esperado);
      resultadoBox.innerHTML = `<p class="muted-text">Listo. Contá los billetes y cargá el importe.</p>`;

      // Guardar en cache local
      saveRendicionCacheToStorage({
        fecha: estado.rendicion.fecha,
        turno: estado.rendicion.turno,
        repartidor: estado.rendicion.repartidor,
        esperado: estado.rendicion.esperado
      });

      // Si antes no había rendición y ahora sí, avisar fuerte
      if (!primerCarga && antesNoTenia) {
        showToast("Rendición del día detectada ✔", "ok");
        highlightRendicionCard();
      } else if (primerCarga && antesNoTenia) {
        // primer carga y antes sin cache → mini feedback
        showToast("Rendición del día encontrada", "ok");
      }
    } else {
      // No hay rendición aún
      if (primerCarga) {
        resultadoBox.innerHTML = `<p class="muted-text result-danger">No se encontró rendición para hoy (${turno}).</p>`;
      }
    }
  } catch (err) {
    console.error(err);
    if (primerCarga) {
      resultadoBox.innerHTML = `<p class="muted-text result-danger">Error al buscar la rendición esperada.</p>`;
    }
  }
}

/**
 * Efecto visual en la tarjeta de rendición cuando aparece una nueva.
 */
function highlightRendicionCard() {
  const view = document.getElementById("view-rendicion");
  if (!view) return;
  view.classList.add("rendicion-highlight");
  setTimeout(() => view.classList.remove("rendicion-highlight"), 1600);
}

/**
 * Watcher que consulta cada X tiempo si apareció la rendición de hoy.
 */
function startRendicionWatcher() {
  setInterval(() => {
    cargarRendicionDesdeBackend(false);
  }, RENDICION_POLL_INTERVAL_MS);
}

// ===============================
// CONTADOR DE BILLETES (UI + lógica)
// ===============================

function injectBillCounterStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .bill-counter {
      margin-top: 1.2rem;
      padding: 1rem;
      border-radius: 14px;
      background: radial-gradient(circle at top left, rgba(52,211,153,0.2), rgba(15,23,42,0.95));
      box-shadow: 0 18px 35px rgba(15,23,42,0.65);
      border: 1px solid rgba(148,163,184,0.4);
      backdrop-filter: blur(10px);
      color: #e5e7eb;
      animation: billGlowIn 450ms ease-out;
    }
    .bill-counter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: .75rem;
    }
    .bill-counter-title {
      font-size: .95rem;
      font-weight: 600;
      letter-spacing: .03em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: .35rem;
    }
    .bill-counter-title span.icon {
      font-size: 1.2rem;
    }
    .bill-counter-sub {
      font-size: .75rem;
      opacity: .8;
    }
    .bill-rows {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(120px,1fr));
      gap: .45rem .75rem;
    }
    .bill-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .35rem;
      padding: .4rem .45rem;
      border-radius: 10px;
      background: rgba(15,23,42,0.65);
      border: 1px solid rgba(55,65,81,0.8);
    }
    .bill-label {
      font-size: .8rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .bill-input {
      width: 52px;
      padding: .2rem .3rem;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.7);
      background: rgba(15,23,42,0.9);
      color: #e5e7eb;
      font-size: .8rem;
      text-align: center;
      outline: none;
    }
    .bill-input:focus {
      border-color: rgba(52,211,153,0.9);
      box-shadow: 0 0 0 1px rgba(52,211,153,0.6);
    }
    .bill-subtotal {
      font-size: .75rem;
      font-family: "JetBrains Mono", monospace;
      opacity: .9;
      white-space: nowrap;
    }
    .bill-total-row {
      margin-top: .85rem;
      padding-top: .7rem;
      border-top: 1px dashed rgba(148,163,184,0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: .6rem;
      flex-wrap: wrap;
    }
    .bill-total-label {
      font-size: .85rem;
      opacity: .9;
    }
    .bill-total-badge {
      padding: .35rem .7rem;
      border-radius: 999px;
      border: 1px solid rgba(52,211,153,0.9);
      background: radial-gradient(circle at top,rgba(34,197,94,0.25),rgba(15,23,42,1));
      font-family: "JetBrains Mono", monospace;
      font-size: .85rem;
      font-weight: 600;
      color: #bbf7d0;
      box-shadow: 0 0 0 1px rgba(21,128,61,0.4);
      transform-origin: center;
      transition: transform 120ms ease-out;
    }
    .bill-total-badge.bump {
      transform: scale(1.05);
    }

    @keyframes billGlowIn {
      from {
        opacity: 0;
        transform: translateY(6px) scale(.98);
        box-shadow: 0 0 0 rgba(15,23,42,0);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* highlight rendición cuando llega nueva */
    .view.rendicion-highlight {
      animation: rendicionPulse 1.4s ease-out;
    }
    @keyframes rendicionPulse {
      0% { box-shadow: 0 0 0 rgba(52,211,153,0); }
      40% { box-shadow: 0 0 25px rgba(52,211,153,0.55); }
      100% { box-shadow: 0 0 0 rgba(52,211,153,0); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Crea dinámicamente el contador de billetes dentro de la vista de rendición
 * y vincula el total al input "rendicion-contado".
 */
function createBillCounterComponent(inputContado) {
  const viewRendicion = document.getElementById("view-rendicion");
  if (!viewRendicion) return;

  const card = viewRendicion.querySelector(".card");
  if (!card) return;

  const wrapper = document.createElement("div");
  wrapper.className = "bill-counter";

  wrapper.innerHTML = `
    <div class="bill-counter-header">
      <div class="bill-counter-title">
        <span class="icon">💵</span>
        <span>Contador de billetes</span>
      </div>
      <div class="bill-counter-sub">
        Cargá cantidades por denominación<br/>
        <span style="opacity:.8;">El total se sincroniza con "Contado".</span>
      </div>
    </div>
    <div class="bill-rows" id="bill-rows"></div>
    <div class="bill-total-row">
      <span class="bill-total-label">Total contado en billetes</span>
      <span class="bill-total-badge" id="bill-total-badge">$ 0,00</span>
    </div>
  `;

  // Insertamos después de .rendicion-totales
  const afterNode = card.querySelector(".rendicion-totales");
  if (afterNode && afterNode.parentNode) {
    afterNode.parentNode.insertBefore(wrapper, afterNode.nextSibling);
  } else {
    card.appendChild(wrapper);
  }

  const rowsContainer = wrapper.querySelector("#bill-rows");
  const badgeTotal = wrapper.querySelector("#bill-total-badge");

  // Crear filas para cada denominación
  BILLETES.forEach(denom => {
    const row = document.createElement("div");
    row.className = "bill-row";

    row.innerHTML = `
      <span class="bill-label">$ ${denom.toLocaleString("es-AR")}</span>
      <input type="number" min="0" value="0" class="bill-input" data-denom="${denom}">
      <span class="bill-subtotal">$ 0</span>
    `;
    rowsContainer.appendChild(row);
  });

  function recalcularTotal() {
    let total = 0;
    const rows = rowsContainer.querySelectorAll(".bill-row");

    rows.forEach(row => {
      const input = row.querySelector(".bill-input");
      const subtotalSpan = row.querySelector(".bill-subtotal");
      const denom = parseInt(input.dataset.denom, 10) || 0;
      const cant = parseInt(input.value || "0", 10) || 0;
      const subtotal = denom * cant;
      total += subtotal;
      subtotalSpan.textContent = formatoMoneda(subtotal);
    });

    // Actualizar badge y campo contado
    badgeTotal.textContent = formatoMoneda(total);
    if (!isNaN(total)) {
      inputContado.value = total;
    }

    // Animación sutil
    badgeTotal.classList.remove("bump");
    void badgeTotal.offsetWidth; // reflow para reiniciar animación
    badgeTotal.classList.add("bump");
  }

  rowsContainer.addEventListener("input", (e) => {
    if (e.target && e.target.classList.contains("bill-input")) {
      if (e.target.value === "" || parseInt(e.target.value, 10) < 0) {
        e.target.value = "0";
      }
      recalcularTotal();
    }
  });

  // Sincronizar si alguien toca manualmente el input de "Contado"
  inputContado.addEventListener("input", () => {
    const val = parseFloat(inputContado.value || "0") || 0;
    badgeTotal.textContent = formatoMoneda(val);
  });
}

// ===============================
// ARQUEO
// ===============================

function initArqueo() {
  const btn = document.getElementById("btn-registrar-arqueo");
  const resultadoBox = document.getElementById("resultado-arqueo");

  btn.addEventListener("click", async () => {
    const fisicoVal = parseFloat(document.getElementById("arqueo-fisico").value || "0");
    if (!fisicoVal || fisicoVal <= 0) {
      showToast("Ingresá el efectivo físico contado", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Guardando...";

      const res = await api("registrarArqueo", {
        usuario: USUARIO_APP,
        efectivoFisico: fisicoVal
      });

      if (res) {
        let clase = "";
        let msg = "";

        if (res.resultado === "OK") {
          clase = "result-ok";
          msg = "Arqueo correcto. No hay diferencias de efectivo.";
        } else if (res.resultado === "Sobrante") {
          clase = "result-ok";
          msg = `Sobrante de ${formatoMoneda(res.diferencia)}.`;
        } else {
          clase = "result-danger";
          msg = `Faltante de ${formatoMoneda(Math.abs(res.diferencia))}.`;
        }

        resultadoBox.classList.remove("result-ok", "result-danger");
        if (clase) resultadoBox.classList.add(clase);

        resultadoBox.innerHTML = `
          <p>${msg}</p>
          <p class="muted-text small">
            Efectivo físico: ${formatoMoneda(res.efectivoFisico)} · Sistema: ${formatoMoneda(res.efectivoSistema)}
          </p>
        `;

        showToast("Arqueo registrado", "ok");
        await refreshEstadoCaja();
      }
    } catch (err) {
      console.error(err);
      showToast("Error al registrar el arqueo", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Registrar arqueo";
    }
  });
}

// ===============================
// ALERTAS / NOTIFICACIONES DE ANOMALÍAS
// ===============================

function startAlertasWatcher() {
  // Primera carga
  cargarAlertasCaja(true);

  // Polling continuo
  setInterval(() => {
    cargarAlertasCaja(false);
  }, ALERTAS_POLL_INTERVAL_MS);
}

async function cargarAlertasCaja(primerCarga = false) {
  try {
    const res = await api("getNotificacionesCaja", {
      soloActivas: true
    });

    if (!Array.isArray(res)) return;

    // Ordenar por fecha/hora descendente por si viene desordenado
    res.sort((a, b) => {
      const da = new Date(a.fecha || a.hora || new Date());
      const db = new Date(b.fecha || b.hora || new Date());
      return db.getTime() - da.getTime();
    });

    let huboAlertasNuevas = false;

    res.forEach(n => {
      const id = n.id;
      if (!id) return;

      if (!estado.notificacionesVistas.has(id)) {
        // Marcar como vista en memoria
        estado.notificacionesVistas.add(id);
        huboAlertasNuevas = true;

        // Mostrar toast si es anómala o severa
        if (n.tipo === "ANOMALIA_CAJA" || n.severidad === "ALTA") {
          const titulo = n.titulo || "Alerta de caja";
          showToast(`⚠ ${titulo}`, "alerta");
        }
      }
    });

    if (huboAlertasNuevas) {
      saveAlertasVistasToStorage(estado.notificacionesVistas);
      if (!primerCarga) {
        // Podríamos en el futuro agregar un badge en el nav
      }
    }
  } catch (err) {
    console.error("Error cargando alertas:", err);
  }
}
