/**
 * CAJA MERCADO LIMPIO — CLOUDFLARE WORKER
 *
 * POST /          → proxy al GAS + doble escritura a Supabase
 * GET  /sb/*      → lectura directa de Supabase (~150ms)
 * POST /sb/sincronizar-rendiciones?from=YYYY-MM-DD&to=YYYY-MM-DD
 *                 → detecta rendiciones sin movimiento y los crea
 *
 * Secrets (Cloudflare dashboard → Settings → Variables):
 *   SUPABASE_ANON_KEY    — lectura pública (SELECT)
 *   SUPABASE_SERVICE_KEY — escritura interna (INSERT/UPDATE/DELETE)
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyWwaLm9lI07YykVzFOIuXnqALteUxzGqWwoSl8ThAmeYvMoSRWve_JKmOMOyG92O_yWg/exec";
const SB_URL  = "https://gjeyvbidomxzofcdycya.supabase.co/rest/v1";

const ALLOWED_ORIGINS = [
  "https://pablosantamaria26.github.io",
  "https://pablosantamaria26.github.io/CajaMercadoLimpio",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

// ── helpers ──────────────────────────────────────────────────────
function corsH(origin) {
  return {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGINS.includes(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
function arNow() {
  const dt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const pad = n => String(n).padStart(2, "0");
  return {
    fecha: `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`,
    hora:  `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`,
  };
}

/**
 * Genera un ID único sin necesidad de leer la DB.
 * Formato: Unix-ms (13 dígitos) + 3 dígitos random = bigint de 16 dígitos.
 * Elimina la race condition del sbMaxId anterior.
 */
