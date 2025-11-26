// ===============================
// CONFIGURACIÓN Y ESTADO
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";
const USUARIO_APP = "Laura";
const RENDICION_POLL_INTERVAL_MS = 60000; 

const PROVEEDORES = [
  "Marwiplast", "Bio Bag", "Broche plastico", "Bumerang", "Carol", "Colores",
  "Coolbazar", "Cotton", "Da Silva", "Desesplast", "Diawara", "Emege",
  "Entresol", "Fedata", "Fibran", "Flexal", "Hechicera", "Infinity import",
  "K&K", "La Americana", "La gauchita", "Macetex", "Make Fresh", "Matriplaster",
  "Mis Plast", "Modoplast", "Molmar", "POP", "Rigolleau", "Romyl", "Samantha",
  "Santamaria", "Sasha", "Soifer", "lumilagro", "Make", "Suka", "Supy", "Tauro",
  "Tecnomatric", "Yesi", "Durax", "Javi"
].sort();
const VEHICULOS = ["Toyota Hiace", "Volkswagen Saveiro", "Fiat Uno Cargo"];
const EMPLEADOS = ["Nicolás", "Laura", "Nancy", "Martín", "Lucas"];
const BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]; 

const estado = {
  saldo: { efectivo: 0, cheques: 0, banco: 0, total: 0 },
  rendicion: { fecha: null, turno: null, repartidor: null, esperado: 0 },
  fechaMovimientos: new Date().toISOString().slice(0, 10)
};

// ===============================
// HELPERS Y UTILS
// ===============================
async function api(fn, params = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn, params })
    });
    return await res.json();
  } catch (e) {
    showToast("Error de conexión con la API", "error");
    return null;
  }
}

function formatoMoneda(num) {
  return "$ " + Number(num || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  if(!toast) return;

  toast.textContent = msg;
  toast.className = `toast-msg show ${type}`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// Función auxiliar para actualizar texto de forma segura
const updateText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

function setHeaderClock() {
  const now = new Date();
  updateText("header-date", now.toLocaleDateString("es-AR"));
  updateText("header-time", now.toLocaleTimeString("es-AR", {hour:'2-digit', minute:'2-digit'}));
}

function getTurnoFromDate(fecha = new Date()) {
  const h = fecha.getHours();
  return h >= 6 && h < 14 ? "Mañana" : "Tarde";
}

// ===============================
// INICIALIZACIÓN PRINCIPAL
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  setHeaderClock();
  setInterval(setHeaderClock, 30000);

  initNavigation();
  initFormMovimiento();
  initSelectsAuxiliares();
  initProveedoresAutocomplete();

  createBillCounterHero();
  initRendicionLogic();
  initArqueo();

  // Movimientos
  const inputFechaMov = document.getElementById("movimientos-fecha");
  if (inputFechaMov) {
    inputFechaMov.value = estado.fechaMovimientos;
    inputFechaMov.addEventListener("change", (e) => {
      estado.fechaMovimientos = e.target.value;
      cargarMovimientos();
    });
  }

  refreshData();
  setInterval(refreshData, RENDICION_POLL_INTERVAL_MS);
});

function refreshData() {
  refreshEstadoCaja();
  cargarMovimientos();
  cargarRendicionEsperada(false);
}

// ===============================
// NAV & VISTAS (FIX)
// ===============================
function initNavigation() {
  const btns = document.querySelectorAll(".nav-btn");
  const views = document.querySelectorAll(".view-section");

  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      views.forEach(v => v.classList.remove("active"));

      btn.classList.add("active");
      
      const targetId = btn.dataset.target;
      const targetView = document.getElementById(targetId);
      
      // FIX: Asegura que la vista existe antes de activar (evita crash)
      if(targetView) {
        targetView.classList.add("active");
      }
    });
  });
}

function initSelectsAuxiliares() {
  const fill = (id, arr) => {
    const s = document.getElementById(id);
    if (!s) return;
    arr.forEach((x) => {
      const o = document.createElement("option");
      o.value = x;
      o.textContent = x;
      s.appendChild(o);
    });
  };
  fill("selectVehiculo", VEHICULOS);
  fill("selectEmpleado", EMPLEADOS);
}

