// ===============================
// CONFIGURACIÓN
// ===============================
const API_URL = "https://cajamercadolimpio.santamariapablodaniel.workers.dev/"; 
const USUARIO_APP = "Laura";
const RENDICION_POLL_INTERVAL_MS = 60000; 

const PROVEEDORES = ["Marwiplast", "Bio Bag", "Broche plastico", "Bumerang", "Carol", "Colores", "Coolbazar", "Cotton", "Da Silva", "Desesplast", "Diawara", "Emege", "Entresol", "Fedata", "Fibran", "Flexal", "Hechicera", "Infinity import", "K&K", "La Americana", "La gauchita", "Macetex", "Make Fresh", "Matriplaster", "Mis Plast", "Modoplast", "Molmar", "POP", "Rigolleau", "Romyl", "Samantha", "Santamaria", "Sasha", "Soifer", "lumilagro", "Make", "Suka", "Supy", "Tauro", "Tecnomatric", "Yesi", "Durax", "Javi"].sort();
const VEHICULOS = ["Toyota Hiace", "Volkswagen Saveiro", "Fiat Uno Cargo"];
const EMPLEADOS = ["Nicolás", "Laura", "Ariel", "Martín", "Lucas", "Tomas"];
const BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]; 

// ===============================
// DETECTOR DE COMPORTAMIENTO (MONITOR)
// ===============================
class SuspicionTracker {
    constructor() {
        this.reset();
    }
    reset() {
        this.data = {
            startTime: Date.now(),
            edits: 0,          // Veces que cambia un valor
            deletes: 0,        // Veces que borra todo
            submitAttempts: 0, // Intentos fallidos de procesar
            valuesTried: [],   // Historial de valores finales intentados
            suspiciousMoves: 0 // Movimientos raros creados en la sesión
        };
    }
    logEdit(val) { 
        this.data.edits++; 
        if(val) this.data.valuesTried.push(val); 
    }
    logDelete() { this.data.deletes++; }
    logAttempt() { this.data.submitAttempts++; }
    logSuspiciousMove() { this.data.suspiciousMoves++; }
    
    getReport() {
        return {
            ...this.data,
            durationSeconds: Math.floor((Date.now() - this.data.startTime) / 1000)
        };
    }
}
const monitor = new SuspicionTracker();

// ===============================
// API & UTILS
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
    showToast("Error de conexión", "error");
    return null;
  }
}