function genId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// ── Supabase helpers ─────────────────────────────────────────────
function sbWriteH(key) {
  return {
    "apikey":        key,
    "Authorization": `Bearer ${key}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
  };
}
function sbReadH(key) {
  return { "apikey": key, "Authorization": `Bearer ${key}` };
}

/**
 * Inserta en Supabase. Lanza Error si el HTTP status no es 2xx.
 */
async function sbInsert(env, table, data) {
  const r = await fetch(`${SB_URL}/${table}`, {
    method:  "POST",
    headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
    body:    JSON.stringify(data),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`sbInsert(${table}) HTTP ${r.status}: ${detail.slice(0, 200)}`);
  }
}

/**
 * sbInsert con reintentos automáticos (hasta maxRetries veces).
 * Espera 300ms, 600ms entre intentos. Lanza el último error si todos fallan.
 */
async function sbInsertWithRetry(env, table, data, maxRetries = 4) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try { await sbInsert(env, table, data); return; }
    catch (e) {
      lastErr = e;
      if (i < maxRetries) await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Calcula el saldo acumulado desde movimientos_caja (Supabase).
 * Devuelve { efectivo, cheques, banco, total } o null si falla.
 */
async function calcSaldoSB(rH) {
  const allMovs = [];
  let offset = 0;
  while (true) {
    const r = await fetch(
      `${SB_URL}/movimientos_caja?select=tipo,forma_pago,importe,estado&deleted_at=is.null&limit=1000&offset=${offset}`,
      { headers: rH }
    );
    const page = await r.json().catch(() => null);
    if (!Array.isArray(page)) return null;
    allMovs.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  const s = { efectivo: 0, cheques: 0, banco: 0 };
  for (const m of allMovs) {
    const v  = Number(m.importe || 0);
    const fp = (m.forma_pago || "").toLowerCase();
    const st = (m.estado || "").toUpperCase();
    if (fp === "efectivo") {
      s.efectivo += m.tipo === "Ingreso" ? v : -v;
    } else if (fp === "cheque") {
      if (m.tipo === "Ingreso" && !st.startsWith("ENTREGADO") && st !== "COBRADO" && st !== "DEPOSITADO") {
        s.cheques += v;
      }
    } else if (fp === "banco" || fp === "transferencia") {
      s.banco += m.tipo === "Ingreso" ? v : -v;
    }
  }
  return { ...s, total: allMovs.length };
}

/**
 * RECONCILIACIÓN AUTOMÁTICA — Supabase es la fuente de verdad (desde
 * 08/2026). Compara movimientos Supabase vs GAS en una ventana de días:
 *  - Lo que está en Supabase y falta en GAS → se ESPEJA a la planilla
 *    (reintenta lo que el mirror en segundo plano no haya logrado).
 *  - Lo que está en GAS pero NO en Supabase → NUNCA se borra ni se toca
 *    nada en Supabase por esto (Supabase manda). Solo se reporta —
 *    normalmente significa una edición manual directa en la sheet.
 * Clave de comparación: fecha|tipo|forma_pago|importe|categoria — sin hora,
 * para tolerar diferencias de segundos entre el reloj de GAS y el del worker.
 */
async function reconciliarMovimientos(env, days = 3) {
  const svcKey = env.SUPABASE_SERVICE_KEY;
  if (!svcKey) return { ok: false, error: "Sin SUPABASE_SERVICE_KEY" };

  const to    = arNow().fecha;
  const desde = new Date(to + "T12:00:00");
  desde.setDate(desde.getDate() - days);
  const from  = desde.toISOString().split("T")[0];

  // 1. Supabase (fuente de verdad)
  const sbR = await fetch(
    `${SB_URL}/movimientos_caja?deleted_at=is.null&fecha=gte.${from}&fecha=lte.${to}` +
    `&select=id,fecha,hora,tipo,forma_pago,banco,nro_cheque,importe,categoria,repartidor,turno,usuario,observacion,vehiculo,estado,id_cheque_origen`,
    { headers: sbReadH(svcKey) }
  );
  const sbRows = await sbR.json().catch(() => null);
  if (!Array.isArray(sbRows)) return { ok: false, error: "Supabase no devolvió movimientos" };

  // 2. GAS
  let gasRows;
  try {
    const r = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ fn: "getMovimientosRango", params: { startDateStr: from, endDateStr: to } }),
    });
    const d = await r.json();
    if (!d?.ok || !Array.isArray(d.data)) return { ok: false, error: "GAS no devolvió movimientos" };
    gasRows = d.data;
  } catch (e) {
    return { ok: false, error: "GAS: " + e.message };
  }

  const keyOf = (fecha, tipo, fp, imp, cat) =>
    `${fecha}|${tipo}|${String(fp).toLowerCase()}|${Number(imp)}|${String(cat).trim()}`;

  const gasMap = new Map();
  for (const g of gasRows) {
    const k = keyOf(g.fecha, g.tipo, g.formaPago, g.importe, g.categoria);
    if (!gasMap.has(k)) gasMap.set(k, []);
    gasMap.get(k).push(g);
  }
  const sbMap = new Map();
  for (const s of sbRows) {
    const k = keyOf(s.fecha, s.tipo, s.forma_pago, s.importe, s.categoria);
    if (!sbMap.has(k)) sbMap.set(k, []);
    sbMap.get(k).push(s);
  }

  const espejados = [], soloEnGAS = [], errores = [];

  // Faltantes en GAS → espejar desde Supabase (reintento del mirror async)
  for (const [k, sRows] of sbMap) {
    const have = gasMap.get(k)?.length || 0;
    for (let i = have; i < sRows.length; i++) {
      const s = sRows[i];
      try {
        await fetch(GAS_URL, {
          method: "POST",
          body: JSON.stringify({
            fn: "registrarMovimientoCaja",
            params: {
              tipo: s.tipo, formaPago: s.forma_pago, importe: s.importe, categoria: s.categoria,
              repartidor: s.repartidor, turno: s.turno, banco: s.banco, nroCheque: s.nro_cheque,
              usuario: s.usuario, observacion: s.observacion, vehiculo: s.vehiculo,
              idChequeOrigen: s.id_cheque_origen || undefined,
            },
          }),
        });
        espejados.push({ fecha: s.fecha, tipo: s.tipo, importe: s.importe, categoria: s.categoria });
      } catch (e) {
        errores.push(`espejar ${k}: ${e.message}`);
      }
    }
  }

  // Sobrantes en GAS (no están en Supabase) → NO TOCAR Supabase. Reportar
  // nomás — suele ser una edición manual directa en la sheet.
  for (const [k, gRows] of gasMap) {
    const should = sbMap.get(k)?.length || 0;
    if (gRows.length > should) {
      for (const g of gRows.slice(should)) {
        soloEnGAS.push({ fecha: g.fecha, hora: g.hora, tipo: g.tipo, importe: g.importe, categoria: g.categoria });
      }
    }
  }

  return { ok: true, from, to, espejados, soloEnGAS, errores,
           reparado: espejados.length, atencion: soloEnGAS.length };
}

/**
 * Avisa por mail cuando el cron encuentra movimientos que el espejo
 * automático no logró llevar solo a la planilla (la reconciliación ya
 * los reparó — esto es solo para que quede visible si pasa seguido).
 */
async function alertarSyncAtrasado(items) {
  try {
    await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        fn: "enviarEmailAlertaSync",
        params: { cantidad: items.length, items: items.slice(0, 15) },
      }),
    });
  } catch (e) {
    console.error("[alertarSyncAtrasado] no se pudo enviar el mail:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// SUPABASE PRIMERO — registro rápido y confiable, GAS se espeja
// en segundo plano sin que el usuario espere (ver mirrorToGAS más abajo).
// ════════════════════════════════════════════════════════════════

/**
 * Inserta con protección de idempotencia: si data.client_op_id ya fue
 * procesado antes (choca contra el índice UNIQUE de Postgres), devuelve
 * el registro YA CREADO en vez de duplicarlo. Esto es lo que evita que
 * un reintento (doble tap, red que se corta y el cliente reintenta)
 * cree dos movimientos idénticos — la garantía la da la base de datos,
 * no una revisión desde el código (que tiene ventana de carrera).
 */
async function sbInsertIdempotente(env, table, data) {
  const r = await fetch(`${SB_URL}/${table}`, {
    method:  "POST",
    headers: { ...sbWriteH(env.SUPABASE_SERVICE_KEY), "Prefer": "return=representation" },
    body:    JSON.stringify(data),
  });
  if (r.ok) {
    const rows = await r.json();
    return { row: rows[0], duplicado: false };
  }
  const detail = await r.text().catch(() => "");
  // 23505 = unique_violation de Postgres — este client_op_id ya se procesó
  if (data.client_op_id && (r.status === 409 || detail.includes("23505") || detail.toLowerCase().includes("duplicate key"))) {
    const rExist = await fetch(
      `${SB_URL}/${table}?client_op_id=eq.${encodeURIComponent(data.client_op_id)}&limit=1`,
      { headers: sbReadH(env.SUPABASE_SERVICE_KEY) }
    );
    const existing = await rExist.json().catch(() => []);
    if (existing[0]) return { row: existing[0], duplicado: true };
  }
  throw new Error(`sbInsertIdempotente(${table}) HTTP ${r.status}: ${detail.slice(0, 200)}`);
}

async function registrarMovimientoSB(env, params) {
  const { fecha, hora } = arNow();
  let obs = params.observacion || null;
  if (params.vehiculo) {
    const tag = `[Veh: ${params.vehiculo}]`;
    if (!obs) obs = tag;
    else if (!obs.includes('[Veh:')) obs = `${tag} ${obs}`;
  }
  if (params.proveedor) {
    const tag = `[Prov: ${params.proveedor}]`;
    if (!obs) obs = tag;
    else if (!obs.includes('[Prov:')) obs = `${tag} ${obs}`;
  }

  const row = {
    id:           genId(),
    fecha:        params.fechaStr?.split("T")[0] || fecha,
    hora,
    tipo:         params.tipo,
    forma_pago:   params.formaPago,
    banco:        params.banco     || null,
    nro_cheque:   params.nroCheque || null,
    importe:      Number(params.importe),
    categoria:    params.categoria,
    repartidor:   params.repartidor || null,
    turno:        params.turno      || null,
    usuario:      params.usuario    || "Laura",
    observacion:  obs,
    vehiculo:     params.vehiculo   || null,
    client_op_id: params.opId || null,
  };

  const { row: saved, duplicado } = await sbInsertIdempotente(env, "movimientos_caja", row);

  // Entrega de cheque en cartera: marcar el ingreso original como ENTREGADO.
  if (!duplicado && params.tipo === "Egreso" && params.formaPago === "Cheque" && params.idChequeOrigen && params.nroCheque) {
    try {
      const [y, m, d] = fecha.split("-");
      const q = `${SB_URL}/movimientos_caja?tipo=eq.Ingreso&forma_pago=eq.Cheque` +
                `&nro_cheque=eq.${encodeURIComponent(params.nroCheque)}` +
                `&importe=eq.${Number(params.importe)}&deleted_at=is.null`;
      await fetch(q, {
        method:  "PATCH",
        headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
        body:    JSON.stringify({ estado: `ENTREGADO: ${d}/${m}` }),
      });
    } catch (e) {
      console.error("[registrarMovimientoSB] estado cheque:", e.message);
    }
  }

  return { ok: true, id: saved.id, duplicado };
}

async function registrarArqueoSB(env, params) {
  const { fecha, hora } = arNow();
  const rH    = sbReadH(env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY);
  const saldo = await calcSaldoSB(rH);
  if (!saldo) throw new Error("No se pudo calcular el saldo desde Supabase");

  const efFis = Number(params.efectivoFisico);
  const sist  = saldo.efectivo;
  const dif   = efFis - sist;
  const res   = dif === 0 ? "OK" : dif > 0 ? "Sobrante" : "Faltante";
  const horaCierre = `${fecha}T${hora}`;

  const { row: savedArqueo, duplicado } = await sbInsertIdempotente(env, "arqueos_caja", {
    id: genId(), fecha, usuario: params.usuario || "Laura",
    efectivo_fisico: efFis, efectivo_sistema: sist, diferencia: dif,
    resultado: res, hora_cierre: horaCierre, monitor: params.monitorData || null,
    client_op_id: params.opId || null,
  });

  if (!duplicado && dif !== 0) {
    await sbInsertWithRetry(env, "movimientos_caja", {
      id: genId(), fecha, hora,
      tipo: dif > 0 ? "Ingreso" : "Egreso", forma_pago: "Efectivo",
      importe: Math.abs(dif), categoria: "Ajuste Post-Arqueo",
      usuario: params.usuario || "Laura", observacion: `Ajuste auto arqueo ${savedArqueo.id}`,
      client_op_id: params.opId ? params.opId + ":ajuste" : null,
    });
  }

  return { ok: true, diferencia: dif, efectivoFisico: efFis, efectivoSistema: sist, resultado: res, horaCierre, id: savedArqueo.id, duplicado };
}

async function yaFueRendidaSB(env, fechaReparto, turno, repartidor) {
  const rH = sbReadH(env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY);
  const q  = `${SB_URL}/rendiciones_caja?fecha=eq.${fechaReparto}&turno=eq.${encodeURIComponent(turno)}&repartidor=eq.${encodeURIComponent(repartidor)}&limit=1`;
  const r  = await fetch(q, { headers: rH });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function registrarRendicionSB(env, params) {
  const { fecha, hora } = arNow();
  const fechaReparto = params.fechaStr?.split("T")[0] || fecha;

  if (await yaFueRendidaSB(env, fechaReparto, params.turno, params.repartidor)) {
    return { ok: true, mensaje: "Planilla ya estaba registrada.", duplicado: true };
  }

  const contado  = Number(params.efectivoContado  || 0);
  const esperado = Number(params.efectivoEsperado || 0);
  const transf   = Number(params.transferencia    || 0);
  const cheque   = Number(params.cheque           || 0);
  const dif      = contado - esperado;
  const tipoDif  = dif === 0 ? "Exacto" : dif > 0 ? "Sobrante" : "Faltante";

  const { row: savedRend, duplicado } = await sbInsertIdempotente(env, "rendiciones_caja", {
    id: genId(), fecha: fechaReparto, turno: params.turno,
    repartidor: params.repartidor, efectivo_esperado: esperado,
    efectivo_contado: contado, diferencia: dif, tipo_diferencia: tipoDif,
    usuario: params.usuario || "Laura", hora_rendicion: `${fecha}T${hora}`, notas: {},
    client_op_id: params.opId || null,
  });

  if (!duplicado) {
    const tasks = [];
    if (esperado > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
      id: genId(), fecha, hora, tipo: "Ingreso", forma_pago: "Efectivo",
      importe: esperado, categoria: "Rendición Reparto - BASE",
      repartidor: params.repartidor || null, turno: params.turno || null,
      usuario: "Sistema",
      observacion: `Base Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
    }));
    if (transf > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
      id: genId(), fecha, hora, tipo: "Ingreso", forma_pago: "Transferencia",
      importe: transf, categoria: "Rendición Reparto - TRANSFERENCIA",
      repartidor: params.repartidor || null, turno: params.turno || null,
      usuario: "Sistema",
      observacion: `Transferencia Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
    }));
    if (cheque > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
      id: genId(), fecha, hora, tipo: "Ingreso", forma_pago: "Cheque",
      importe: cheque, categoria: "Rendición Reparto - CHEQUE",
      repartidor: params.repartidor || null, turno: params.turno || null,
      usuario: "Sistema",
      observacion: `Cheque Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
    }));
    if (dif !== 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
      id: genId(), fecha, hora,
      tipo: dif > 0 ? "Ingreso" : "Egreso", forma_pago: "Efectivo",
      importe: Math.abs(dif), categoria: "Diferencia Rendición - Ajuste",
      usuario: "Sistema",
      observacion: `Ajuste automático ${dif > 0 ? "Sobrante" : "Faltante"} ${params.repartidor}`,
    }));
    await Promise.all(tasks);
  }

  return { ok: true, diferencia: dif, id: savedRend.id, duplicado };
}