// ===============================
// ESTADO DE CAJA
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (!res) return;

  estado.saldo = res;

  // Actualizar UI Saldos (FIX: Uso de updateText seguro)
  updateText("saldo-efectivo", formatoMoneda(res.efectivo));
  updateText("saldo-cheques", formatoMoneda(res.cheques));
  updateText("saldo-banco", formatoMoneda(res.banco));
  updateText("saldo-total", formatoMoneda(res.total));

  // Actualizar Arqueo y Rendición (Barra duotono)
  updateText("arqueo-sistema", formatoMoneda(res.efectivo));
  updateText("rendicion-saldo-actual", formatoMoneda(res.efectivo));
}

// ===============================
// MOVIMIENTOS Y FORMULARIOS
// ===============================
async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  const fechaInput = document.getElementById("movimientos-fecha");

  if (!list || !fechaInput) return;

  // Asegurar la fecha para la API
  if(!fechaInput.value) fechaInput.value = estado.fechaMovimientos;

  list.innerHTML =
    '<div style="padding:10px; color:var(--text-muted); text-align:center;">Cargando...</div>';

  const fecha = fechaInput.value;
  const res = await api("getMovimientos", { fechaStr: fecha });

  if (!Array.isArray(res)) {
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:var(--danger);">Error al cargar los movimientos o respuesta inesperada.</div>';
    return;
  }

  list.innerHTML = "";

  if (res.length === 0) {
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:var(--text-muted);">No hay movimientos para esta fecha.</div>';
    return;
  }

  res.forEach((m) => {
    const div = document.createElement("div");
    const esIngreso = m.tipo === "Ingreso";
    div.className = `mov-item ${esIngreso ? "ingreso" : "egreso"}`;

    const obs = m.observacion || "";
    const obsShort = obs.length > 30 ? obs.slice(0, 30) + "…" : obs;

    div.innerHTML = `
      <div class="mov-info">
        <span class="mov-desc">${m.categoria || obs || "Varios"}</span>
        <span class="mov-sub">${m.hora} · ${m.formaPago} · ${obsShort}</span>
      </div>
      <div class="mov-amount mono ${esIngreso ? "text-success" : "text-danger"}">
        ${esIngreso ? "+" : "-"} ${formatoMoneda(m.importe).replace("$ ", "")}
      </div>
    `;
    list.appendChild(div);
  });
}

function initFormMovimiento() {
  const tipoRapido = document.getElementById("tipoRapido");
  const formaPago = document.getElementById("formaPago");

  const updateVis = () => {
    if (!tipoRapido) return;
    document
      .querySelectorAll(".form-group.hidden")
      .forEach((el) => el.style.display = 'none');

    const v = tipoRapido.value;
    if (v === "pagoProveedor") document.getElementById("row-proveedor").style.display = 'block';
    if (v === "combustible") document.getElementById("row-vehiculo").style.display = 'block';
    if (v === "adelanto" || v === "haber") document.getElementById("row-empleado").style.display = 'block';
  };

  if(tipoRapido) tipoRapido.addEventListener("change", updateVis);

  if(formaPago) formaPago.addEventListener("change", () => {
    const v = formaPago.value;
    const row = document.getElementById("row-banco-cheque");
    if (row) row.style.display = (v === "Cheque" || v === "Banco") ? 'grid' : 'none';
  });

  updateVis();

  document
    .getElementById("form-movimiento")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-registrar-mov");
      const importeInput = document.getElementById("importe");
      if(!btn || !importeInput || !tipoRapido) return;

      btn.disabled = true;
      btn.textContent = "Guardando...";

      const importeRaw = importeInput.value.replace(/[^0-9,]/g, "").replace(",", ".");
      const categoriaTexto = tipoRapido.options[tipoRapido.selectedIndex].text || "Movimiento";

      const proveedorTxt = document.getElementById("inputProveedor").value;
      const obsManual = document.getElementById("observacion").value.trim();
      const bancoInput = document.getElementById("banco");
      const chequeInput = document.getElementById("nroCheque");


      let observacionFinal = obsManual;
      if (!observacionFinal) {
        if (tipoRapido.value === "pagoProveedor" && proveedorTxt) observacionFinal = `Pago a proveedor: ${proveedorTxt}`;
        else if (tipoRapido.value === "combustible") observacionFinal = "Carga de combustible";
        else if (tipoRapido.value === "adelanto") observacionFinal = "Adelanto de sueldo";
        else if (tipoRapido.value === "haber") observacionFinal = "Pago de haberes";
        else observacionFinal = "Movimiento manual";
      }

      const params = {
        tipo: document.getElementById("tipoMovimiento").value,
        formaPago: formaPago.value,
        importe: parseFloat(importeRaw),
        categoria: categoriaTexto,
        repartidor: "", 
        turno: getTurnoFromDate(),
        banco: bancoInput ? bancoInput.value : "",
        nroCheque: chequeInput ? chequeInput.value : "",
        usuario: USUARIO_APP,
        observacion: observacionFinal
      };

      const res = await api("registrarMovimientoCaja", params);
      if (res && res.ok) {
        showToast("Movimiento registrado", "ok");
        document.getElementById("form-movimiento").reset();
        document.getElementById("importe").value = "";
        refreshData();
      } else {
        showToast("Error al registrar", "error");
      }
      btn.disabled = false;
      btn.textContent = "Registrar movimiento";
    });
}

