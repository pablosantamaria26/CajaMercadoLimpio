// ===============================
// CONFIG
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";
const USUARIO_APP = "Laura";

// Cache & polling
const RENDICION_CACHE_KEY = "caja_rendicion_cache_v2";
const RENDICION_POLL_INTERVAL_MS = 60000;    // 1 minuto

// Datos Estáticos
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

// Agregado el billete de 20.000
const BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]; 

// ===============================
// HELPERS
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
    console.error("API Error:", e);
    showToast("Error de conexión", "error");
    return null;
  }
}

function formatoMoneda(num) {
  return "$ " + Number(num || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showToast(msg, tipo = "info") {
  const toast = document.getElementById("toast");
  const content = document.getElementById("toast-content");
  content.textContent = msg;
  content.className = "toast-content " + tipo;
  content.style.borderColor =
    tipo === "ok"
      ? "#10b981"
      : tipo === "error"
      ? "#ef4444"
      : "#00e6ff";

  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function setHeaderClock() {
  const now = new Date();
  document.getElementById("header-date").textContent = now.toLocaleDateString(
    "es-AR",
    { weekday: "short", day: "2-digit", month: "long" }
  );
  document.getElementById("header-time").textContent = now.toLocaleTimeString(
    "es-AR",
    { hour: "2-digit", minute: "2-digit" }
  );
}

function getTurnoFromDate(fecha = new Date()) {
  const h = fecha.getHours();
  return h >= 6 && h < 14 ? "Mañana" : "Tarde";
}

// ===============================
// ESTADO LOCAL
// ===============================
const estado = {
  saldo: { efectivo: 0, cheques: 0, banco: 0, total: 0 },
  rendicion: { fecha: null, turno: null, repartidor: null, esperado: 0 },
  fechaMovimientos: new Date().toISOString().slice(0, 10)
};

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  setHeaderClock();
  setInterval(setHeaderClock, 30000);

  initNavigation();
  initFormMovimiento();
  initSelectsAuxiliares();
  initProveedoresAutocomplete();

  // Rendición y Arqueo
  createBillCounterHero(); // Nuevo contador protagonista
  initRendicionLogic();
  initArqueo();

  // Movimientos
  const inputFechaMov = document.getElementById("movimientos-fecha");
  inputFechaMov.value = estado.fechaMovimientos;
  inputFechaMov.addEventListener("change", (e) => {
    estado.fechaMovimientos = e.target.value;
    cargarMovimientos();
  });

  // Carga inicial
  refreshEstadoCaja();
  cargarMovimientos(); // Carga movimientos del día
  startRendicionWatcher();
});

// ===============================
// NAV & UI
// ===============================
function initNavigation() {
  const btns = document.querySelectorAll(".nav-btn");
  const views = document.querySelectorAll(".view");

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.view).classList.add("active");
    });
  });
}

