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
async function sbInsertWithRetry(env, table, data, maxRetries = 2) {
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

// ════════════════════════════════════════════════════════════════
// DOBLE ESCRITURA: después de que GAS responde OK, escribir en SB
// ════════════════════════════════════════════════════════════════

async function syncMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
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
  try {
    await sbInsertWithRetry(env, "movimientos_caja", {
      id:          genId(),
      fecha:       params.fechaStr?.split("T")[0] || fecha,
      hora:        hora,
      tipo:        params.tipo,
      forma_pago:  params.formaPago,
      banco:       params.banco        || null,
      nro_cheque:  params.nroCheque    || null,
      importe:     Number(params.importe),
      categoria:   params.categoria,
      repartidor:  params.repartidor   || null,
      turno:       params.turno        || null,
      usuario:     params.usuario      || "Laura",
      observacion: obs,
    });
  } catch (e) {
    console.error("[syncMovimiento] falló tras reintentos:", e.message);
  }
}

async function syncArqueo(env, params, gasRes) {
  if (!gasRes?.ok) return;
  const { fecha, hora } = arNow();
  const efFis = Number(params.efectivoFisico);
  const dif   = Number(gasRes.diferencia ?? 0);
  const efSis = efFis - dif;
  const res   = dif === 0 ? "OK" : dif > 0 ? "Sobrante" : "Faltante";

  const tasks = [
    sbInsertWithRetry(env, "arqueos_caja", {
      id: genId(), fecha, usuario: params.usuario || "Laura",
      efectivo_fisico: efFis, efectivo_sistema: efSis, diferencia: dif,
      resultado: res, hora_cierre: `${fecha}T${hora}`, monitor: params.monitorData || null,
    }),
  ];

  if (dif !== 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
    id: genId(), fecha, hora,
    tipo: dif > 0 ? "Ingreso" : "Egreso", forma_pago: "Efectivo",
    importe: Math.abs(dif), categoria: "Ajuste Post-Arqueo",
    usuario: params.usuario || "Laura", observacion: "Ajuste auto arqueo",
  }));

  const results = await Promise.allSettled(tasks);
  const failed  = results.filter(r => r.status === "rejected");
  if (failed.length > 0)
    console.error("[syncArqueo] falló:", failed.map(f => f.reason?.message).join(" | "));
}

async function syncRendicion(env, params, gasRes) {
  if (!gasRes?.ok) return;
  const { fecha, hora } = arNow();
  const fechaReparto = params.fechaStr?.split("T")[0] || fecha;
  const fechaMov = fecha;
  const contado  = Number(params.efectivoContado  || 0);
  const esperado = Number(params.efectivoEsperado || 0);
  const transf   = Number(params.transferencia    || 0);
  const cheque   = Number(params.cheque           || 0);
  const dif      = contado - esperado;
  const tipoDif  = dif === 0 ? "Exacto" : dif > 0 ? "Sobrante" : "Faltante";

  // Todas las escrituras son INDEPENDIENTES con retry propio.
  // Una falla no cancela las demás (Promise.allSettled).
  const tasks = [
    // 1. rendiciones_caja
    sbInsertWithRetry(env, "rendiciones_caja", {
      id: genId(), fecha: fechaReparto, turno: params.turno,
      repartidor: params.repartidor, efectivo_esperado: esperado,
      efectivo_contado: contado, diferencia: dif, tipo_diferencia: tipoDif,
      usuario: params.usuario || "Laura", hora_rendicion: `${fecha}T${hora}`, notas: {},
    }),
  ];

  // 2. Movimiento base efectivo
  if (esperado > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
    id: genId(), fecha: fechaMov, hora, tipo: "Ingreso", forma_pago: "Efectivo",
    importe: esperado, categoria: "Rendición Reparto - BASE",
    repartidor: params.repartidor || null, turno: params.turno || null,
    usuario: "Sistema",
    observacion: `Base Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
  }));

  // 3. Transferencia
  if (transf > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
    id: genId(), fecha: fechaMov, hora, tipo: "Ingreso", forma_pago: "Transferencia",
    importe: transf, categoria: "Rendición Reparto - TRANSFERENCIA",
    repartidor: params.repartidor || null, turno: params.turno || null,
    usuario: "Sistema",
    observacion: `Transferencia Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
  }));

  // 4. Cheque
  if (cheque > 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
    id: genId(), fecha: fechaMov, hora, tipo: "Ingreso", forma_pago: "Cheque",
    importe: cheque, categoria: "Rendición Reparto - CHEQUE",
    repartidor: params.repartidor || null, turno: params.turno || null,
    usuario: "Sistema",
    observacion: `Cheque Rendición ${params.repartidor} (${params.turno}) — reparto ${fechaReparto}`,
  }));

  // 5. Ajuste diferencia
  if (dif !== 0) tasks.push(sbInsertWithRetry(env, "movimientos_caja", {
    id: genId(), fecha: fechaMov, hora,
    tipo: dif > 0 ? "Ingreso" : "Egreso", forma_pago: "Efectivo",
    importe: Math.abs(dif), categoria: "Diferencia Rendición - Ajuste",
    usuario: "Sistema",
    observacion: `Ajuste automático ${dif > 0 ? "Sobrante" : "Faltante"} ${params.repartidor}`,
  }));

  const results = await Promise.allSettled(tasks);
  const failed  = results.filter(r => r.status === "rejected");
  if (failed.length > 0)
    console.error(`[syncRendicion] ${failed.length}/${tasks.length} escrituras fallaron:`,
      failed.map(f => f.reason?.message).join(" | "));
}

