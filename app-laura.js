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

// Helper para obtener fecha actual YYYY-MM-DD local
const getHoyLocal = () => {
    const d = new Date();
    // Ajuste simple para obtener la fecha local en formato ISO
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
};

const estado = {
  saldo: { efectivo: 0, cheques: 0, banco: 0, total: 0 },
  rendicion: { fecha: null, turno: null, repartidor: null, esperado: 0 },
  fechaMovimientos: getHoyLocal(), 
  rendicionEncontrada: false
};

// ===============================
// CONEXIÓN API (WORKER)
// ===============================
async function api(fn, params = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, 
      body: JSON.stringify({ fn, params })
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    showToast("Error de conexión. Revisa internet.", "error");
    return null;
  }
}

// ===============================
// HELPERS VISUALES Y FORMATO
// ===============================

// Formato moneda para etiquetas ($ 10.000,00)
function formatoMoneda(num) {
  return "$ " + Number(num || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Configura un input para que se vea como moneda (10.000) mientras escribes
function setupCurrencyInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', function(e) {
        // Eliminar todo lo que no sea número
        let val = this.value.replace(/\D/g, '');
        
        if (val === "") {
            this.dataset.realValue = ""; // Guardar valor limpio
            return;
        }

        // Guardar el valor numérico puro para usar en cálculos
        this.dataset.realValue = val;

        // Formatear visualmente con puntos (1.000.000)
        let formatted = new Intl.NumberFormat('es-AR').format(parseInt(val));
        this.value = formatted;
    });
}

// Helper para obtener el valor numérico real de un input formateado
function getCleanNumber(inputId) {
    const input = document.getElementById(inputId);
    // Intentar leer del dataset (donde guardamos el valor sin puntos)
    if (input.dataset.realValue && input.dataset.realValue !== "") {
        return parseFloat(input.dataset.realValue);
    }
    // Si no, limpiar el value visible
    const val = input.value.replace(/\./g, '').replace(',', '.');
    return parseFloat(val) || 0;
}

// Helper: Convierte fecha YYYY-MM-DD a formato seguro para el backend (Mediodía)
// Esto evita que por diferencias horarias Google busque en el día anterior.
function getFechaSegura(fechaYMD) {
    if(!fechaYMD) return "";
    return fechaYMD + "T12:00:00"; 
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  if(!toast) return;
  toast.textContent = msg;
  toast.className = `toast-msg show ${type}`;
  if(toast.timeoutId) clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => toast.classList.remove("show"), 3000);
}

const updateText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

// ===============================
// INICIALIZACIÓN
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initNavigation();
  initFormMovimiento();
  initSelectsAuxiliares();
  initProveedoresAutocomplete();
  createBillCounterHero();
  initRendicionLogic();
  initArqueo();

  // Configuración del input de fecha para movimientos
  const inputFechaMov = document.getElementById("movimientos-fecha");
  if (inputFechaMov) {
    inputFechaMov.value = estado.fechaMovimientos;
    inputFechaMov.addEventListener("change", (e) => {
      if(e.target.value) {
          estado.fechaMovimientos = e.target.value;
          cargarMovimientos();
      }
    });
  }

  // Carga inicial
  refreshData();
  
  // Polling automático
  setInterval(refreshData, RENDICION_POLL_INTERVAL_MS);
});

function initClock() {
    const update = () => {
        const now = new Date();
        updateText("header-date", now.toLocaleDateString("es-AR", { weekday: 'short', day: 'numeric', month: 'short' }));
        updateText("header-time", now.toLocaleTimeString("es-AR", {hour:'2-digit', minute:'2-digit'}));
    };
    update();
    setInterval(update, 30000);
}

function refreshData() {
  refreshEstadoCaja();
  cargarMovimientos();
  
  if (!estado.rendicionEncontrada || estado.rendicion.esperado === 0) {
      buscarRendicionInteligente();
  }
}

// ===============================
// NAVEGACIÓN Y TEMAS
// ===============================
function initNavigation() {
  const btns = document.querySelectorAll(".nav-btn");
  const views = document.querySelectorAll(".view-section");
  const body = document.body;

  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const targetId = btn.dataset.target;
      views.forEach(v => {
          if(v.id === targetId) v.classList.add("active");
          else v.classList.remove("active");
      });

      const theme = btn.dataset.theme;
      body.className = theme; 
      
      const colorMap = { 'theme-blue': '#1565C0', 'theme-green': '#2E7D32', 'theme-orange': '#EF6C00' };
      const meta = document.querySelector('meta[name="theme-color"]');
      if(meta) meta.setAttribute('content', colorMap[theme]);
    });
  });
}