function formatoMoneda(num) {
  return "$ " + Number(num || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
}

function showToast(msg, type = "info") {
    const container = document.getElementById("toast-container");
    const div = document.createElement("div");
    div.className = "toast-msg";
    
    let icon = "info";
    if(type === "success") { icon = "check_circle"; div.style.background="#2E7D32"; }
    if(type === "error") { icon = "error"; div.style.background="#c62828"; }
    
    div.innerHTML = `<span class="material-icons-round">${icon}</span> <span>${msg}</span>`;
    container.appendChild(div);
    
    requestAnimationFrame(() => div.classList.add("show"));
    setTimeout(() => {
        div.classList.remove("show");
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function showConfirmModal(title, msg, icon, confirmColor, onConfirm) {
    const modal = document.getElementById("modal-custom");
    const btnConfirm = document.getElementById("btn-modal-confirm");
    
    document.getElementById("modal-title").innerText = title;
    document.getElementById("modal-msg").innerHTML = msg; // Permite HTML
    document.getElementById("modal-icon").innerText = icon;
    document.getElementById("modal-icon").style.color = confirmColor;
    
    btnConfirm.style.background = confirmColor;
    btnConfirm.onclick = () => {
        closeModal();
        onConfirm();
    };
    
    modal.style.display = "flex";
}
window.closeModal = () => { document.getElementById("modal-custom").style.display = "none"; };

function setupCurrencyInput(inputId, isMonitor = false) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', function() {
        let val = this.value.replace(/\D/g, '');
        this.dataset.realValue = val;
        this.value = val ? new Intl.NumberFormat('es-AR').format(parseInt(val)) : "";
        
        if(isMonitor) monitor.logEdit(val); // Espía cambios
    });
}
function getCleanNumber(inputId) {
    const input = document.getElementById(inputId);
    return input && input.dataset.realValue ? parseFloat(input.dataset.realValue) : 0;
}
function getFechaSegura(fechaYMD) { return fechaYMD ? fechaYMD + "T12:00:00" : ""; }

function formatoFechaHumano(fechaStr) {
    // Convierte 2025-11-27 a "27 noviembre"
    if(!fechaStr) return "--";
    const [y, m, d] = fechaStr.split("-");
    const date = new Date(y, m-1, d);
    return date.toLocaleDateString("es-ES", { day: 'numeric', month: 'long' });
}

// ===============================
// HELPERS PARA RENDICIONES (LOCALSTORAGE)
// ===============================
function getHoyKeyLocal() {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    return new Date(hoy.getTime() - offset).toISOString().split("T")[0]; // YYYY-MM-DD local
}

function leerEstadoRendicionesLocales() {
    const hoyKey = getHoyKeyLocal();
    const ayerHecha = localStorage.getItem(`rend_${hoyKey}_AyerTarde`) === "1";
    const hoyHecha = localStorage.getItem(`rend_${hoyKey}_HoyManana`) === "1";
    const resumenStr = localStorage.getItem(`rend_ultima_${hoyKey}`);
    let resumen = null;
    if (resumenStr) {
        try { resumen = JSON.parse(resumenStr); } catch (e) { resumen = null; }
    }
    return { hoyKey, ayerHecha, hoyHecha, resumen };
}

function guardarRendicionLocalDesdeRespuesta(res) {
    const { hoyKey } = leerEstadoRendicionesLocales();
    const resumen = {
        fecha: res.fecha,
        turno: res.turno,
        repartidor: res.repartidor,
        efectivoEsperado: res.efectivoEsperado,
        efectivoContado: res.efectivoContado,
        diferencia: res.diferencia
    };
    localStorage.setItem(`rend_ultima_${hoyKey}`, JSON.stringify(resumen));

    // Opción A: consideramos que el ciclo del día tiene 2 rendiciones:
    // 1) Ayer-Tarde  2) Hoy-Mañana
    if (res.turno === "Tarde") {
        localStorage.setItem(`rend_${hoyKey}_AyerTarde`, "1");
    } else if (res.turno === "Mañana") {
        localStorage.setItem(`rend_${hoyKey}_HoyManana`, "1");
    }
}

function habilitarRendicionPendienteUI() {
    const btn = document.getElementById("btn-procesar-rendicion");
    const diffBox = document.getElementById("live-diff-display");

    // Reactivamos inputs de billetes
    document.querySelectorAll(".bill-input-qty").forEach(i => { i.disabled = false; });

    if (btn) {
        btn.disabled = false;
        btn.style.display = "inline-flex";
    }

    if (diffBox) {
        diffBox.className = "diff-bar";
        diffBox.textContent = "Ingresá la cantidad de billetes";
        diffBox.style.background = "";
        diffBox.style.color = "";
        diffBox.style.border = "";
    }
}

function aplicarUIEstadoSinPendientes() {
    const { ayerHecha, hoyHecha, resumen } = leerEstadoRendicionesLocales();

    const statusTextEl = document.getElementById("rendicion-status-text");
    const detalleEl = document.getElementById("rendicion-detalle-humano");
    const esperadoEl = document.getElementById("rendicion-esperado");
    const contadoEl = document.getElementById("rendicion-contado");
    const diffBox = document.getElementById("live-diff-display");
    const btn = document.getElementById("btn-procesar-rendicion");

    // Deshabilitamos inputs, por defecto
    document.querySelectorAll(".bill-input-qty").forEach(i => { i.disabled = true; });

    if (btn) {
        btn.disabled = true;
        btn.style.display = "none";
    }

    // Reseteamos estado lógico en memoria
    estado.rendicionEncontrada = false;
    estado.rendicion = { fecha: null, turno: null, repartidor: null, esperado: 0 };

    if (ayerHecha && hoyHecha && resumen) {
        // ✅ 2 rendiciones completas – mostramos resumen de la última (Opción 1 + A)
        if (statusTextEl) statusTextEl.textContent = "✅ Rendiciones del día completas";
        if (detalleEl) {
            const fechaHumana = resumen.fecha ? formatoFechaHumano(resumen.fecha) : "--";
            detalleEl.textContent = `Última rendición: planilla de ${resumen.repartidor} (${resumen.turno}) del ${fechaHumana}. Caja al día ✨`;
        }
        if (esperadoEl) esperadoEl.textContent = formatoMoneda(resumen.efectivoEsperado || resumen.esperado || 0);
        if (contadoEl) contadoEl.textContent = formatoMoneda(resumen.efectivoContado || resumen.contado || 0);

        if (diffBox) {
            diffBox.className = "diff-bar";
            const diff = (typeof resumen.diferencia === "number")
                ? resumen.diferencia
                : (resumen.efectivoContado || 0) - (resumen.efectivoEsperado || 0);

            if (diff === 0) {
                diffBox.textContent = "Cerró justo. Todo al día ✨";
                diffBox.classList.add("exacto");
            } else if (diff < 0) {
                diffBox.textContent = `FALTARON ${formatoMoneda(Math.abs(diff))}, ya ajustado en caja.`;
                diffBox.classList.add("falta");
            } else {
                diffBox.textContent = `SOBRARON ${formatoMoneda(diff)}, ya ajustado en caja.`;
                diffBox.classList.add("sobra");
            }
        }

    } else if (ayerHecha || hoyHecha) {
        // Solo se hizo una rendición (por ejemplo Ayer-Tarde) y todavía falta la otra
        if (statusTextEl) {
            statusTextEl.textContent = ayerHecha && !hoyHecha
                ? "✅ Rendición de ayer a la tarde procesada."
                : "✅ Una rendición ya fue procesada.";
        }
        if (detalleEl) {
            detalleEl.textContent = "Apenas llegue la próxima planilla de reparto, te la vamos a mostrar acá para que la rindas.";
        }
        if (esperadoEl) esperadoEl.textContent = formatoMoneda(0);
        if (contadoEl) contadoEl.textContent = formatoMoneda(0);
        if (diffBox) {
            diffBox.className = "diff-bar";
            diffBox.textContent = "Esperando la próxima rendición...";
        }

    } else {
        // No hay rendiciones hechas y tampoco hay planillas listas aún
        if (statusTextEl) statusTextEl.textContent = "💤 Todavía no hay planillas listas para rendir";
        if (detalleEl) detalleEl.textContent = "Cuando el repartidor genere la rendición, va a aparecer acá automáticamente.";
        if (esperadoEl) esperadoEl.textContent = formatoMoneda(0);
        if (contadoEl) contadoEl.textContent = formatoMoneda(0);
        if (diffBox) {
            diffBox.className = "diff-bar";
            diffBox.textContent = "Ingresá la cantidad de billetes cuando aparezca una planilla.";
        }
    }
}

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

  const inputFechaMov = document.getElementById("movimientos-fecha");
  // Setear fecha hoy
  const hoy = new Date();
  const offset = hoy.getTimezoneOffset() * 60000;
  const localIso = new Date(hoy.getTime() - offset).toISOString().split('T')[0];
  estado.fechaMovimientos = localIso;
  inputFechaMov.value = localIso;

  inputFechaMov.addEventListener("change", (e) => {
      if(e.target.value) {
          estado.fechaMovimientos = e.target.value;
          cargarMovimientos();
      }
  });

  refreshData();
  setInterval(refreshData, RENDICION_POLL_INTERVAL_MS);
});