async function syncEditMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    const patch = {};
    if (params.tipo        != null) patch.tipo        = params.tipo;
    if (params.formaPago   != null) patch.forma_pago  = params.formaPago;
    if (params.importe     != null) patch.importe     = Number(params.importe);
    if (params.categoria   != null) patch.categoria   = params.categoria;
    if (params.observacion != null) patch.observacion = params.observacion;
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
    const allMovs = [];
    let offset = 0;
    while (true) {
      const r = await fetch(
        `${SB_URL}/movimientos_caja?select=tipo,forma_pago,importe,estado&deleted_at=is.null&limit=1000&offset=${offset}`,
        { headers: rH }
      );
      const page = await r.json();
      if (!Array.isArray(page)) return json({ error: "Error Supabase", detail: page }, 502, cors);
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
    return json({ ok: true, ...s, total: allMovs.length }, 200, cors);
  }

  // ── Movimientos (por fecha o rango) ──────────────────────────
  if (seg === "movimientos") {
    let q = `${SB_URL}/movimientos_caja?deleted_at=is.null&order=fecha.asc,hora.asc&limit=9999`;
    if (p.get("fecha"))                   q += `&fecha=eq.${p.get("fecha")}`;
    else if (p.get("from") && p.get("to")) q += `&fecha=gte.${p.get("from")}&fecha=lte.${p.get("to")}`;
    const r    = await fetch(q, { headers: rH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
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

  // ── Rendiciones ──────────────────────────────────────────────
  if (seg === "rendiciones") {
    const limit = parseInt(p.get("limit") || "40", 10);
    const r     = await fetch(`${SB_URL}/rendiciones_caja?order=id.desc&limit=${limit}`, { headers: rH });
    const data  = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
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
  if (seg === "delete-mov") {
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);
    const svcKey = env.SUPABASE_SERVICE_KEY;
    if (!svcKey) return json({ error: "Sin SUPABASE_SERVICE_KEY" }, 500, cors);
    const body = await request.json().catch(() => ({}));
    if (!body.id) return json({ error: "id requerido" }, 400, cors);
    const r = await fetch(`${SB_URL}/movimientos_caja?id=eq.${body.id}`, {
      method:  "DELETE",
      headers: sbWriteH(svcKey),
    });
    if (!r.ok) return json({ error: `HTTP ${r.status}` }, 502, cors);
    return json({ ok: true, deleted: body.id }, 200, cors);
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

  return json({ error: `Ruta /sb/${seg} no encontrada` }, 404, cors);
}

// ════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors   = corsH(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    const url = new URL(request.url);

    // ── Supabase read/sync endpoints
    if (url.pathname.startsWith("/sb/")) return handleSb(request, env, url, cors);

    // ── GAS proxy + doble escritura
    if (request.method !== "POST") return json({ error: "Usar POST" }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "JSON inválido" }, 400, cors); }

    // Llamar GAS
    let gasRes = null;
    try {
      const r = await fetch(GAS_URL, { method: "POST", body: JSON.stringify(body) });
      const t = await r.text();
      try { gasRes = JSON.parse(t); } catch { gasRes = t; }
    } catch (err) {
      return json({ error: err.toString() }, 500, cors);
    }

    // Doble escritura en Supabase — SÍNCRONA: espera antes de responder al cliente.
    // Esto garantiza que Supabase recibe los datos aunque el proceso termine inmediatamente.
    // Agrega ~100-300ms de latencia pero elimina la pérdida silenciosa de datos.
    const fn     = body.fn     || "";
    const params = body.params || {};
    if      (fn === "registrarMovimientoCaja")      await syncMovimiento(env, params, gasRes);
    else if (fn === "registrarArqueo")              await syncArqueo(env, params, gasRes);
    else if (fn === "procesarRendicionDesdeRecibo") await syncRendicion(env, params, gasRes);
    else if (fn === "editarMovimientoCaja")         await syncEditMovimiento(env, params, gasRes);
    else if (fn === "eliminarMovimientoCaja")       await syncDeleteMovimiento(env, params, gasRes);

    const response = typeof gasRes === "string" ? gasRes : JSON.stringify(gasRes);
    return new Response(response, { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  }
};