// ===============================
// CONTADOR DE BILLETES (HERO)
// ===============================
function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  if (!container) return;

  container.innerHTML = "";

  BILLETES.forEach((denom) => {
    const item = document.createElement("div");
    item.className = "bill-box";

    item.onclick = (e) => {
      if(e.target.tagName !== "INPUT") {
        const inp = item.querySelector("input");
        inp.focus();
        inp.select();
      }
    };

    item.innerHTML = `
      <span class="bill-denom">$ ${denom.toLocaleString()}</span>
      <input type="number" class="bill-input-qty mono" data-denom="${denom}" value="0" min="0" placeholder="0" />
      <span class="bill-subtotal mono" id="sub-${denom}">$ 0</span>
    `;
    container.appendChild(item);
  });

  container.addEventListener("input", (e) => {
    if (e.target.classList.contains("bill-input-qty")) {
      calculateBillTotal();
    }
  });

  container.addEventListener("focusin", (e) => {
    if (e.target.classList.contains("bill-input-qty")) {
      e.target.select();
    }
  });
}

function calculateBillTotal() {
  let total = 0;
  document.querySelectorAll(".bill-input-qty").forEach((inp) => {
    const qty = parseInt(inp.value) || 0;
    const denom = parseInt(inp.dataset.denom, 10);
    const sub = qty * denom;
    total += sub;

    const subTotalEl = document.getElementById(`sub-${denom}`);
    if(subTotalEl) subTotalEl.textContent = qty > 0 ? formatoMoneda(sub) : "$ 0";

    // Efecto visual al ingresar cantidad
    inp.parentElement.style.borderColor = qty > 0 ? "var(--accent)" : "var(--border-glass)";
    inp.style.color = qty > 0 ? "var(--text-main)" : "var(--accent)";
  });

  const inputContado = document.getElementById("rendicion-contado");
  // FIX: Lo chequeamos antes de usar.
  if(inputContado) {
    inputContado.value = formatoMoneda(total);
    inputContado.dataset.numeric = total;
  }
}

window.resetBillCounter = function() {
  document.querySelectorAll(".bill-input-qty").forEach((i) => {
    i.value = "0";
    i.parentElement.style.borderColor = "var(--border-glass)";
    i.style.color = "var(--accent)";
  });
  calculateBillTotal();
}

// ===============================
// RENDICIÓN LÓGICA
// ===============================
function initRendicionLogic() {
  cargarRendicionEsperada(true);

  document
    .getElementById("btn-procesar-rendicion")
    .addEventListener("click", async () => {
      const contadoInput = document.getElementById("rendicion-contado");
      const contado = parseFloat(contadoInput ? contadoInput.dataset.numeric : 0) || 0;

      if (contado <= 0) {
        showToast("Contá los billetes primero", "error");
        return;
      }

      const btn = document.getElementById("btn-procesar-rendicion");
      if (!btn) return;

      btn.disabled = true;
      btn.textContent = "PROCESANDO...";

      const params = {
        fechaStr: estado.rendicion.fecha,
        turno: estado.rendicion.turno,
        repartidor: estado.rendicion.repartidor,
        efectivoContado: contado,
        usuario: USUARIO_APP,
        efectivoEsperado: estado.rendicion.esperado
      };

      const res = await api("procesarRendicionDesdeRecibo", params);
      const resultadoEl = document.getElementById("resultado-rendicion");

      if (res && res.ok) {
        const diff = res.diferencia;
        const diffMoneda = formatoMoneda(Math.abs(diff));
        const msg = diff === 0 ? "¡EXACTO! 🎉" : (diff > 0 ? `SOBRANTE: +${diffMoneda}` : `FALTANTE: -${diffMoneda}`);
        
        if (resultadoEl) {
            resultadoEl.innerHTML = `<span style="color:${diff===0?'var(--success)':'var(--danger)'}">${msg}</span>`;
        }
        showToast("Rendición procesada", "ok");
        refreshData();
      } else {
        showToast((res && res.error) || "Error al procesar la rendición", "error");
      }

      btn.disabled = false;
      btn.textContent = "PROCESAR RENDICIÓN";
    });
}

