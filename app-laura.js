// ===============================
// CONFIGURACIÓN Y ESTADO
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/"; 
const USUARIO_APP = "Laura";
const RENDICION_POLL_INTERVAL_MS = 60000; 

const PROVEEDORES = ["Marwiplast", "Bio Bag", "Broche plastico", "Bumerang", "Carol", "Colores", "Coolbazar", "Cotton", "Da Silva", "Desesplast", "Diawara", "Emege", "Entresol", "Fedata", "Fibran", "Flexal", "Hechicera", "Infinity import", "K&K", "La Americana", "La gauchita", "Macetex", "Make Fresh", "Matriplaster", "Mis Plast", "Modoplast", "Molmar", "POP", "Rigolleau", "Romyl", "Samantha", "Santamaria", "Sasha", "Soifer", "lumilagro", "Make", "Suka", "Supy", "Tauro", "Tecnomatric", "Yesi", "Durax", "Javi"].sort();
const VEHICULOS = ["Toyota Hiace", "Volkswagen Saveiro", "Fiat Uno Cargo"];
const EMPLEADOS = ["Nicolás", "Laura", "Nancy", "Martín", "Lucas"];
const BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]; 

const getHoyLocal = () => {
    const d = new Date();
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
// API & HELPERS
// ===============================
async function api(fn, params = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fn, params })
    });
    return await res.json();
  } catch (e) {
    showToast("Error de conexión", "error"); return null;
  }
}

function formatoMoneda(num) {
  return "$ " + Number(num || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg; toast.className = "toast-msg show";
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function updateText(id, text) { const el = document.getElementById(id); if(el) el.textContent = text; }

function setupCurrencyInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', function() {
        let val = this.value.replace(/\D/g, '');
        this.dataset.realValue = val;
        this.value = val ? new Intl.NumberFormat('es-AR').format(parseInt(val)) : "";
    });
}
function getCleanNumber(inputId) {
    const input = document.getElementById(inputId);
    return input.dataset.realValue ? parseFloat(input.dataset.realValue) : 0;
}
function getFechaSegura(fechaYMD) { return fechaYMD ? fechaYMD + "T12:00:00" : ""; }

// ===============================
// INICIALIZACIÓN
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initNavigation();
  initFormMovimiento();
  initSelects();
  createBillCounterHero();
  initRendicionLogic();
  initArqueoLogic();

  // Fecha Movimientos (Funcional para días anteriores)
  const inputFechaMov = document.getElementById("movimientos-fecha");
  inputFechaMov.value = estado.fechaMovimientos;
  inputFechaMov.addEventListener("change", (e) => {
      if(e.target.value) {
          estado.fechaMovimientos = e.target.value;
          cargarMovimientos();
      }
  });

  refreshData();
  setInterval(refreshData, RENDICION_POLL_INTERVAL_MS);
});

function initClock() {
    const update = () => {
        const now = new Date();
        updateText("header-time", now.toLocaleTimeString("es-AR", {hour:'2-digit', minute:'2-digit'}));
    }; update(); setInterval(update, 30000);
}

function refreshData() {
  refreshEstadoCaja();
  cargarMovimientos();
  if (!estado.rendicionEncontrada || estado.rendicion.esperado === 0) buscarRendicionInteligente();
}

function initNavigation() {
  const btns = document.querySelectorAll(".nav-btn");
  const views = document.querySelectorAll(".view-section");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
      views.forEach(v => {
          v.classList.remove("active");
          if(v.id === targetId) v.classList.add("active");
      });
    });
  });
}

// ===============================
// MOVIMIENTOS
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (res) {
      estado.saldo = res;
      updateText("saldo-total", formatoMoneda(res.total));
      updateText("arqueo-sistema", formatoMoneda(res.efectivo));
  }
}

async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  const fecha = document.getElementById("movimientos-fecha").value;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#999">Cargando...</div>';
  
  const res = await api("getMovimientos", { fechaStr: getFechaSegura(fecha) });
  list.innerHTML = "";
  
  if (!Array.isArray(res) || res.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:0.8rem">Sin movimientos</div>';
    return;
  }
  
  res.forEach((m) => {
    const esIngreso = m.tipo === "Ingreso";
    const div = document.createElement("div"); div.className = "mov-item";
    const cat = (m.categoria || "").toLowerCase();
    let icon = "paid";
    if(cat.includes("combustible")) icon = "local_gas_station";
    else if(cat.includes("proveedor")) icon = "local_shipping";
    
    div.innerHTML = `
      <div class="mov-left">
        <span class="material-icons-round mov-icon">${icon}</span>
        <div>
            <span class="mov-desc">${m.categoria || "Varios"}</span>
            <span class="mov-sub">${m.hora} · ${m.formaPago}</span>
        </div>
      </div>
      <div class="${esIngreso ? "text-success" : "text-danger"}">
        ${esIngreso ? "+" : "-"} ${Math.abs(m.importe).toLocaleString("es-AR")}
      </div>
    `;
    list.appendChild(div);
  });
}