/**
 * Espeja la escritura a la planilla EN SEGUNDO PLANO (después de responder
 * al cliente — se invoca vía ctx.waitUntil, que mantiene el worker vivo
 * hasta que termine sin bloquear la respuesta). Si esto falla, la
 * reconciliación inversa (Supabase → GAS) lo detecta y repara solo.
 *
 * Para movimientos y rendiciones se reusa la función GAS existente tal
 * cual (no recalculan nada propio — solo escriben lo que reciben, así que
 * no hay riesgo de que GAS "decida" un valor distinto al ya guardado).
 * El arqueo es la excepción: registrarArqueo() de GAS SÍ recalcula su
 * propio saldo internamente, lo que podría no coincidir con el saldo que
 * ya quedó grabado como oficial en Supabase — por eso usa mirrorArqueo(),
 * una función nueva en GAS que solo graba los valores YA decididos.
 */
async function mirrorToGAS(fn, params, sbResult) {
  if (sbResult.duplicado) return; // ya se procesó antes — no volver a espejar
  if (fn === "registrarMovimientoCaja" || fn === "procesarRendicionDesdeRecibo") {
    await fetch(GAS_URL, { method: "POST", body: JSON.stringify({ fn, params }) });
  } else if (fn === "registrarArqueo") {
    await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        fn: "mirrorArqueo",
        params: {
          fecha: arNow().fecha,
          usuario: params.usuario || "Laura",
          efectivoFisico: sbResult.efectivoFisico,
          efectivoSistema: sbResult.efectivoSistema,
          diferencia: sbResult.diferencia,
          resultado: sbResult.resultado,
          horaCierre: sbResult.horaCierre,
          monitorData: params.monitorData,
        },
      }),
    });
  }
}

