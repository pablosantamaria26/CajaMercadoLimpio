// ===============================
// CONFIG
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";

const USUARIO_APP = "Laura"; // se puede parametrizar después

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

// ===============================
// HELPERS
// ===============================

async function api(fn, params = {}) {
  const res = await fetch(WORKER_URL, {
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
  movimientosDia: []
};

// ===============================
// INIT
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  // Reloj header
  setHeaderClock();
  setInterval(setHeaderClock, 30000);

  // Nav
  initNavigation();

  // AutoComplete y selects
  initProveedoresAutocomplete();
  initSelectsAuxiliares();

  // Formularios
  initFormMovimiento();
  initRendicion();
  initArqueo();

  // Cargar estado inicial
  refreshEstadoCaja();
  // (opcional) refreshMovimientosDia() cuando tengamos endpoint específico
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
    if (fp === "Cheque") {
      rowBancoCheque.classList.remove("hidden");
    } else if (fp === "Banco") {
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

      const res = await api("registrarMovimientoCaja", params);

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
// RENDICIÓN
// ===============================

function initRendicion() {
  const fechaEl = document.getElementById("rendicion-fecha");
  const turnoEl = document.getElementById("rendicion-turno");
  const repartidorEl = document.getElementById("rendicion-repartidor");
  const esperadoEl = document.getElementById("rendicion-esperado");
  const btn = document.getElementById("btn-procesar-rendicion");
  const resultadoBox = document.getElementById("resultado-rendicion");

  // Set datos base
  const hoy = new Date();
  fechaEl.textContent = hoy.toLocaleDateString("es-AR");
  const turno = getTurnoFromDate(hoy);
  turnoEl.textContent = turno;

  async function cargarEsperado() {
    try {
      const fechaStr = hoy.toISOString().slice(0, 10);
      const repartidor = repartidorEl.textContent || "Nico";

      const datos = await api("getDatosRendicionEsperada", {
        fechaStr,
        turno,
        repartidor
      });

      if (datos && typeof datos.efectivoEsperado !== "undefined") {
        esperadoEl.textContent = formatoMoneda(datos.efectivoEsperado);
        resultadoBox.innerHTML = `<p class="muted-text">Listo. Contá los billetes y cargá el importe.</p>`;
      } else {
        resultadoBox.innerHTML = `<p class="muted-text result-danger">No se encontró rendición para hoy (${turno}).</p>`;
      }
    } catch (err) {
      console.error(err);
      resultadoBox.innerHTML = `<p class="muted-text result-danger">Error al buscar la rendición esperada.</p>`;
    }
  }

  // cargamos automáticamente el esperado
  cargarEsperado();

  btn.addEventListener("click", async () => {
    const contadoVal = parseFloat(document.getElementById("rendicion-contado").value || "0");
    if (!contadoVal || contadoVal <= 0) {
      showToast("Ingresá el total contado en efectivo", "error");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Procesando...";

      const fechaStr = hoy.toISOString().slice(0, 10);
      const repartidor = repartidorEl.textContent || "Nico";

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
        showToast("No se pudo procesar la rendición", "error");
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