function initSelectsAuxiliares() {
  const fill = (id, arr) => {
    const s = document.getElementById(id);
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
// LOGICA DE CAJA
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (!res) return;

  estado.saldo = res;

  // Actualizar UI Saldos
  document.getElementById("saldo-efectivo").textContent = formatoMoneda(
    res.efectivo
  );
  document.getElementById("saldo-cheques").textContent = formatoMoneda(
    res.cheques
  );
  document.getElementById("saldo-banco").textContent = formatoMoneda(
    res.banco
  );
  document.getElementById("saldo-total").textContent = formatoMoneda(
    res.total
  );

  // Actualizar Arqueo y Rendición (Barra divertida)
  document.getElementById("arqueo-sistema").textContent = formatoMoneda(
    res.efectivo
  );
  document.getElementById("rendicion-saldo-actual").textContent = formatoMoneda(
    res.efectivo
  );
}

// ===============================
// MOVIMIENTOS
// ===============================
async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  list.innerHTML =
    '<div style="padding:10px; color:#aaa;">Cargando...</div>';

  const fecha = estado.fechaMovimientos;
  const res = await api("getMovimientos", { fechaStr: fecha });

  // Manejo robusto de errores / respuestas raras
  if (!res) {
    document.getElementById("movimientos-dia-resumen").textContent = "Error";
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:#f87171;">No se pudieron cargar los movimientos.</div>';
    return;
  }

  if (res.error) {
    console.error("Error getMovimientos:", res.error);
    document.getElementById("movimientos-dia-resumen").textContent = "Error";
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:#f87171;">Error al leer los movimientos del día.</div>';
    return;
  }

  if (!Array.isArray(res)) {
    console.warn("Respuesta inesperada getMovimientos:", res);
    document.getElementById("movimientos-dia-resumen").textContent = "Sin movs";
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:#555;">No hay movimientos para esta fecha.</div>';
    return;
  }

  list.innerHTML = "";

  const totalDia = res.length;
  document.getElementById("movimientos-dia-resumen").textContent =
    totalDia > 0 ? `${totalDia} movs` : "Sin movs";

  if (totalDia === 0) {
    list.innerHTML =
      '<div style="padding:20px; text-align:center; color:#555;">No hay movimientos para esta fecha.</div>';
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
        <span class="mov-cat">${m.categoria || obs || "Varios"}</span>
        <span class="mov-meta">${m.hora} · ${m.formaPago} · ${obsShort}</span>
      </div>
      <div class="mov-amount ${esIngreso ? "pos" : "neg"}">
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
    document
      .querySelectorAll(".dynamic-row")
      .forEach((el) => el.classList.add("hidden"));

    const v = tipoRapido.value;
    if (v === "pagoProveedor")
      document.getElementById("row-proveedor").classList.remove("hidden");
    if (v === "combustible")
      document.getElementById("row-vehiculo").classList.remove("hidden");
    if (v === "adelanto" || v === "haber")
      document.getElementById("row-empleado").classList.remove("hidden");
  };

  tipoRapido.addEventListener("change", updateVis);

  formaPago.addEventListener("change", () => {
    const v = formaPago.value;
    const row = document.getElementById("row-banco-cheque");
    if (v === "Cheque" || v === "Banco") {
      row.classList.remove("hidden");
    } else {
      row.classList.add("hidden");
    }
  });

  updateVis();

  document
    .getElementById("form-movimiento")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-registrar-mov");
      btn.disabled = true;
      btn.textContent = "Guardando...";

      const importeRaw = document
        .getElementById("importe")
        .value.replace(/[^0-9,]/g, "")
        .replace(",", ".");

      const categoriaTexto =
        tipoRapido.options[tipoRapido.selectedIndex].text || "Movimiento";

      const proveedorTxt = document.getElementById("inputProveedor").value;
      const obsManual = document.getElementById("observacion").value.trim();

      let observacionFinal = obsManual;
      if (!observacionFinal) {
        if (tipoRapido.value === "pagoProveedor" && proveedorTxt) {
          observacionFinal = `Pago a proveedor: ${proveedorTxt}`;
        } else if (tipoRapido.value === "combustible") {
          observacionFinal = "Carga de combustible";
        } else if (tipoRapido.value === "adelanto") {
          observacionFinal = "Adelanto de sueldo";
        } else if (tipoRapido.value === "haber") {
          observacionFinal = "Pago de haberes";
        } else {
          observacionFinal = "Movimiento manual";
        }
      }

      const params = {
        tipo: document.getElementById("tipoMovimiento").value,
        formaPago: formaPago.value,
        importe: parseFloat(importeRaw),
        categoria: categoriaTexto,
        repartidor: "", // La caja es Laura; el repartidor se maneja en otro circuito
        turno: getTurnoFromDate(),
        banco: document.getElementById("banco").value,
        nroCheque: document.getElementById("nroCheque").value,
        usuario: USUARIO_APP,
        observacion: observacionFinal
      };

      const res = await api("registrarMovimientoCaja", params);
      if (res && res.ok) {
        showToast("Movimiento registrado", "ok");
        document.getElementById("form-movimiento").reset();
        document.getElementById("importe").value = "";
        refreshEstadoCaja();
        cargarMovimientos();
      } else {
        showToast("Error al registrar", "error");
      }
      btn.disabled = false;
      btn.textContent = "Registrar movimiento";
    });
}

// ===============================
// CONTADOR DE BILLETES HERO
// ===============================
function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  if (!container) return;

  container.innerHTML = `
    <div class="bill-counter-hero">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; color:var(--accent); text-transform:uppercase; letter-spacing:1px;">💵 Contador de Billetes</h3>
        <button type="button" onclick="resetBillCounter()" style="background:transparent; border:1px solid var(--text-muted); color:var(--text-muted); border-radius:8px; cursor:pointer; font-size:0.7rem;">LIMPIAR</button>
      </div>
      <div class="bill-grid" id="bill-grid"></div>
    </div>
  `;

  const grid = document.getElementById("bill-grid");

  BILLETES.forEach((denom) => {
    const item = document.createElement("div");
    item.className = "bill-item";

    item.onclick = () => {
      const inp = item.querySelector("input");
      inp.focus();
      inp.select();
    };

    item.innerHTML = `
      <span class="bill-denom">$ ${denom.toLocaleString()}</span>
      <input type="number" class="bill-input-qty" data-denom="${denom}" value="0" min="0" placeholder="0" />
      <span class="bill-subtotal" id="sub-${denom}">$ 0</span>
    `;
    grid.appendChild(item);
  });

  grid.addEventListener("input", (e) => {
    if (e.target.classList.contains("bill-input-qty")) {
      calculateBillTotal();
    }
  });

  grid.addEventListener("focusin", (e) => {
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

    document.getElementById(`sub-${denom}`).textContent =
      qty > 0 ? formatoMoneda(sub) : "$ 0";

    inp.parentElement.style.borderColor =
      qty > 0 ? "var(--accent)" : "var(--border-glass)";
    inp.style.color = qty > 0 ? "#fff" : "var(--accent)";
  });

  const inputContado = document.getElementById("rendicion-contado");
  inputContado.value = formatoMoneda(total);
  inputContado.dataset.numeric = total;
}