// ===============================
// ESTADO DE CAJA
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (!res) return;
  
  estado.saldo = res;
  updateText("saldo-total", formatoMoneda(res.total));
  updateText("arqueo-sistema", formatoMoneda(res.efectivo));
}

// ===============================
// MOVIMIENTOS
// ===============================
async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  if (!list) return;

  const fecha = document.getElementById("movimientos-fecha").value || estado.fechaMovimientos;
  
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#999"><span class="material-icons-round spin">autorenew</span></div>';

  // FIX: Mandamos la fecha con hora segura para evitar problemas de zona horaria
  const res = await api("getMovimientos", { fechaStr: getFechaSegura(fecha) });

  if (!Array.isArray(res) || res.length === 0) {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.9rem;">Sin movimientos para esta fecha</div>';
    return;
  }

  list.innerHTML = "";
  
  res.forEach((m) => {
    const esIngreso = m.tipo === "Ingreso";
    const div = document.createElement("div");
    div.className = "mov-item";
    
    let icon = "paid";
    const cat = (m.categoria || "").toLowerCase();
    if(cat.includes("combustible")) icon = "local_gas_station";
    else if(cat.includes("proveedor")) icon = "local_shipping";
    else if(cat.includes("sueldo") || cat.includes("adelanto")) icon = "person";
    else if(cat.includes("retiro") || cat.includes("libre")) icon = "logout";

    div.innerHTML = `
      <div class="mov-left-group">
        <div class="mov-icon-box">
            <span class="material-icons-round">${icon}</span>
        </div>
        <div class="mov-info">
            <span class="mov-desc">${m.categoria || "Varios"}</span>
            <span class="mov-sub">${m.hora} · ${m.formaPago} · ${m.observacion || ""}</span>
        </div>
      </div>
      <div class="mov-amount ${esIngreso ? "text-success" : "text-danger"}">
        ${esIngreso ? "+" : "-"} ${Math.abs(m.importe).toLocaleString("es-AR")}
      </div>
    `;
    list.appendChild(div);
  });
}

function initFormMovimiento() {
    const tipoRapido = document.getElementById("tipoRapido");
    
    // Activar máscara de dinero en el input importe
    setupCurrencyInput("importe");

    tipoRapido.addEventListener("change", () => {
        document.querySelectorAll(".hidden-row").forEach(el => el.style.display = 'none');
        
        const v = tipoRapido.value;
        if(v === "pagoProveedor") document.getElementById("row-proveedor").style.display = 'block';
        if(v === "combustible") document.getElementById("row-vehiculo").style.display = 'block';
        if(v === "adelanto" || v === "haber") document.getElementById("row-empleado").style.display = 'block';
    });

    document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("btn-registrar-mov");
        
        // Obtener valor limpio (sin puntos)
        const importeVal = getCleanNumber("importe");
        
        if(importeVal <= 0) { showToast("Ingrese un importe", "error"); return; }

        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round spin">sync</span> Guardando...';

        const tipoRapidoText = tipoRapido.options[tipoRapido.selectedIndex].text;
        
        let obs = document.getElementById("observacion").value;
        const proveedor = document.getElementById("inputProveedor").value;
        if(!obs && tipoRapido.value === "pagoProveedor") obs = `Pago a ${proveedor}`;

        const params = {
            tipo: document.getElementById("tipoMovimiento").value,
            formaPago: document.getElementById("formaPago").value,
            importe: importeVal,
            categoria: tipoRapido.value ? tipoRapidoText : "Manual",
            repartidor: "", 
            turno: "",
            usuario: USUARIO_APP,
            observacion: obs
        };

        const res = await api("registrarMovimientoCaja", params);
        
        if (res && res.ok) {
            showToast("¡Movimiento registrado!", "ok");
            document.getElementById("form-movimiento").reset();
            document.querySelectorAll(".hidden-row").forEach(el => el.style.display = 'none');
            // Resetear input visual y su data
            const impInput = document.getElementById("importe");
            impInput.value = "";
            impInput.dataset.realValue = "";
            
            refreshData(); 
        } else {
            showToast("Error al registrar", "error");
        }
        
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-round">save</span> REGISTRAR';
    });
}

