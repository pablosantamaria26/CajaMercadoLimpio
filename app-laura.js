// ===============================
// CONFIG
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/";
const USUARIO_APP = "Laura";

// Cache & polling
const RENDICION_CACHE_KEY = "caja_rendicion_cache_v2";
const RENDICION_POLL_INTERVAL_MS = 60000;    // 1 minuto

// Datos Estáticos
const PROVEEDORES = ["Marwiplast", "Bio Bag", "Broche plastico", "Bumerang", "Carol", "Colores", "Coolbazar", "Cotton", "Da Silva", "Desesplast", "Diawara", "Emege", "Entresol", "Fedata", "Fibran", "Flexal", "Hechicera", "Infinity import", "K&K", "La Americana", "La gauchita", "Macetex", "Make Fresh", "Matriplaster", "Mis Plast", "Modoplast", "Molmar", "POP", "Rigolleau", "Romyl", "Samantha", "Santamaria", "Sasha", "Soifer", "lumilagro", "Make", "Suka", "Supy", "Tauro", "Tecnomatric", "Yesi", "Durax", "Javi"].sort();
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
  return "$ " + Number(num || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg, tipo = "info") {
  const toast = document.getElementById("toast");
  const content = document.getElementById("toast-content");
  content.textContent = msg;
  content.className = "toast-content " + tipo; // Estilos CSS manejarán colores si se desea
  content.style.borderColor = tipo === 'ok' ? '#10b981' : (tipo === 'error' ? '#ef4444' : '#00e6ff');
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

function setHeaderClock() {
  const now = new Date();
  document.getElementById("header-date").textContent = now.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "long" });
  document.getElementById("header-time").textContent = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function getTurnoFromDate(fecha = new Date()) {
  const h = fecha.getHours();
  return (h >= 6 && h < 14) ? "Mañana" : "Tarde";
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
  setHeaderClock(); setInterval(setHeaderClock, 30000);
  initNavigation();
  initFormMovimiento();
  initSelectsAuxiliares();
  initProveedoresAutocomplete();
  
  // Rendición y Arqueo
  createBillCounterHero(); // Nuevo contador protagonista
  initRendicionLogic();
  initArqueo();

  // Movimientos
  document.getElementById("movimientos-fecha").value = estado.fechaMovimientos;
  document.getElementById("movimientos-fecha").addEventListener("change", (e) => {
    estado.fechaMovimientos = e.target.value;
    cargarMovimientos();
  });

  // Carga inicial
  refreshEstadoCaja();
  cargarMovimientos(); // Carga movs del día
  startRendicionWatcher();
});

// ===============================
// NAV & UI
// ===============================
function initNavigation() {
  const btns = document.querySelectorAll(".nav-btn");
  const views = document.querySelectorAll(".view");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      views.forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.view).classList.add("active");
    });
  });
}

function initSelectsAuxiliares() {
  const fill = (id, arr) => {
    const s = document.getElementById(id);
    arr.forEach(x => { const o = document.createElement("option"); o.value=x; o.textContent=x; s.appendChild(o); });
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
  document.getElementById("saldo-efectivo").textContent = formatoMoneda(res.efectivo);
  document.getElementById("saldo-cheques").textContent = formatoMoneda(res.cheques);
  document.getElementById("saldo-banco").textContent = formatoMoneda(res.banco);
  document.getElementById("saldo-total").textContent = formatoMoneda(res.total);
  
  // Actualizar Arqueo y Rendición (Barra divertida)
  document.getElementById("arqueo-sistema").textContent = formatoMoneda(res.efectivo);
  document.getElementById("rendicion-saldo-actual").textContent = formatoMoneda(res.efectivo);
}

// ===============================
// MOVIMIENTOS
// ===============================
async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  list.innerHTML = '<div style="padding:10px; color:#aaa;">Cargando...</div>';
  
  const fecha = estado.fechaMovimientos;
  const res = await api("getMovimientos", { fechaStr: fecha });
  
  list.innerHTML = "";
  
  // Resumen del día
  const totalDia = Array.isArray(res) ? res.length : 0;
  document.getElementById("movimientos-dia-resumen").textContent = totalDia > 0 ? `${totalDia} movs` : "Sin movs";

  if (!res || res.length === 0) {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#555;">No hay movimientos para esta fecha.</div>';
    return;
  }

  res.forEach(m => {
    const div = document.createElement("div");
    const esIngreso = m.tipo === "Ingreso";
    div.className = `mov-item ${esIngreso ? 'ingreso' : 'egreso'}`;
    
    div.innerHTML = `
      <div class="mov-info">
        <span class="mov-cat">${m.categoria || m.observacion || 'Varios'}</span>
        <span class="mov-meta">${m.hora} · ${m.formaPago} · ${m.observacion ? m.observacion.slice(0,25) : ''}</span>
      </div>
      <div class="mov-amount ${esIngreso ? 'pos' : 'neg'}">
        ${esIngreso ? '+' : '-'} ${formatoMoneda(m.importe).replace('$ ','')}
      </div>
    `;
    list.appendChild(div);
  });
}