// ════════════════════════════════════════════════════════════════
// DOBLE ESCRITURA: después de que GAS responde OK, escribir en SB
// (legacy — sigue usándose para editar/eliminar movimientos, que
//  todavía van GAS-primero por menor volumen y mayor complejidad
//  de "encontrar la fila correcta" para espejar)
// ════════════════════════════════════════════════════════════════

async function syncEditMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    const patch = {};
    if (params.tipo        != null)      patch.tipo        = params.tipo;
    if (params.formaPago   != null)      patch.forma_pago  = params.formaPago;
    if (params.importe     != null)      patch.importe     = Number(params.importe);
    if (params.categoria   != null)      patch.categoria   = params.categoria;
    if (params.observacion != null)      patch.observacion = params.observacion;
    if (params.vehiculo    !== undefined) patch.vehiculo   = params.vehiculo || null;
    if (!Object.keys(patch).length) return;
    const r = await fetch(`${SB_URL}/movimientos_caja?id=eq.${params.id}`, {
      method:  "PATCH",
      headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
      body:    JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`PATCH HTTP ${r.status}`);
  } catch (e) {
    console.error("[syncEditMovimiento]", e.message);
  }
}

async function syncDeleteMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    const r = await fetch(`${SB_URL}/movimientos_caja?id=eq.${params.id}`, {
      method:  "DELETE",
      headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
    });
    if (!r.ok) throw new Error(`DELETE HTTP ${r.status}`);
  } catch (e) {
    console.error("[syncDeleteMovimiento]", e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// SUPABASE READ ENDPOINTS  (/sb/*)
// ════════════════════════════════════════════════════════════════
async function handleSb(request, env, url, cors) {
  const key = env.SUPABASE_ANON_KEY;
  if (!key) return json({ error: "SUPABASE_ANON_KEY no configurado" }, 500, cors);

  const rH  = sbReadH(key);
  const seg  = url.pathname.replace(/^\/sb\//, "");
  const p    = url.searchParams;

  // ── Saldo (balance acumulado por forma de pago) ──────────────
  if (seg === "saldo") {
    const s = await calcSaldoSB(rH);
    if (!s) return json({ error: "Error Supabase" }, 502, cors);
    return json({ ok: true, ...s }, 200, cors);
  }

  // ── Reconciliar: repara Supabase usando GAS como fuente de verdad ──
  // POST /sb/reconciliar?days=N  (default 3, máx 31)
  if (seg === "reconciliar") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const days = Math.min(31, Math.max(1, parseInt(p.get("days") || "3", 10)));
    const rep  = await reconciliarMovimientos(env, days);
    return json(rep, rep.ok ? 200 : 502, cors);
  }

  // ── Consistencia: compara saldo GAS (sheet) vs Supabase ─────
  // GET /sb/consistencia → { ok, efectivoSupabase, efectivoGAS, delta }
  if (seg === "consistencia") {
    const [sbS, gasS] = await Promise.all([
      calcSaldoSB(rH),
      fetch(GAS_URL, { method: "POST", body: JSON.stringify({ fn: "getEstadoCaja", params: {} }) })
        .then(r => r.json()).catch(() => null),
    ]);
    if (!sbS || typeof gasS?.efectivo !== "number")
      return json({ ok: false, error: "No se pudo leer alguna de las dos fuentes" }, 502, cors);
    return json({
      ok: true,
      efectivoSupabase: sbS.efectivo,
      efectivoGAS: gasS.efectivo,
      delta: sbS.efectivo - gasS.efectivo,
      chequesSupabase: sbS.cheques,
      chequesGAS: Number(gasS.cheques || 0),
      deltaCheques: sbS.cheques - Number(gasS.cheques || 0),
    }, 200, cors);
  }

  // ── Movimientos (por fecha o rango) ──────────────────────────
  if (seg === "movimientos") {
    let q = `${SB_URL}/movimientos_caja?deleted_at=is.null&order=fecha.desc,hora.desc,id.desc&limit=9999`;
    if (p.get("fecha"))                   q += `&fecha=eq.${p.get("fecha")}`;
    else if (p.get("from") && p.get("to")) q += `&fecha=gte.${p.get("from")}&fecha=lte.${p.get("to")}`;
    const r    = await fetch(q, { headers: rH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
  }

  // ── Adelantos en cuotas activos de un empleado ────────────────
  // GET /sb/adelantos-cuotas?empleado=Nombre
  // Un adelanto grande se puede registrar en cuotas semanales (ver laura.html:
  // confirmarAdelantoCuotas). El plan queda tageado en la observación del
  // adelanto original como [PLAN:xxx total=N cuota=M cuotas=K], y cada semana
  // que se descuenta el sueldo de esa semana queda tageado con
  // [PLAN:xxx pagada monto=N] (N puede ser distinto a la cuota sugerida —
  // editable en el modal). Acá se cruzan ambos tags para saber cuánto falta.
  if (seg === "adelantos-cuotas") {
    const empleado = (p.get("empleado") || "").trim();
    if (!empleado) return json({ error: "empleado requerido" }, 400, cors);

    const qPlanes = `${SB_URL}/movimientos_caja?deleted_at=is.null&categoria=eq.${encodeURIComponent("Adelanto de Sueldo")}&observacion=ilike.${encodeURIComponent("*[PLAN:*")}&select=id,fecha,observacion&order=fecha.asc`;
    const qPagos  = `${SB_URL}/movimientos_caja?deleted_at=is.null&categoria=eq.${encodeURIComponent("Pago de Haberes")}&observacion=ilike.${encodeURIComponent("*pagada monto=*")}&select=observacion`;

    const [rPlanes, rPagos] = await Promise.all([
      fetch(qPlanes, { headers: rH }), fetch(qPagos, { headers: rH }),
    ]);
    const planesRaw = await rPlanes.json().catch(() => []);
    const pagosRaw  = await rPagos.json().catch(() => []);

    // Suma de lo efectivamente descontado por plan — NO cuenta de "cuotas" fijas,
    // porque Pablo puede descontar más o menos que la cuota sugerida cada semana
    // (típico con vendedores de comisión variable: si la semana vino bien, paga
    // de más para saldar el adelanto antes).
    const pagadoPorPlan = {};
    for (const row of (Array.isArray(pagosRaw) ? pagosRaw : [])) {
      for (const m of (row.observacion || "").matchAll(/\[PLAN:(\S+) pagada monto=(\d+)\]/g)) {
        pagadoPorPlan[m[1]] = (pagadoPorPlan[m[1]] || 0) + Number(m[2]);
      }
    }

    const empLower = empleado.toLowerCase();
    const planes = [];
    for (const row of (Array.isArray(planesRaw) ? planesRaw : [])) {
      const obs = row.observacion || "";
      const nombreMatch = obs.match(/^\[([^\]]+)\]/);
      if (!nombreMatch || nombreMatch[1].trim().toLowerCase() !== empLower) continue;
      const planMatch = obs.match(/\[PLAN:(\S+) total=(\d+) cuota=(\d+) cuotas=(\d+)\]/);
      if (!planMatch) continue;
      const [, planId, totalStr, cuotaStr, cuotasStr] = planMatch;
      const total = Number(totalStr), cuotaMonto = Number(cuotaStr), totalCuotas = Number(cuotasStr);
      const totalPagado = pagadoPorPlan[planId] || 0;
      const restante = total - totalPagado;
      if (restante <= 0) continue; // plan saldado
      const montoSugerido = Math.max(0, Math.min(cuotaMonto, restante));
      planes.push({ planId, fecha: row.fecha, total, cuotaMonto, totalCuotas, totalPagado, restante, montoSugerido });
    }
    return json({ ok: true, planes }, 200, cors);
  }

  // ── Arqueos ──────────────────────────────────────────────────
  if (seg === "arqueos") {
    const hasFecha = !!p.get("fecha");
    const hasRange = !!(p.get("from") && p.get("to"));
    let q = `${SB_URL}/arqueos_caja?order=fecha.asc`;
    if (hasFecha)       q += `&fecha=eq.${p.get("fecha")}&limit=1`;
    else if (hasRange)  q += `&fecha=gte.${p.get("from")}&fecha=lte.${p.get("to")}`;
    else                q += `&limit=1`;
    const r    = await fetch(q, { headers: rH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    if (hasRange) return json({ ok: true, data }, 200, cors);
    return json({ ok: true, data: data[0] || null }, 200, cors);
  }

  // ── Cheques en cartera (leído de Supabase, ya no de GAS) ─────
  // Ingresos por cheque que todavía no fueron entregados/cobrados/depositados.
  if (seg === "cheques-cartera") {
    const r = await fetch(
      `${SB_URL}/movimientos_caja?deleted_at=is.null&tipo=eq.Ingreso&forma_pago=eq.Cheque` +
      `&select=id,fecha,banco,nro_cheque,importe,estado&order=fecha.asc`,
      { headers: rH }
    );
    const data = await r.json().catch(() => null);
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    const cartera = data
      .filter(m => {
        const st = (m.estado || "").toUpperCase();
        return !st.startsWith("ENTREGADO") && st !== "COBRADO" && st !== "DEPOSITADO";
      })
      .map(m => ({
        id: m.id, banco: m.banco, nro: m.nro_cheque, importe: m.importe,
        fecha: m.fecha ? m.fecha.split("-").reverse().join("/") : "",
      }));
    return json({ ok: true, data: cartera }, 200, cors);
  }

  // ── Rendiciones ──────────────────────────────────────────────
  if (seg === "rendiciones") {
    const limit = parseInt(p.get("limit") || "40", 10);
    const r     = await fetch(`${SB_URL}/rendiciones_caja?order=id.desc&limit=${limit}`, { headers: rH });
    const data  = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
  }

  // POST /sb/delete-rendicion  body: { id: 123 }  — borra solo el registro
  // de rendiciones_caja. Los movimientos asociados (BASE, ajuste, etc.) se
  // borran aparte con /sb/delete-mov.
  if (seg === "delete-rendicion") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    if (!body.id) return json({ error: "id requerido" }, 400, cors);
    const r = await fetch(`${SB_URL}/rendiciones_caja?id=eq.${body.id}`, {
      method:  "DELETE",
      headers: sbWriteH(svcKey),
    });
    if (!r.ok) return json({ error: `HTTP ${r.status}` }, 502, cors);
    return json({ ok: true, deleted: body.id }, 200, cors);
  }

  // ── Audit: totales y gaps entre rendiciones y movimientos ───
  // GET /sb/audit?from=YYYY-MM-DD&to=YYYY-MM-DD
  if (seg === "audit") {
    const from = p.get("from") || arNow().fecha;
    const to   = p.get("to")   || arNow().fecha;

    // Movimientos en el período
    const rMovs = await fetch(
      `${SB_URL}/movimientos_caja?deleted_at=is.null&fecha=gte.${from}&fecha=lte.${to}&select=tipo,forma_pago,importe,categoria`,
      { headers: rH }
    );
    const movs = await rMovs.json();

    // Rendiciones en el período
    const rRends = await fetch(
      `${SB_URL}/rendiciones_caja?fecha=gte.${from}&fecha=lte.${to}&select=id,fecha,repartidor,turno,efectivo_esperado`,
      { headers: rH }
    );
    const rends = await rRends.json();

    // Movimientos BASE que existen
    const rBase = await fetch(
      `${SB_URL}/movimientos_caja?deleted_at=is.null&categoria=eq.Rendici%C3%B3n%20Reparto%20-%20BASE&fecha=gte.${from}&fecha=lte.${to}&select=observacion,importe`,
      { headers: rH }
    );
    const baseMovs = await rBase.json();
    const baseObs  = new Set(Array.isArray(baseMovs) ? baseMovs.map(m => m.observacion) : []);

    // Calcular totales
    let efectivoIn = 0, efectivoOut = 0;
    if (Array.isArray(movs)) {
      for (const m of movs) {
        const v  = Number(m.importe || 0);
        const fp = (m.forma_pago || "").toLowerCase();
        if (fp === "efectivo") {
          if (m.tipo === "Ingreso") efectivoIn  += v;
          else                      efectivoOut += v;
        }
      }
    }

    // Rendiciones sin movimiento BASE correspondiente
    const rendsSinMovimiento = Array.isArray(rends) ? rends.filter(r => {
      const obs = `Base Rendición ${r.repartidor} (${r.turno}) — reparto ${r.fecha}`;
      return !baseObs.has(obs);
    }) : [];

    return json({
      ok: true, from, to,
      movimientos: Array.isArray(movs) ? movs.length : 0,
      rendiciones: Array.isArray(rends) ? rends.length : 0,
      efectivo_ingresos: efectivoIn,
      efectivo_egresos:  efectivoOut,
      saldo_efectivo_periodo: efectivoIn - efectivoOut,
      rendiciones_sin_movimiento: rendsSinMovimiento.length,
      gaps: rendsSinMovimiento.map(r => ({
        id: r.id, fecha: r.fecha, repartidor: r.repartidor,
        turno: r.turno, importe: r.efectivo_esperado,
      })),
    }, 200, cors);
  }

  // ── Sincronizar rendiciones → movimientos (reparar gaps) ────
  // POST /sb/sincronizar-rendiciones?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Lee rendiciones_caja (por fecha de reparto) y crea movimientos faltantes.
  // Los movimientos se fechan con la fecha de procesamiento (hora_rendicion).
  if (seg === "sincronizar-rendiciones") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const wH  = sbWriteH(svcKey);

    const from = p.get("from") || arNow().fecha;
    const to   = p.get("to")   || arNow().fecha;

    // 1. Leer rendiciones del período (por fecha de reparto)
    const rR = await fetch(
      `${SB_URL}/rendiciones_caja?fecha=gte.${from}&fecha=lte.${to}&order=fecha.asc,id.asc`,
      { headers: rH }
    );
    const rendiciones = await rR.json();
    if (!Array.isArray(rendiciones))
      return json({ error: "Error leyendo rendiciones_caja", detail: rendiciones }, 502, cors);

    // 2. Leer movimientos BASE en ventana amplia (fecha_reparto hasta fecha_reparto+2)
    //    porque los movimientos se guardan con fecha de procesamiento (puede ser +1 día)
    const toPlus2 = new Date(to);
    toPlus2.setDate(toPlus2.getDate() + 2);
    const toPlus2Str = toPlus2.toISOString().split('T')[0];
    const mR = await fetch(
      `${SB_URL}/movimientos_caja?fecha=gte.${from}&fecha=lte.${toPlus2Str}&categoria=eq.Rendici%C3%B3n%20Reparto%20-%20BASE&deleted_at=is.null`,
      { headers: rH }
    );
    const existMovs = await mR.json();
    if (!Array.isArray(existMovs))
      return json({ error: "Error leyendo movimientos_caja", detail: existMovs }, 502, cors);

    // Dedup por observacion (contiene el repartidor, turno y fecha de reparto)
    const existObs = new Set(existMovs.map(m => m.observacion || ""));

    const { hora } = arNow();
    const results  = [];

    for (const rend of rendiciones) {
      // Fecha del movimiento: fecha de procesamiento (hora_rendicion) o hoy
      const procDate = rend.hora_rendicion ? rend.hora_rendicion.split('T')[0] : arNow().fecha;
      const obsBase  = `Base Rendición ${rend.repartidor} (${rend.turno}) — reparto ${rend.fecha}`;

      if (existObs.has(obsBase)) {
        results.push({ rendicion_id: rend.id, status: "skip — ya existe" });
        continue;
      }

      const esperado = Number(rend.efectivo_esperado || 0);
      const contado  = Number(rend.efectivo_contado  || 0);
      const dif      = contado - esperado;
      const errors   = [];

      // Movimiento BASE efectivo
      if (esperado > 0) {
        const r1 = await fetch(`${SB_URL}/movimientos_caja`, {
          method: "POST",
          headers: wH,
          body: JSON.stringify({
            id:          genId(),
            fecha:       procDate,
            hora:        hora,
            tipo:        "Ingreso",
            forma_pago:  "Efectivo",
            importe:     esperado,
            categoria:   "Rendición Reparto - BASE",
            repartidor:  rend.repartidor || null,
            turno:       rend.turno      || null,
            usuario:     "Sistema",
            observacion: obsBase,
          }),
        });
        if (!r1.ok) errors.push(`BASE HTTP ${r1.status}: ${await r1.text().catch(()=>"")}`);
      }

      // Ajuste de diferencia
      if (dif !== 0) {
        const r2 = await fetch(`${SB_URL}/movimientos_caja`, {
          method: "POST",
          headers: wH,
          body: JSON.stringify({
            id:          genId(),
            fecha:       procDate,
            hora:        hora,
            tipo:        dif > 0 ? "Ingreso" : "Egreso",
            forma_pago:  "Efectivo",
            importe:     Math.abs(dif),
            categoria:   "Diferencia Rendición - Ajuste",
            usuario:     "Sistema",
            observacion: `Ajuste automático ${dif > 0 ? "Sobrante" : "Faltante"} ${rend.repartidor}`,
          }),
        });
        if (!r2.ok) errors.push(`AJUSTE HTTP ${r2.status}`);
      }

      existObs.add(obsBase);
      results.push({ rendicion_id: rend.id, procDate, status: errors.length ? `error: ${errors.join(", ")}` : "created" });
    }

    return json({ ok: true, from, to, processed: rendiciones.length, results }, 200, cors);
  }

  // ── Patch campos de movimientos (admin) ──────────────────────
  // POST /sb/patch-mov  body: { ids: [2077, 2078], observacion: "...", fecha: "..." }
  // Parchea cualquier campo permitido en los ids indicados.
  if (seg === "patch-mov" || seg === "patch-mov-fecha") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    const { ids, ...fields } = body;
    if (!Array.isArray(ids) || !Object.keys(fields).length) return json({ error: "ids[] y al menos un campo requeridos" }, 400, cors);
    const ALLOWED = new Set(["fecha","hora","tipo","forma_pago","importe","categoria","observacion","repartidor","turno","usuario","banco","nro_cheque","estado"]);
    const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => ALLOWED.has(k)));
    if (!Object.keys(patch).length) return json({ error: "Ningún campo válido para parchear" }, 400, cors);
    const results = [];
    for (const id of ids) {
      const r = await fetch(`${SB_URL}/movimientos_caja?id=eq.${id}`, {
        method:  "PATCH",
        headers: sbWriteH(svcKey),
        body:    JSON.stringify(patch),
      });
      results.push({ id, status: r.ok ? "ok" : `HTTP ${r.status}` });
    }
    return json({ ok: true, patch, results }, 200, cors);
  }

  // POST /sb/insert-mov  body: { movimiento fields }
  if (seg === "insert-mov") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    const mov = { id: genId(), ...body };
    await sbInsert(env, "movimientos_caja", mov);
    return json({ ok: true, id: mov.id }, 200, cors);
  }

  // POST /sb/delete-mov  body: { id: 123 }
  // Borra en Supabase Y en GAS Sheet via eliminarMovimientoPorCampos (1 llamada).
  if (seg === "delete-mov") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    if (!body.id) return json({ error: "id requerido" }, 400, cors);

    let gasDeleted = false;
    let gasMatches = -1; // -1 = error/desconocido, 0 = no estaba en GAS, 1 = encontrado
    try {
      const movR = await fetch(
        `${SB_URL}/movimientos_caja?id=eq.${body.id}&limit=1`,
        { headers: sbReadH(svcKey) }
      );
      const [mov] = await movR.json().catch(() => [null]) || [null];

      if (mov?.fecha && mov?.importe != null && mov?.categoria) {
        const delR = await fetch(GAS_URL, {
          method: "POST",
          body: JSON.stringify({
            fn: "eliminarMovimientoPorCampos",
            params: {
              fecha:     mov.fecha,
              hora:      (mov.hora || "").substring(0, 5),
              importe:   Number(mov.importe),
              categoria: mov.categoria,
            },
          }),
        });
        const delData = await delR.json().catch(() => null);
        if (delData?.ok === true) {
          gasDeleted = true;
          gasMatches = 1;
        } else if (delData?.error === "No encontrado") {
          gasMatches = 0;
        }
      }
    } catch (e) {
      console.error("[delete-mov] GAS delete failed:", e.message);
    }

    const r = await fetch(`${SB_URL}/movimientos_caja?id=eq.${body.id}`, {
      method:  "DELETE",
      headers: sbWriteH(svcKey),
    });
    if (!r.ok) return json({ error: `Supabase HTTP ${r.status}` }, 502, cors);
    return json({ ok: true, deleted: body.id, gasDeleted, gasMatches }, 200, cors);
  }

  // POST /sb/delete-arqueo  body: { id: 123 }
  if (seg === "delete-arqueo") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    if (!body.id) return json({ error: "id requerido" }, 400, cors);
    const r = await fetch(`${SB_URL}/arqueos_caja?id=eq.${body.id}`, {
      method:  "DELETE",
      headers: sbWriteH(svcKey),
    });
    if (!r.ok) return json({ error: `HTTP ${r.status}` }, 502, cors);
    return json({ ok: true, deleted: body.id }, 200, cors);
  }

  // GET /sb/vtv-alerts  → lista de vehículos con VTV a menos de 15 días del aniversario
  if (seg === "vtv-alerts") {
    if (request.method !== "GET") return json({ error: "Usar GET" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);

    const r = await fetch(
      `${SB_URL}/movimientos_caja?categoria=eq.VTV&select=vehiculo,fecha&order=fecha.desc`,
      { headers: sbReadH(svcKey) }
    );
    const rows = await r.json().catch(() => []);

    // Más reciente por vehículo
    const latest = {};
    for (const row of rows) {
      if (row.vehiculo && !latest[row.vehiculo]) latest[row.vehiculo] = row.fecha;
    }

    const today = new Date();
    const alertas = [];
    for (const [vehiculo, fechaVTV] of Object.entries(latest)) {
      const anniversary = new Date(fechaVTV);
      anniversary.setFullYear(anniversary.getFullYear() + 1);
      const diffDays = Math.ceil((anniversary - today) / 86400000);
      if (diffDays <= 15) {
        alertas.push({ vehiculo, fechaVTV, diasRestantes: diffDays, vencimiento: anniversary.toISOString().substring(0, 10) });
      }
    }
    return json({ alertas }, 200, cors);
  }

  // POST /sb/vtv-email  body: { vehiculo, diasRestantes, vencimiento, fechaVTV }
  if (seg === "vtv-email") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const body = await request.json().catch(() => ({}));
    if (!body.vehiculo) return json({ error: "vehiculo requerido" }, 400, cors);
    try {
      const r = await fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({ fn: "enviarEmailVTV", params: body }),
      });
      const data = await r.json().catch(() => null);
      return json({ ok: true, gas: data }, 200, cors);
    } catch(e) {
      return json({ ok: false, error: e.message }, 500, cors);
    }
  }

  return json({ error: `Ruta /sb/${seg} no encontrada` }, 404, cors);
}