// ===============================
// RENDICIÓN INTELIGENTE
// ===============================
async function buscarRendicionInteligente() {
    updateText("rendicion-repartidor", "Buscando...");
    
    // 1. AYER TARDE
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const offset = ayer.getTimezoneOffset() * 60000;
    const fechaAyerStr = new Date(ayer.getTime() - offset).toISOString().split('T')[0];
    
    // FIX: Usamos getFechaSegura para enviar hora fija
    let res = await api("getDatosRendicionEsperada", {
        fechaStr: getFechaSegura(fechaAyerStr),
        turno: "Tarde",
        repartidor: "Nico"
    });

    // 2. HOY MAÑANA
    if (!res || !res.ok || res.efectivoEsperado === 0) {
        const hoyStr = getHoyLocal();
        
        res = await api("getDatosRendicionEsperada", {
            fechaStr: getFechaSegura(hoyStr),
            turno: "Mañana",
            repartidor: "Nico"
        });
    }

    if (res && res.ok && res.efectivoEsperado > 0) {
        estado.rendicionEncontrada = true;
        estado.rendicion.esperado = res.efectivoEsperado;
        estado.rendicion.fecha = res.fecha;
        estado.rendicion.turno = res.turno;
        estado.rendicion.repartidor = res.repartidor;

        updateText("rendicion-esperado", formatoMoneda(res.efectivoEsperado));
        updateText("rendicion-repartidor", res.repartidor);
        updateText("rendicion-turno", res.turno);
        
        const partes = res.fecha.split("-");
        if(partes.length === 3) updateText("rendicion-fecha", `${partes[2]}/${partes[1]}`);
        
        showToast(`Planilla: ${res.turno}`, "ok");
    } else {
        updateText("rendicion-repartidor", "No encontrada");
        updateText("rendicion-esperado", "$ 0,00");
    }
}

function initRendicionLogic() {
    document.getElementById("btn-procesar-rendicion").addEventListener("click", async () => {
        const contado = parseFloat(document.getElementById("rendicion-contado").dataset.numeric) || 0;
        
        if (contado === 0) {
            showToast("Contá los billetes primero", "alerta");
            return;
        }

        const btn = document.getElementById("btn-procesar-rendicion");
        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round spin">sync</span> PROCESANDO...';

        const params = {
            // Enviamos fecha segura también aquí
            fechaStr: getFechaSegura(estado.rendicion.fecha || getHoyLocal()),
            turno: estado.rendicion.turno || "Mañana",
            repartidor: estado.rendicion.repartidor || "Manual",
            efectivoContado: contado,
            efectivoEsperado: estado.rendicion.esperado,
            usuario: USUARIO_APP
        };

        const res = await api("procesarRendicionDesdeRecibo", params);
        
        if (res && res.ok) {
            const diff = res.diferencia;
            let msg = "", color = "";
            if(diff === 0) { msg = "EXACTO ✅"; color = "var(--success)"; }
            else if(diff > 0) { msg = `SOBRAN ${formatoMoneda(diff)}`; color = "var(--success)"; }
            else { msg = `FALTAN ${formatoMoneda(diff)}`; color = "var(--danger)"; }

            document.getElementById("resultado-rendicion").innerHTML = `<h3 style="color:${color}">${msg}</h3>`;
            showToast("Rendición procesada", "ok");
            window.resetBillCounter();
            refreshData(); 
        } else {
            showToast(res.error || "Error al procesar", "error");
        }
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-round">check_circle</span> PROCESAR RENDICIÓN';
    });
}

// ===============================
// CONTADOR DE BILLETES
// ===============================
function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  container.innerHTML = "";

  BILLETES.forEach((denom) => {
    const box = document.createElement("div");
    box.className = "bill-box";
    box.innerHTML = `
      <span class="bill-denom">$ ${denom.toLocaleString()}</span>
      <input type="tel" class="bill-input-qty" data-denom="${denom}" value="0" placeholder="0" autocomplete="off">
      <span class="bill-subtotal" id="sub-${denom}"></span>
    `;
    
    const input = box.querySelector("input");
    
    input.addEventListener("focus", function() {
        if(this.value === "0") this.value = "";
    });
    
    input.addEventListener("blur", function() {
        if(this.value === "") this.value = "0";
        calculateBillTotal();
    });

    input.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        calculateBillTotal();
    });

    container.appendChild(box);
  });
}

