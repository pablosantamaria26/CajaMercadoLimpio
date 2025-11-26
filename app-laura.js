// ===============================
// CONFIGURACIÓN Y ESTADO
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/"; 
// ^ ASEGÚRATE DE QUE ESTA URL SEA LA CORRECTA
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
  fechaMovimientos: new Date().toLocaleDateString('en-CA'), // Formato YYYY-MM-DD
  rendicionEncontrada: false
};

// ===============================
// HELPERS Y UTILS
// ===============================
async function api(fn, params = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Fix CORS simple request
      body: JSON.stringify({ fn, params })
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    showToast("Error de conexión. Intente nuevamente.", "error");
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

  // Listener fecha movimientos
  const inputFechaMov = document.getElementById("movimientos-fecha");
  if (inputFechaMov) {
    inputFechaMov.value = estado.fechaMovimientos;
    inputFechaMov.addEventListener("change", (e) => {
      estado.fechaMovimientos = e.target.value;
      cargarMovimientos();
    });
  }

  // Carga inicial
  refreshData();
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
  // Solo buscar rendición si no hemos encontrado una válida aún o si es automática
  if (!estado.rendicionEncontrada) {
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
      // 1. Activar botón
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // 2. Cambiar Vista con Animación
      const targetId = btn.dataset.target;
      views.forEach(v => {
          v.classList.remove("active");
          if(v.id === targetId) {
             // Pequeño delay para permitir que la saliente termine (opcional)
             setTimeout(() => v.classList.add("active"), 50);
          }
      });

      // 3. Cambiar Tema (Color)
      const theme = btn.dataset.theme;
      body.className = theme; // theme-blue, theme-green, theme-orange
      
      // Meta theme-color para móviles
      const colorMap = {
          'theme-blue': '#1565C0',
          'theme-green': '#2E7D32',
          'theme-orange': '#EF6C00'
      };
      document.querySelector('meta[name="theme-color"]').setAttribute('content', colorMap[theme]);
    });
  });
}

// ===============================
// ESTADO Y MOVIMIENTOS
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (!res) return;
  estado.saldo = res;
  updateText("saldo-total", formatoMoneda(res.total));
  updateText("arqueo-sistema", formatoMoneda(res.efectivo));
}

async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  if (!list) return;

  const fecha = document.getElementById("movimientos-fecha").value || estado.fechaMovimientos;
  
  // Spinner simple
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#999"><span class="material-icons-round spin">autorenew</span></div>';

  const res = await api("getMovimientos", { fechaStr: fecha });

  if (!Array.isArray(res) || res.length === 0) {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.9rem;">Sin movimientos hoy</div>';
    return;
  }

  list.innerHTML = "";
  res.forEach((m) => {
    const esIngreso = m.tipo === "Ingreso";
    const div = document.createElement("div");
    div.className = "mov-item";
    
    // Icono según categoría
    let icon = "paid";
    const cat = (m.categoria || "").toLowerCase();
    if(cat.includes("combustible")) icon = "local_gas_station";
    else if(cat.includes("proveedor")) icon = "local_shipping";
    else if(cat.includes("sueldo") || cat.includes("adelanto")) icon = "person";
    else if(cat.includes("retiro") || cat.includes("libre")) icon = "logout";

    div.innerHTML = `
      <div class="mov-info">
        <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-icons-round" style="font-size:18px; color:#ccc;">${icon}</span>
            <span class="mov-desc">${m.categoria || "Varios"}</span>
        </div>
        <span class="mov-sub">${m.hora} · ${m.formaPago} · ${m.observacion || ""}</span>
      </div>
      <div class="mov-amount ${esIngreso ? "text-success" : "text-danger"}">
        ${esIngreso ? "+" : "-"} ${Math.abs(m.importe).toLocaleString("es-AR")}
      </div>
    `;
    list.appendChild(div);
  });
}