// ════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════
export default {
  // Cron diario (06:00 UTC = 03:00 AR): repara Supabase contra la planilla
  // sin intervención de nadie. Cinturón de seguridad además de la reparación
  // inmediata que dispara la app cuando detecta una falla de copia.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      reconciliarMovimientos(env, 2)
        .then(r => {
          console.log("[cron reconciliar]", JSON.stringify(r));
          if (r.ok && r.espejados?.length > 0) return alertarSyncAtrasado(r.espejados);
        })
        .catch(e => console.error("[cron reconciliar] error:", e.message))
    );
  },

  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors   = corsH(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    const url = new URL(request.url);

    // ── Supabase read/sync endpoints
    if (url.pathname.startsWith("/sb/")) return handleSb(request, env, url, cors);

    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "JSON inválido" }, 400, cors); }

    const fn     = body.fn     || "";
    const params = body.params || {};

    // ── SUPABASE PRIMERO: alto volumen / camino crítico de Laura.
    // Responde apenas Supabase confirma (rápido y confiable) — la planilla
    // se actualiza en segundo plano sin que nadie espere por ella.
    const SB_FIRST = new Set(["registrarMovimientoCaja", "registrarArqueo", "procesarRendicionDesdeRecibo"]);
    if (SB_FIRST.has(fn)) {
      let result;
      try {
        if      (fn === "registrarMovimientoCaja")      result = await registrarMovimientoSB(env, params);
        else if (fn === "registrarArqueo")              result = await registrarArqueoSB(env, params);
        else /* procesarRendicionDesdeRecibo */         result = await registrarRendicionSB(env, params);
      } catch (e) {
        return json({ ok: false, error: "Error guardando: " + e.message }, 500, cors);
      }

      ctx.waitUntil(
        mirrorToGAS(fn, params, result).catch(e =>
          console.error(`[mirrorToGAS:${fn}] falló — la reconciliación inversa lo va a reparar:`, e.message)
        )
      );

      return json(result, 200, cors);
    }

    // ── Resto de operaciones (lecturas, editar/eliminar): GAS primero, como antes.
    let gasRes = null;
    try {
      const r = await fetch(GAS_URL, { method: "POST", body: JSON.stringify(body) });
      const t = await r.text();
      try { gasRes = JSON.parse(t); } catch { gasRes = t; }
    } catch (err) {
      return json({ error: err.toString() }, 500, cors);
    }

    if      (fn === "editarMovimientoCaja")   await syncEditMovimiento(env, params, gasRes);
    else if (fn === "eliminarMovimientoCaja") await syncDeleteMovimiento(env, params, gasRes);

    const response = typeof gasRes === "string" ? gasRes : JSON.stringify(gasRes);
    return new Response(response, { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  }
};