function calculateBillTotal() {
    let total = 0;
    document.querySelectorAll(".bill-input-qty").forEach(inp => {
        let val = parseInt(inp.value);
        if(isNaN(val)) val = 0;
        
        const denom = parseInt(inp.dataset.denom);
        const sub = val * denom;
        total += sub;
        
        const subEl = document.getElementById(`sub-${denom}`);
        const box = inp.closest('.bill-box');

        if(sub > 0) {
            subEl.innerText = `$ ${sub.toLocaleString()}`;
            subEl.style.color = "var(--primary)";
            box.style.borderColor = "var(--primary)";
            box.style.background = "white";
            inp.style.color = "#000";
            inp.style.fontWeight = "800";
        } else {
            subEl.innerText = "";
            box.style.borderColor = "#eee";
            box.style.background = "#fafafa";
            inp.style.color = "#999";
            inp.style.fontWeight = "normal";
        }
    });

    const display = document.getElementById("rendicion-contado");
    display.value = formatoMoneda(total);
    display.dataset.numeric = total;
}

window.resetBillCounter = function() {
    document.querySelectorAll(".bill-input-qty").forEach(i => i.value = "0");
    calculateBillTotal();
    document.getElementById("resultado-rendicion").innerHTML = "";
}

// ===============================
// ARQUEO
// ===============================
function initArqueo() {
    // Activar máscara de dinero
    setupCurrencyInput("arqueo-fisico");

    document.getElementById("btn-registrar-arqueo").addEventListener("click", async () => {
        const val = getCleanNumber("arqueo-fisico");
        
        if(val <= 0) { showToast("Ingrese el monto físico", "error"); return; }
        
        const btn = document.getElementById("btn-registrar-arqueo");
        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round spin">sync</span> Guardando...';

        const res = await api("registrarArqueo", { usuario: USUARIO_APP, efectivoFisico: val });
        
        if(res && res.resultado) {
            const color = res.resultado === "OK" ? "var(--success)" : "var(--danger)";
            const icon = res.resultado === "OK" ? "check_circle" : "warning";
            
            document.getElementById("resultado-arqueo").innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;gap:10px;color:${color};font-size:1.2rem;font-weight:700;">
                    <span class="material-icons-round">${icon}</span>
                    <span>${res.resultado}</span>
                </div>
                <div style="color:${color};margin-top:5px;">Dif: ${formatoMoneda(res.diferencia)}</div>
            `;
            showToast("Arqueo guardado", "ok");
            refreshEstadoCaja();
        } else {
            showToast("Error al registrar arqueo", "error");
        }
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-round">verified</span> CONFIRMAR ARQUEO';
    });
}

// ===============================
// AUTOCOMPLETE SIMPLE
// ===============================
function initSelectsAuxiliares() {
    const fill = (id, arr) => {
        const s = document.getElementById(id);
        arr.forEach(x => s.add(new Option(x, x)));
    };
    fill("selectVehiculo", VEHICULOS);
    fill("selectEmpleado", EMPLEADOS);
}

function initProveedoresAutocomplete() {
    const inp = document.getElementById("inputProveedor");
    const box = document.getElementById("proveedor-suggestions");
    
    inp.addEventListener("input", function() {
        const val = this.value.toLowerCase();
        box.innerHTML = "";
        
        if(val.length < 2) { box.style.display = 'none'; return; }
        
        const matches = PROVEEDORES.filter(p => p.toLowerCase().includes(val));
        
        if(matches.length > 0) {
            box.style.display = 'block';
            matches.forEach(p => {
                const div = document.createElement("div");
                div.className = "suggestion-item";
                div.innerText = p;
                div.onclick = () => { inp.value = p; box.style.display = 'none'; };
                box.appendChild(div);
            });
        } else {
            box.style.display = 'none';
        }
    });
    
    document.addEventListener("click", (e) => {
        if(e.target !== inp && e.target.parentNode !== box) box.style.display = 'none';
    });
}