function initFormMovimiento() {
    // Lógica visual del formulario (mostrar/ocultar campos)
    const tipoRapido = document.getElementById("tipoRapido");
    
    tipoRapido.addEventListener("change", () => {
        // Ocultar todos primero
        document.querySelectorAll(".hidden-row").forEach(el => el.style.display = 'none');
        
        const v = tipoRapido.value;
        if(v === "pagoProveedor") document.getElementById("row-proveedor").style.display = 'block';
        if(v === "combustible") document.getElementById("row-vehiculo").style.display = 'block';
        if(v === "adelanto" || v === "haber") document.getElementById("row-empleado").style.display = 'block';
    });

    document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("btn-registrar-mov");
        const importeInput = document.getElementById("importe");
        
        // Validación básica
        if(!importeInput.value) { showToast("Ingrese un importe", "error"); return; }

        btn.disabled = true;
        btn.innerHTML = '<span class="material-icons-round spin">sync</span> Guardando...';

        const importeRaw = importeInput.value.replace(/[^0-9,.]/g, "").replace(",", ".");
        const tipoRapidoText = tipoRapido.options[tipoRapido.selectedIndex].text;
        
        // Armar observación automática si está vacía
        let obs = document.getElementById("observacion").value;
        const proveedor = document.getElementById("inputProveedor").value;
        if(!obs && tipoRapido.value === "pagoProveedor") obs = `Pago a ${proveedor}`;

        const params = {
            tipo: document.getElementById("tipoMovimiento").value,
            formaPago: document.getElementById("formaPago").value,
            importe: parseFloat(importeRaw),
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
            refreshData(); // Actualiza la lista y saldos
        } else {
            showToast("Error al registrar", "error");
        }
        
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-round">save</span> REGISTRAR';
    });
}

// ===============================
// LÓGICA DE RENDICIÓN (INTELIGENTE)
// ===============================
async function buscarRendicionInteligente() {
    // 1. Intentar buscar AYER a la TARDE
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const fechaAyer = ayer.toISOString().slice(0, 10);
    
    updateText("rendicion-repartidor", "Buscando...");
    
    console.log("Buscando rendición Ayer Tarde:", fechaAyer);
    let res = await api("getDatosRendicionEsperada", {
        fechaStr: fechaAyer,
        turno: "Tarde",
        repartidor: "Nico" // Default
    });

    // 2. Si falla o no trae dinero, buscar HOY a la MAÑANA
    if (!res || !res.ok || res.efectivoEsperado === 0) {
        const hoy = new Date().toISOString().slice(0, 10);
        console.log("No encontrada ayer. Buscando Hoy Mañana:", hoy);
        
        res = await api("getDatosRendicionEsperada", {
            fechaStr: hoy,
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
        
        // Convertir fecha YYYY-MM-DD a DD/MM
        const partes = res.fecha.split("-");
        updateText("rendicion-fecha", `${partes[2]}/${partes[1]}`);
        
        showToast(`Planilla cargada: ${res.turno}`, "ok");
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
        btn.innerText = "PROCESANDO...";

        const params = {
            fechaStr: estado.rendicion.fecha || new Date().toISOString().slice(0, 10),
            turno: estado.rendicion.turno || "Mañana",
            repartidor: estado.rendicion.repartidor || "Manual",
            efectivoContado: contado,
            efectivoEsperado: estado.rendicion.esperado,
            usuario: USUARIO_APP
        };

        const res = await api("procesarRendicionDesdeRecibo", params);
        
        if (res && res.ok) {
            const diff = res.diferencia;
            let msg = "";
            let color = "";
            if(diff === 0) { msg = "EXACTO ✅"; color = "var(--success)"; }
            else if(diff > 0) { msg = `SOBRAN ${formatoMoneda(diff)}`; color = "var(--success)"; }
            else { msg = `FALTAN ${formatoMoneda(diff)}`; color = "var(--danger)"; }

            document.getElementById("resultado-rendicion").innerHTML = `<h3 style="color:${color}">${msg}</h3>`;
            showToast("Rendición procesada y caja actualizada", "ok");
            refreshData(); // Actualiza el saldo y lista de movimientos
        } else {
            showToast(res.error || "Error al procesar", "error");
        }
        btn.disabled = false;
        btn.innerText = "PROCESAR RENDICIÓN";
    });
}

// ===============================
// CONTADOR DE BILLETES (UX MEJORADA)
// ===============================
function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  container.innerHTML = "";

  BILLETES.forEach((denom) => {
    const box = document.createElement("div");
    box.className = "bill-box";
    box.innerHTML = `
      <span class="bill-denom">$ ${denom.toLocaleString()}</span>
      <input type="tel" class="bill-input-qty" data-denom="${denom}" value="0" placeholder="0">
      <span class="bill-subtotal" id="sub-${denom}">$ 0</span>
    `;
    
    const input = box.querySelector("input");
    
    // UX: Borrar automáticamente al tocar
    input.addEventListener("focus", function() {
        if(this.value === "0") this.value = "";
    });
    
    // UX: Restaurar 0 si queda vacío
    input.addEventListener("blur", function() {
        if(this.value === "") this.value = "0";
        calculateBillTotal();
    });

    input.addEventListener("input", calculateBillTotal);

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
        
        // Actualizar subtotal visual
        const subEl = document.getElementById(`sub-${denom}`);
        if(sub > 0) {
            subEl.innerText = `$ ${sub.toLocaleString()}`;
            subEl.style.color = "var(--primary)";
            inp.style.color = "#000";
            inp.parentElement.style.borderColor = "var(--primary)";
            inp.parentElement.style.backgroundColor = "#fff";
        } else {
            subEl.innerText = "$ 0";
            subEl.style.color = "#ccc";
            inp.style.color = "#999";
            inp.parentElement.style.borderColor = "#eee";
            inp.parentElement.style.backgroundColor = "#fafafa";
        }
    });

    const display = document.getElementById("rendicion-contado");
    display.value = formatoMoneda(total);
    display.dataset.numeric = total;
}