function initFormMovimiento() {
    const tipoRapido = document.getElementById("tipoRapido");
    setupCurrencyInput("importe");

    tipoRapido.addEventListener("change", () => {
        document.querySelectorAll(".hidden-row").forEach(el => el.style.display = 'none');
        const v = tipoRapido.value;
        if(v === "pagoProveedor") document.getElementById("row-proveedor").style.display = 'block';
        if(v === "combustible") document.getElementById("row-vehiculo").style.display = 'block';
        if(v === "adelanto" || v === "haber") document.getElementById("row-empleado").style.display = 'block';
    });

    document.getElementById("btn-registrar-mov").addEventListener("click", async (e) => {
        e.preventDefault();
        if (!tipoRapido.value) { showToast("Seleccione un Motivo"); return; }
        const importe = getCleanNumber("importe");
        if(importe <= 0) { showToast("Ingrese importe"); return; }

        const btn = document.getElementById("btn-registrar-mov");
        btn.disabled = true;
        
        const params = {
            tipo: document.getElementById("tipoMovimiento").value,
            formaPago: document.getElementById("formaPago").value,
            importe: importe,
            categoria: tipoRapido.options[tipoRapido.selectedIndex].text,
            repartidor: "", turno: "", usuario: USUARIO_APP, 
            observacion: document.getElementById("observacion").value || (tipoRapido.value === "pagoProveedor" ? document.getElementById("inputProveedor").value : "")
        };

        const res = await api("registrarMovimientoCaja", params);
        if (res && res.ok) {
            showToast("Guardado");
            document.getElementById("form-movimiento").reset();
            document.getElementById("importe").value = "";
            document.getElementById("importe").dataset.realValue = "";
            refreshData();
        }
        btn.disabled = false;
    });
}

// ===============================
// RENDICIÓN (LÓGICA NUEVA)
// ===============================
async function buscarRendicionInteligente() {
    updateText("rendicion-repartidor", "Buscando...");
    
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    const offset = ayer.getTimezoneOffset() * 60000;
    const fAyer = new Date(ayer.getTime() - offset).toISOString().split('T')[0];
    const fHoy = getHoyLocal();

    let res = await api("getDatosRendicionEsperada", { fechaStr: getFechaSegura(fAyer), turno: "Tarde", repartidor: "Nico" });
    if (!res || !res.ok) res = await api("getDatosRendicionEsperada", { fechaStr: getFechaSegura(fHoy), turno: "Mañana", repartidor: "Nico" });

    if (res && res.ok && res.efectivoEsperado > 0) {
        estado.rendicionEncontrada = true;
        estado.rendicion = { ...res, esperado: res.efectivoEsperado }; // Guardar todo
        
        updateText("rendicion-esperado", formatoMoneda(res.efectivoEsperado));
        updateText("rendicion-repartidor", res.repartidor);
        updateText("rendicion-turno-fecha", `${res.turno} - ${res.fecha.slice(5)}`);
        
        calculateBillTotal(); // Recalcular diff por si ya había billetes cargados
    } else {
        updateText("rendicion-repartidor", "No encontrada");
        updateText("rendicion-esperado", "$ 0,00");
    }
}

function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  container.innerHTML = "";
  BILLETES.forEach((denom) => {
    const box = document.createElement("div"); box.className = "bill-box";
    box.innerHTML = `
      <span class="bill-denom">$ ${denom.toLocaleString()}</span>
      <input type="tel" class="bill-input-qty" data-denom="${denom}" value="" placeholder="0">
    `;
    const input = box.querySelector("input");
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
        let val = parseInt(inp.value)||0;
        total += val * parseInt(inp.dataset.denom);
        // Resaltar si tiene valor
        inp.style.borderColor = val > 0 ? "var(--primary)" : "#ddd";
        inp.style.background = val > 0 ? "#fff" : "#fafafa";
    });

    // Actualizar Total Físico
    const display = document.getElementById("rendicion-contado");
    display.textContent = formatoMoneda(total);
    display.dataset.numeric = total;

    // Actualizar Diferencia en Vivo
    const esperado = estado.rendicion.esperado || 0;
    const diff = total - esperado;
    const diffBox = document.getElementById("live-diff-display");
    
    // Lógica Visual de Diferencia
    diffBox.className = "diff-bar"; // Reset clases
    if (diff === 0 && total > 0) {
        diffBox.textContent = "¡EXACTO! ✅";
        diffBox.classList.add("exacto");
    } else if (diff < 0) {
        diffBox.textContent = `FALTAN: ${formatoMoneda(diff)}`;
        diffBox.classList.add("falta");
    } else if (diff > 0) {
        diffBox.textContent = `SOBRAN: +${formatoMoneda(diff)} (Se ajustará)`;
        diffBox.classList.add("sobra");
    } else {
        diffBox.textContent = "Diferencia: $ 0,00"; // Estado inicial
    }
}