const estado = {
  fechaMovimientos: "",
  rendicion: { fecha: null, turno: null, repartidor: null, esperado: 0 },
  rendicionEncontrada: false
};

function initClock() {
    const update = () => {
        const now = new Date();
        document.getElementById("header-time").textContent = now.toLocaleTimeString("es-AR", {hour:'2-digit', minute:'2-digit'});
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
      
      // Reiniciar monitor al cambiar de vista importante
      if(targetId === "view-arqueo" || targetId === "view-rendicion") {
          monitor.reset();
      }
    });
  });
}

// ===============================
// MOVIMIENTOS
// ===============================
async function refreshEstadoCaja() {
  const res = await api("getEstadoCaja");
  if (res) {
      document.getElementById("saldo-total").textContent = formatoMoneda(res.total);
      document.getElementById("arqueo-sistema").textContent = formatoMoneda(res.efectivo);
  }
}

async function cargarMovimientos() {
  const list = document.getElementById("movimientos-list");
  const fecha = document.getElementById("movimientos-fecha").value;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#999">Actualizando...</div>';
  
  const res = await api("getMovimientos", { fechaStr: getFechaSegura(fecha) });
  list.innerHTML = "";
  
  if (!Array.isArray(res) || res.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#bbb;">Sin movimientos hoy</div>';
    return;
  }
  
  res.forEach((m) => {
    const esIngreso = m.tipo === "Ingreso";
    const div = document.createElement("div"); 
    div.className = "mov-item";
    const cat = (m.categoria || "").toLowerCase();
    
    let icon = "paid";
    if(cat.includes("combustible")) icon = "local_gas_station";
    else if(cat.includes("proveedor")) icon = "local_shipping";
    else if(cat.includes("retiro")) icon = "logout";
    
    // Mostrar Proveedor en vez de categoría genérica si existe observación
    let titulo = m.categoria || "Varios";
    if (cat.includes("proveedor") && m.observacion && m.observacion.includes("Pago a")) {
        titulo = m.observacion.replace("Pago a ", "").trim(); // Extraer nombre proveedor
    }

    div.innerHTML = `
      <div style="display:flex;align-items:center;">
        <span class="material-icons-round mov-icon">${icon}</span>
        <div>
            <span class="mov-desc">${titulo}</span>
            <div class="mov-sub">${m.hora} · ${m.formaPago}</div>
        </div>
      </div>
      <div style="font-weight:700; color:${esIngreso ? 'var(--success)' : 'var(--danger)'}">
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

    document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!tipoRapido.value) { showToast("Seleccione un Motivo", "error"); return; }
        const importe = getCleanNumber("importe");
        if(importe <= 0) { showToast("Ingrese importe válido", "error"); return; }

        const btn = document.getElementById("btn-registrar-mov");
        btn.disabled = true;
        
        // Monitor: Registrar si hace movimientos "extraños"
        const catText = tipoRapido.options[tipoRapido.selectedIndex].text;
        if(catText.includes("Varios") || catText.includes("Ajuste")) {
            monitor.logSuspiciousMove();
        }

        const params = {
            tipo: document.getElementById("tipoMovimiento").value,
            formaPago: document.getElementById("formaPago").value,
            importe: importe,
            categoria: catText,
            repartidor: "", turno: "", usuario: USUARIO_APP, 
            observacion: document.getElementById("observacion").value || (tipoRapido.value === "pagoProveedor" ? "Pago a " + document.getElementById("inputProveedor").value : "")
        };

        const res = await api("registrarMovimientoCaja", params);
        if (res && res.ok) {
            showToast("Guardado correctamente", "success");
            document.getElementById("form-movimiento").reset();
            document.getElementById("importe").value = "";
            document.getElementById("importe").dataset.realValue = "";
            refreshData();
        }
        btn.disabled = false;
    });
}

// ===============================
// RENDICIÓN INTELIGENTE
// ===============================
async function buscarRendicionInteligente() {
    const statusText = document.getElementById("rendicion-status-text");
    const detalleEl = document.getElementById("rendicion-detalle-humano");

    if (statusText) statusText.textContent = "Buscando planillas...";

    const ayer = new Date(); 
    ayer.setDate(ayer.getDate() - 1);
    const offset = ayer.getTimezoneOffset() * 60000;
    const fAyer = new Date(ayer.getTime() - offset).toISOString().split('T')[0];
    const fHoy = estado.fechaMovimientos; // Hoy local

    // 1) Primero buscamos Ayer - Tarde
    let res = await api("getDatosRendicionEsperada", { fechaStr: getFechaSegura(fAyer), turno: "Tarde", repartidor: "Nico" });
    // 2) Si no hay nada, probamos Hoy - Mañana
    if (!res || !res.ok || !res.efectivoEsperado) {
        res = await api("getDatosRendicionEsperada", { fechaStr: getFechaSegura(fHoy), turno: "Mañana", repartidor: "Nico" });
    }

    if (res && res.ok && res.efectivoEsperado > 0) {
        estado.rendicionEncontrada = true;
        estado.rendicion = { ...res, esperado: res.efectivoEsperado };
        
        if (statusText) statusText.textContent = "Rendición encontrada:";
        if (detalleEl) {
            detalleEl.textContent = `Planilla de ${res.repartidor} (${res.turno}) del ${formatoFechaHumano(res.fecha)}`;
        }
        const esperadoEl = document.getElementById("rendicion-esperado");
        if (esperadoEl) esperadoEl.textContent = formatoMoneda(res.efectivoEsperado);

        // Activamos UI para rendición pendiente
        habilitarRendicionPendienteUI();
        // Calculamos diferencia con lo que ya esté cargado (por si había algo)
        calculateBillTotal();
    } else {
        // No hay planillas nuevas -> aplicamos lógica según localStorage
        aplicarUIEstadoSinPendientes();
    }
}

function createBillCounterHero() {
  const container = document.getElementById("bill-counter-container");
  container.innerHTML = "";
  BILLETES.forEach((denom) => {
    const box = document.createElement("div"); box.className = "bill-box";
    box.innerHTML = `
      <div class="bill-denom">$ ${denom.toLocaleString()}</div>
      <input type="tel" class="bill-input-qty" data-denom="${denom}" placeholder="0">
    `;
    const input = box.querySelector("input");
    input.addEventListener("input", (e) => { 
        e.target.value = e.target.value.replace(/[^0-9]/g, ''); 
        // Monitor: Registrar edición de billetes
        monitor.logEdit();
        calculateBillTotal(); 
    });
    input.addEventListener("focus", function() { 
        this.parentElement.classList.add("active"); 
        if(this.value==="0") this.value=""; 
    });
    input.addEventListener("blur", function() { 
        this.parentElement.classList.remove("active"); 
        if(this.value==="") this.value="0"; 
    });
    
    container.appendChild(box);
  });
}

function calculateBillTotal() {
    let total = 0;
    document.querySelectorAll(".bill-input-qty").forEach(inp => {
        let val = parseInt(inp.value)||0;
        total += val * parseInt(inp.dataset.denom);
    });

    // Actualizar Total Físico
    const contadoEl = document.getElementById("rendicion-contado");
    if (contadoEl) {
        contadoEl.textContent = formatoMoneda(total);
        contadoEl.dataset.numeric = total;
    }

    // Actualizar Diferencia
    const esperado = estado.rendicion.esperado || 0;
    const diff = total - esperado;
    const diffBox = document.getElementById("live-diff-display");
    
    if (!diffBox) return;

    diffBox.className = "diff-bar"; // reset clases

    if (total === 0) {
        diffBox.textContent = "Ingresá la cantidad de billetes";
        diffBox.style.background = "#f5f5f5"; 
        diffBox.style.color = "#999"; 
        diffBox.style.border = "none";
    } else if (diff === 0) {
        diffBox.textContent = "¡EXACTO! Coincide perfecto 🎉";
        diffBox.classList.add("exacto");
    } else if (diff < 0) {
        diffBox.textContent = `FALTAN ${formatoMoneda(Math.abs(diff))}`;
        diffBox.classList.add("falta");
    } else {
        // Mensaje personalizado ancho
        diffBox.textContent = `SOBRAN ${formatoMoneda(diff)} (Tranqui, se ajusta solo)`;
        diffBox.classList.add("sobra");
    }
}

function initRendicionLogic() {
    const btn = document.getElementById("btn-procesar-rendicion");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const contadoEl = document.getElementById("rendicion-contado");
        const contado = contadoEl ? parseFloat(contadoEl.dataset.numeric) || 0 : 0;
        if (contado === 0) { 
            showToast("Contá los billetes primero", "error"); 
            monitor.logAttempt(); 
            return; 
        }
        
        const diff = contado - (estado.rendicion.esperado || 0);
        let msg = "El monto ingresado coincide con el sistema.";
        let icon = "check_circle";
        let color = "var(--success)";

        if (diff !== 0) {
            msg = `Hay una diferencia de <b>${formatoMoneda(diff)}</b>.<br>El sistema ajustará la caja automáticamente para que coincida con lo real.`;
            icon = "info";
            color = "var(--primary)";
        }

        showConfirmModal(
            "¿Confirmás la Rendición?", 
            msg, 
            icon, 
            color,
            async () => { // On Confirm
                btn.disabled = true; 
                btn.innerHTML = "Procesando...";

                const params = {
                    fechaStr: getFechaSegura(estado.rendicion.fecha || estado.fechaMovimientos),
                    turno: estado.rendicion.turno || "Mañana",
                    repartidor: estado.rendicion.repartidor || "Manual",
                    efectivoContado: contado,
                    efectivoEsperado: estado.rendicion.esperado,
                    usuario: USUARIO_APP,
                    monitorData: monitor.getReport() // ENVIAMOS DATOS DE COMPORTAMIENTO
                };

                const res = await api("procesarRendicionDesdeRecibo", params);
                if (res && res.ok) {
                    showToast("¡Rendición procesada!", "success");
                    
                    // Guardamos estado local de esa rendición (para saber si es Ayer-Tarde u Hoy-Mañana)
                    guardarRendicionLocalDesdeRespuesta(res);

                    window.resetBillCounter();
                    refreshData(); // Esto volverá a llamar buscarRendicionInteligente
                    // y, si ya no hay planillas, aplicará la UI de "todo al día".
                } else {
                    showToast(res && res.mensaje ? res.mensaje : "Error al procesar", "error");
                }
                btn.disabled = false; 
                btn.innerHTML = '<span class="material-icons-round">check_circle</span> CONFIRMAR RENDICIÓN';
            }
        );
    });
}

window.resetBillCounter = function() {
    document.querySelectorAll(".bill-input-qty").forEach(i => i.value = "");
    calculateBillTotal();
    monitor.logDelete(); // Registrar borrado masivo
}

// ===============================
// ARQUEO BLINDADO & MONITOREADO
// ===============================
function initArqueoLogic() {
    setupCurrencyInput("arqueo-fisico", true); // true = monitorear inputs
    
    const btn = document.getElementById("btn-pre-arqueo");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const fisico = getCleanNumber("arqueo-fisico");
        if(fisico <= 0) { 
            showToast("Ingrese efectivo real", "error"); 
            monitor.logAttempt(); 
            return; 
        }
        
        showConfirmModal(
            "Cierre Final de Caja",
            "Estás por cerrar la caja del día. <br>El saldo se ajustará a lo que ingresaste.<br><b>Esta acción es irreversible.</b>",
            "lock",
            "var(--warning)",
            async () => {
                btn.disabled = true; 
                btn.textContent = "Cerrando...";

                const res = await api("registrarArqueo", { 
                    usuario: USUARIO_APP, 
                    efectivoFisico: fisico,
                    monitorData: monitor.getReport() // ENVIAMOS EL REPORTE DE SOSPECHA
                });
                
                if (res && res.resultado) {
                    // Ajuste automático si fuera necesario
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
                    
                    const vistaArqueo = document.getElementById("view-arqueo");
                    if (vistaArqueo) {
                        vistaArqueo.innerHTML = `
                            <div class="card" style="text-align:center; padding:40px; border:3px solid var(--success); animation:fadeIn 0.5s;">
                                <span class="material-icons-round" style="font-size:80px; color:var(--success); margin-bottom:20px;">check_circle</span>
                                <h2 style="color:var(--success); font-weight:800;">¡Caja Cerrada!</h2>
                                <p style="color:#555; font-size:1.1rem;">Efectivo inicial para mañana:</p>
                                <div style="font-size:3rem; font-weight:800; color:#333; margin-top:10px;">${formatoMoneda(fisico)}</div>
                            </div>
                        `;
                    }
                    resetBillCounter();
                    refreshEstadoCaja();
                } else {
                    showToast("Error al cerrar caja", "error");
                }
                btn.disabled = false;
                btn.textContent = "CERRAR CAJA";
            }
        );
    });
}

// UTILS
function initSelects() {
    const fill = (id, arr) => { 
        const s = document.getElementById(id); 
        if (!s) return;
        arr.forEach(x => s.add(new Option(x, x))); 
    };
    fill("selectVehiculo", VEHICULOS); 
    fill("selectEmpleado", EMPLEADOS);
    
    const inp = document.getElementById("inputProveedor");
    const box = document.getElementById("proveedor-suggestions");
    if (!inp || !box) return;

    inp.addEventListener("input", function() {
        const val = this.value.toLowerCase(); 
        box.innerHTML = "";
        if(val.length < 2) { 
            box.style.display = 'none'; 
            return; 
        }
        const matches = PROVEEDORES.filter(p => p.toLowerCase().includes(val));
        if(matches.length > 0) {
            box.style.display = 'block';
            matches.forEach(p => {
                const div = document.createElement("div"); 
                div.style.padding="12px"; 
                div.style.borderBottom="1px solid #eee"; 
                div.style.cursor="pointer";
                div.innerText = p; 
                div.onclick = () => { 
                    inp.value = p; 
                    box.style.display = 'none'; 
                };
                box.appendChild(div);
            });
        } else box.style.display = 'none';
    });
    document.addEventListener("click", (e) => { 
        if(e.target !== inp) box.style.display = 'none'; 
    });
}