window.resetBillCounter = function() {
    document.querySelectorAll(".bill-input-qty").forEach(i => i.value = "0");
    calculateBillTotal();
}

// ===============================
// ARQUEO
// ===============================
function initArqueo() {
    document.getElementById("btn-registrar-arqueo").addEventListener("click", async () => {
        const inp = document.getElementById("arqueo-fisico");
        const val = parseFloat(inp.value) || 0;
        
        if(val <= 0) { showToast("Ingrese el monto físico", "error"); return; }
        
        const res = await api("registrarArqueo", { usuario: USUARIO_APP, efectivoFisico: val });
        
        if(res && res.resultado) {
            const color = res.resultado === "OK" ? "var(--success)" : "var(--danger)";
            document.getElementById("resultado-arqueo").innerHTML = 
                `<h3 style="color:${color}">${res.resultado} (${formatoMoneda(res.diferencia)})</h3>`;
            showToast("Arqueo guardado", "ok");
        }
    });
}

// ===============================
// AUTOCOMPLETE SIMPLE
// ===============================
function initSelectsAuxiliares() {
    const fill = (id, arr) => {
        const s = document.getElementById(id);
        arr.forEach(x => {
            const o = document.createElement("option");
            o.value = x; o.text = x; s.appendChild(o);
        });
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
        if(val.length < 2) return;
        
        const matches = PROVEEDORES.filter(p => p.toLowerCase().includes(val));
        matches.forEach(p => {
            const div = document.createElement("div");
            div.className = "suggestion-item";
            div.innerText = p;
            div.onclick = () => { inp.value = p; box.innerHTML = ""; };
            box.appendChild(div);
        });
    });
    
    // Cerrar al hacer click afuera
    document.addEventListener("click", (e) => {
        if(e.target !== inp) box.innerHTML = "";
    });
}