function initRendicionLogic() {
    document.getElementById("btn-procesar-rendicion").addEventListener("click", async () => {
        const contado = parseFloat(document.getElementById("rendicion-contado").dataset.numeric) || 0;
        if (contado === 0) { showToast("Ingrese los billetes"); return; }
        
        // Confirmación para sobrantes
        const diff = contado - estado.rendicion.esperado;
        if (diff > 0) {
            if(!confirm(`Hay un sobrante de ${formatoMoneda(diff)}. \n¿Confirmar que el dinero físico es real? \nLa caja se ajustará al valor físico.`)) return;
        }

        const btn = document.getElementById("btn-procesar-rendicion");
        btn.disabled = true; btn.textContent = "Procesando...";

        const params = {
            fechaStr: getFechaSegura(estado.rendicion.fecha || getHoyLocal()),
            turno: estado.rendicion.turno || "Mañana",
            repartidor: estado.rendicion.repartidor || "Manual",
            efectivoContado: contado,
            efectivoEsperado: estado.rendicion.esperado,
            usuario: USUARIO_APP
        };

        const res = await api("procesarRendicionDesdeRecibo", params);
        if (res && res.ok) {
            showToast("Rendición procesada");
            window.resetBillCounter();
            refreshData(); 
            // Volver a pantalla principal tras éxito
            document.querySelector('[data-target="view-movimientos"]').click();
        } else {
            showToast("Error al procesar");
        }
        btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">check_circle</span> CONFIRMAR RENDICIÓN';
    });
}

window.resetBillCounter = function() {
    document.querySelectorAll(".bill-input-qty").forEach(i => { i.value = ""; i.style.background="#fafafa"; });
    calculateBillTotal();
}

// ===============================
// ARQUEO BLINDADO
// ===============================
function initArqueoLogic() {
    setupCurrencyInput("arqueo-fisico");
    document.getElementById("btn-pre-arqueo").addEventListener("click", async () => {
        const fisico = getCleanNumber("arqueo-fisico");
        if(fisico <= 0) { showToast("Ingrese efectivo real"); return; }
        
        if(!confirm("¿CONFIRMAS EL CIERRE FINAL DE CAJA?\nSe ajustará el saldo automáticamente.")) return;

        const btn = document.getElementById("btn-pre-arqueo");
        btn.disabled = true; btn.textContent = "Cerrando...";

        const res = await api("registrarArqueo", { usuario: USUARIO_APP, efectivoFisico: fisico });
        
        if (res && res.resultado) {
            // Ajuste automático si hubo diferencia
            if (res.diferencia !== 0) {
                await api("registrarMovimientoCaja", {
                    tipo: res.diferencia > 0 ? "Ingreso" : "Egreso",
                    formaPago: "Efectivo",
                    importe: Math.abs(res.diferencia),
                    categoria: "Ajuste Post-Arqueo",
                    repartidor: "", turno: "", usuario: "Sistema",
                    observacion: "Ajuste automático cierre caja"
                });
            }
            
            // UI Final
            document.getElementById("card-arqueo-content").style.display = "none"; // Ocultar form
            document.getElementById("arqueo-final-msg").style.display = "block"; // Mostrar éxito
            document.getElementById("final-cash-display").textContent = formatoMoneda(fisico);
            
            resetBillCounter();
            refreshEstadoCaja();
        }
        btn.disabled = false;
    });
}

// UTILS
function initSelects() {
    const fill = (id, arr) => { const s = document.getElementById(id); arr.forEach(x => s.add(new Option(x, x))); };
    fill("selectVehiculo", VEHICULOS); fill("selectEmpleado", EMPLEADOS);
    
    // Autocomplete Proveedor
    const inp = document.getElementById("inputProveedor");
    const box = document.getElementById("proveedor-suggestions");
    inp.addEventListener("input", function() {
        const val = this.value.toLowerCase(); box.innerHTML = "";
        if(val.length < 2) { box.style.display = 'none'; return; }
        const matches = PROVEEDORES.filter(p => p.toLowerCase().includes(val));
        if(matches.length > 0) {
            box.style.display = 'block';
            matches.forEach(p => {
                const div = document.createElement("div"); div.style.padding="8px"; div.style.borderBottom="1px solid #eee";
                div.innerText = p; 
                div.onclick = () => { inp.value = p; box.style.display = 'none'; };
                box.appendChild(div);
            });
        } else box.style.display = 'none';
    });
    document.addEventListener("click", (e) => { if(e.target !== inp) box.style.display = 'none'; });
}