function initFormMovimiento() {
  // Lógica de formulario dinámico (similar al original pero optimizada)
  const tipoRapido = document.getElementById("tipoRapido");
  const formaPago = document.getElementById("formaPago");
  
  const updateVis = () => {
    document.querySelectorAll(".dynamic-row").forEach(el => el.classList.add("hidden"));
    const v = tipoRapido.value;
    if(v === "pagoProveedor") document.getElementById("row-proveedor").classList.remove("hidden");
    if(v === "combustible") document.getElementById("row-vehiculo").classList.remove("hidden");
    if(v === "adelanto" || v === "haber") document.getElementById("row-empleado").classList.remove("hidden");
  };
  tipoRapido.addEventListener("change", updateVis);
  
  formaPago.addEventListener("change", () => {
    const v = formaPago.value;
    const row = document.getElementById("row-banco-cheque");
    (v === "Cheque" || v === "Banco") ? row.classList.remove("hidden") : row.classList.add("hidden");
  });
  
  updateVis();

  document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-registrar-mov");
    btn.disabled = true; btn.textContent = "Guardando...";
    
    // Recolectar datos
    const importeRaw = document.getElementById("importe").value.replace(/[^0-9,]/g,'').replace(',','.');
    
    const params = {
      tipo: document.getElementById("tipoMovimiento").value,
      formaPago: formaPago.value,
      importe: parseFloat(importeRaw),
      categoria: tipoRapido.options[tipoRapido.selectedIndex].text,
      repartidor: "",
      turno: getTurnoFromDate(),
      banco: document.getElementById("banco").value,
      nroCheque: document.getElementById("nroCheque").value,
      usuario: USUARIO_APP,
      observacion: document.getElementById("observacion").value || (tipoRapido.value === "libre" ? "Movimiento manual" : "") + " " + document.getElementById("inputProveedor").value
    };

    const res = await api("registrarMovimientoCaja", params);
    if(res && res.ok) {
      showToast("Movimiento registrado", "ok");
      document.getElementById("form-movimiento").reset();
      document.getElementById("importe").value = ""; 
      refreshEstadoCaja();
      cargarMovimientos(); // Recargar lista
    } else {
      showToast("Error al registrar", "error");
    }
    btn.disabled = false; btn.textContent = "Registrar movimiento";
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
        <button onclick="resetBillCounter()" style="background:transparent; border:1px solid var(--text-muted); color:var(--text-muted); border-radius:8px; cursor:pointer; font-size:0.7rem;">LIMPIAR</button>
      </div>
      <div class="bill-grid" id="bill-grid"></div>
    </div>
  `;

  const grid = document.getElementById("bill-grid");
  
  BILLETES.forEach(denom => {
    const item = document.createElement("div");
    item.className = "bill-item";
    // Al hacer click, poner foco y seleccionar todo para sobreescribir rápido
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

  // Eventos de input
  grid.addEventListener("input", (e) => {
    if (e.target.classList.contains("bill-input-qty")) {
      // Auto-clear logic: si es 0 y el usuario tipea, reemplazar. 
      // (Ya manejado nativamente por el comportamiento de input number, pero forzamos calculo)
      calculateBillTotal();
    }
  });
  
  // Feature "Click to Clear": Si haces click en el input y tiene valor, lo selecciona para borrar facil
  grid.addEventListener("focusin", (e) => {
    if (e.target.classList.contains("bill-input-qty")) {
       e.target.select();
    }
  });
}

function calculateBillTotal() {
  let total = 0;
  document.querySelectorAll(".bill-input-qty").forEach(inp => {
    const qty = parseInt(inp.value) || 0;
    const denom = parseInt(inp.dataset.denom);
    const sub = qty * denom;
    total += sub;
    // Update subtotal text
    document.getElementById(`sub-${denom}`).textContent = qty > 0 ? formatoMoneda(sub) : "$ 0";
    // Visual feedback
    inp.parentElement.style.borderColor = qty > 0 ? "var(--accent)" : "var(--border-glass)";
    inp.style.color = qty > 0 ? "#fff" : "var(--accent)";
  });

  // Actualizar el input "Contado" del resumen
  const inputContado = document.getElementById("rendicion-contado");
  inputContado.value = formatoMoneda(total);
  inputContado.dataset.numeric = total; // Guardar valor numerico real
}

function resetBillCounter() {
  document.querySelectorAll(".bill-input-qty").forEach(i => { i.value = "0"; i.parentElement.style.borderColor = "var(--border-glass)"; });
  calculateBillTotal();
}

// ===============================
// RENDICIÓN LÓGICA
// ===============================
function initRendicionLogic() {
  cargarRendicionEsperada(true);

  document.getElementById("btn-procesar-rendicion").addEventListener("click", async () => {
    const contadoInput = document.getElementById("rendicion-contado");
    const contado = parseFloat(contadoInput.dataset.numeric || 0);
    
    if(contado <= 0) { showToast("Contá los billetes primero", "error"); return; }

    const btn = document.getElementById("btn-procesar-rendicion");
    btn.disabled = true; btn.textContent = "Procesando...";

    const params = {
      fechaStr: estado.rendicion.fecha,
      turno: estado.rendicion.turno,
      repartidor: estado.rendicion.repartidor,
      efectivoContado: contado,
      usuario: USUARIO_APP,
      efectivoEsperado: estado.rendicion.esperado
    };

    const res = await api("procesarRendicionDesdeRecibo", params);
    if(res && res.ok) {
      showToast(res.tipoDiferencia === "Exacto" ? "Rendición Exacta! 🎉" : "Rendición procesada", "ok");
      document.getElementById("resultado-rendicion").innerHTML = `<p style="color:var(--ok)">Procesado: ${res.tipoDiferencia} (${formatoMoneda(res.diferencia)})</p>`;
      refreshEstadoCaja();
    } else {
      showToast(res.error || "Error", "error");
    }
    btn.disabled = false; btn.textContent = "Procesar Rendición";
  });
}

async function cargarRendicionEsperada(firstTime = false) {
  const hoy = new Date().toISOString().slice(0, 10);
  const turno = getTurnoFromDate();
  
  // Update UI meta
  document.getElementById("rendicion-fecha").textContent = hoy;
  document.getElementById("rendicion-turno").textContent = turno;

  const res = await api("getDatosRendicionEsperada", { fechaStr: hoy, turno: turno, repartidor: "Nico" });
  
  if (res && res.ok) {
    estado.rendicion.esperado = res.efectivoEsperado;
    estado.rendicion.fecha = res.fecha;
    estado.rendicion.turno = res.turno;
    estado.rendicion.repartidor = res.repartidor;

    document.getElementById("rendicion-esperado").textContent = formatoMoneda(res.efectivoEsperado);
    document.getElementById("rendicion-repartidor").textContent = res.repartidor;
    
    if(firstTime) showToast("Rendición encontrada", "ok");
  } else {
    document.getElementById("resultado-rendicion").innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted)">Esperando planilla de ${turno}...</span>`;
  }
}