function resetBillCounter() {
  document.querySelectorAll(".bill-input-qty").forEach((i) => {
    i.value = "0";
    i.parentElement.style.borderColor = "var(--border-glass)";
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
      const contado = parseFloat(contadoInput.dataset.numeric || 0);

      if (contado <= 0) {
        showToast("Contá los billetes primero", "error");
        return;
      }

      const btn = document.getElementById("btn-procesar-rendicion");
      btn.disabled = true;
      btn.textContent = "Procesando...";

      const params = {
        fechaStr: estado.rendicion.fecha,
        turno: estado.rendicion.turno,
        repartidor: estado.rendicion.repartidor, // viene desde la rendición detectada
        efectivoContado: contado,
        usuario: USUARIO_APP,
        efectivoEsperado: estado.rendicion.esperado
      };

      const res = await api("procesarRendicionDesdeRecibo", params);
      if (res && res.ok) {
        const msg =
          res.tipoDiferencia === "Exacto"
            ? "Rendición Exacta! 🎉"
            : "Rendición procesada";
        showToast(msg, "ok");
        document.getElementById(
          "resultado-rendicion"
        ).innerHTML = `<p style="color:var(--ok)">Procesado: ${res.tipoDiferencia} (${formatoMoneda(
          res.diferencia
        )})</p>`;
        refreshEstadoCaja();
      } else {
        showToast((res && res.error) || "Error al procesar la rendición", "error");
      }

      btn.disabled = false;
      btn.textContent = "Procesar rendición";
    });
}

async function cargarRendicionEsperada(firstTime = false) {
  const hoy = new Date().toISOString().slice(0, 10);
  const turno = getTurnoFromDate();

  document.getElementById("rendicion-fecha").textContent = hoy;
  document.getElementById("rendicion-turno").textContent = turno;

  // 🔴 IMPORTANTE: ya NO enviamos repartidor; lo resuelve el backend
  const res = await api("getDatosRendicionEsperada", {
    fechaStr: hoy,
    turno: turno
  });

  if (res && res.ok) {
    estado.rendicion.esperado = res.efectivoEsperado;
    estado.rendicion.fecha = res.fecha;
    estado.rendicion.turno = res.turno;
    estado.rendicion.repartidor = res.repartidor;

    document.getElementById("rendicion-esperado").textContent =
      formatoMoneda(res.efectivoEsperado);
    document.getElementById("rendicion-repartidor").textContent =
      res.repartidor || "";

    if (firstTime) showToast("Rendición encontrada", "ok");
  } else {
    console.warn("Sin rendición encontrada:", res && res.mensaje);
    document.getElementById("rendicion-esperado").textContent = "$ 0";
    document.getElementById("rendicion-repartidor").textContent = "";
    document.getElementById("resultado-rendicion").innerHTML =
      `<span style="font-size:0.8rem; color:var(--text-muted)">
         Esperando planilla de ${turno}...
       </span>`;
    if (firstTime && res && res.mensaje) {
      showToast(res.mensaje, "info");
    }
  }
}

function startRendicionWatcher() {
  setInterval(() => cargarRendicionEsperada(false), RENDICION_POLL_INTERVAL_MS);
}

// ===============================
// ARQUEO
// ===============================
function initArqueo() {
  document
    .getElementById("btn-registrar-arqueo")
    .addEventListener("click", async () => {
      const valRaw = document.getElementById("arqueo-fisico").value || "";
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

      if (res && res.resultado) {
        showToast(
          `Arqueo: ${res.resultado}`,
          res.resultado === "OK" ? "ok" : "alerta"
        );
        document.getElementById(
          "resultado-arqueo"
        ).textContent = `Diferencia: ${formatoMoneda(res.diferencia)}`;
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