async function cargarRendicionEsperada(firstTime = false) {
  const hoy = new Date().toISOString().slice(0, 10);
  const turno = getTurnoFromDate();

  updateText("rendicion-fecha", hoy);
  updateText("rendicion-turno", turno);

  const res = await api("getDatosRendicionEsperada", {
    fechaStr: hoy,
    turno: turno
  });

  if (res && res.ok) {
    estado.rendicion.esperado = res.efectivoEsperado;
    estado.rendicion.fecha = res.fecha;
    estado.rendicion.turno = res.turno;
    estado.rendicion.repartidor = res.repartidor;

    updateText("rendicion-esperado", formatoMoneda(res.efectivoEsperado));
    updateText("rendicion-repartidor", res.repartidor || "");

    if (firstTime) showToast("Rendición encontrada", "ok");
  } else {
    updateText("rendicion-esperado", "$ 0,00");
    updateText("rendicion-repartidor", "---");

    const resultadoEl = document.getElementById("resultado-rendicion");
    if (resultadoEl) {
      resultadoEl.innerHTML =
        `<span style="font-size:0.8rem; color:var(--text-muted)">
           Esperando planilla de ${turno}...
         </span>`;
    }
    if (firstTime && res && res.mensaje) {
      showToast(res.mensaje, "info");
    }
  }
}

// ===============================
// ARQUEO
// ===============================
function initArqueo() {
  document
    .getElementById("btn-registrar-arqueo")
    .addEventListener("click", async () => {
      const fisicoInput = document.getElementById("arqueo-fisico");
      if(!fisicoInput) return;

      const valRaw = fisicoInput.value || "";
      const limpio = valRaw.replace(/[^0-9]/g, "");
      const val = parseFloat(limpio);

      if (!val) {
        showToast("Ingresá el valor físico", "error");
        return;
      }

      const res = await api("registrarArqueo", {
        usuario: USUARIO_APP,
        efectivoFisico: val
      });

      const resultadoEl = document.getElementById("resultado-arqueo");

      if (res && res.resultado) {
        const colorClass = res.resultado === "OK" ? "var(--success)" : "var(--danger)";
        if(resultadoEl) {
            resultadoEl.innerHTML = `<span style="color:${colorClass}; font-weight:bold;">Diferencia: ${formatoMoneda(res.diferencia)} (${res.resultado})</span>`;
        }
        showToast(`Arqueo: ${res.resultado}`, res.resultado === "OK" ? "ok" : "alerta");
        refreshEstadoCaja();
      } else {
        showToast("Error al registrar arqueo", "error");
      }
    });
}

// ===============================
// AUTOCOMPLETE PROVEEDORES
// ===============================
function initProveedoresAutocomplete() {
  const inp = document.getElementById("inputProveedor");
  const box = document.getElementById("proveedor-suggestions");

  if (!inp || !box) return;

  inp.addEventListener("input", () => {
    const val = inp.value.toLowerCase();
    box.innerHTML = "";
    if (val.length < 1) {
      box.classList.remove("visible");
      return;
    }

    const match = PROVEEDORES.filter((p) =>
      p.toLowerCase().includes(val)
    ).slice(0, 20);

    match.forEach((p) => {
      const d = document.createElement("div");
      d.className = "suggestion-item";
      d.textContent = p;
      d.onclick = () => {
        inp.value = p;
        box.innerHTML = "";
        box.classList.remove("visible");
      };
      box.appendChild(d);
    });

    if (match.length > 0) box.classList.add("visible");
    else box.classList.remove("visible");
  });

  document.addEventListener("click", (e) => {
    if (e.target !== inp) {
      box.innerHTML = "";
      box.classList.remove("visible");
    }
  });
}