function startRendicionWatcher() {
  setInterval(() => cargarRendicionEsperada(false), RENDICION_POLL_INTERVAL_MS);
}

// ===============================
// ARQUEO
// ===============================
function initArqueo() {
  document.getElementById("btn-registrar-arqueo").addEventListener("click", async () => {
    const valRaw = document.getElementById("arqueo-fisico").value;
    // Simple parser para input manual
    const val = parseFloat(valRaw.replace(/[^0-9]/g, ''));
    
    if(!val) { showToast("Ingresa valor", "error"); return; }
    
    const res = await api("registrarArqueo", { usuario: USUARIO_APP, efectivoFisico: val });
    if(res && res.resultado) {
      showToast(`Arqueo: ${res.resultado}`, res.resultado === "OK" ? "ok" : "alerta");
      document.getElementById("resultado-arqueo").textContent = `Diferencia: ${formatoMoneda(res.diferencia)}`;
      refreshEstadoCaja();
    }
  });
}

// ===============================
// AUTOCOMPLETE SIMPLE
// ===============================
function initProveedoresAutocomplete() {
  const inp = document.getElementById("inputProveedor");
  const box = document.getElementById("proveedor-suggestions");
  
  inp.addEventListener("input", () => {
    const val = inp.value.toLowerCase();
    box.innerHTML = "";
    if(val.length < 1) return;
    const match = PROVEEDORES.filter(p => p.toLowerCase().includes(val));
    match.forEach(p => {
      const d = document.createElement("div");
      d.className = "suggestion-item";
      d.textContent = p;
      d.onclick = () => { inp.value = p; box.innerHTML=""; };
      box.appendChild(d);
    });
    if(match.length>0) box.classList.add("visible");
  });
  
  document.addEventListener("click", (e) => {
    if(e.target !== inp) box.innerHTML="";
  });
}
