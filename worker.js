/**
 * CAJA MERCADO LIMPIO — CLOUDFLARE WORKER
 *
 * POST /          → proxy al GAS + doble escritura a Supabase
 * GET  /sb/*      → lectura directa de Supabase (~150ms)
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

async function sbMaxId(env, table) {
  try {
    const r = await fetch(`${SB_URL}/${table}?select=id&order=id.desc&limit=1`, {
      headers: sbReadH(env.SUPABASE_ANON_KEY),
    });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? Number(rows[0].id) : 0;
  } catch { return 0; }
}

async function sbInsert(env, table, data) {
  try {
    await fetch(`${SB_URL}/${table}`, {
      method:  "POST",
      headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
      body:    JSON.stringify(data),
    });
  } catch { /* fire-and-forget, no bloquear */ }
}

// ════════════════════════════════════════════════════════════════
// DOBLE ESCRITURA: después de que GAS responde OK, escribir en SB
// ════════════════════════════════════════════════════════════════

async function syncMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    const { fecha, hora } = arNow();
    const nextId = await sbMaxId(env, "movimientos_caja") + 1;
    await sbInsert(env, "movimientos_caja", {
      id:          nextId,
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
      observacion: params.observacion  || null,
    });
  } catch { /* silencioso */ }
}

async function syncArqueo(env, params, gasRes) {
  if (!gasRes?.resultado) return;
  try {
    const { fecha, hora } = arNow();
    const nextId = await sbMaxId(env, "arqueos_caja") + 1;
    const efSis  = Number(gasRes.saldoSistema || 0);
    const efFis  = Number(params.efectivoFisico);
    const dif    = efFis - efSis;
    const res    = dif === 0 ? "OK" : dif > 0 ? "Sobrante" : "Faltante";
    await sbInsert(env, "arqueos_caja", {
      id:               nextId,
      fecha:            fecha,
      usuario:          params.usuario || "Laura",
      efectivo_fisico:  efFis,
      efectivo_sistema: efSis,
      diferencia:       dif,
      resultado:        res,
      hora_cierre:      `${fecha}T${hora}`,
      monitor:          params.monitorData || null,
    });
  } catch { /* silencioso */ }
}

async function syncRendicion(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    const { fecha, hora } = arNow();
    const nextId     = await sbMaxId(env, "rendiciones_caja") + 1;
    const contado    = Number(params.efectivoContado);
    const esperado   = Number(params.efectivoEsperado);
    const dif        = contado - esperado;
    const tipoDif    = dif === 0 ? "Exacto" : dif > 0 ? "Sobrante" : "Faltante";
    await sbInsert(env, "rendiciones_caja", {
      id:                nextId,
      fecha:             params.fechaStr?.split("T")[0] || fecha,
      turno:             params.turno,
      repartidor:        params.repartidor,
      efectivo_esperado: esperado,
      efectivo_contado:  contado,
      diferencia:        dif,
      tipo_diferencia:   tipoDif,
      usuario:           params.usuario || "Laura",
      hora_rendicion:    `${fecha}T${hora}`,
      notas:             {},
    });
  } catch { /* silencioso */ }
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
    await fetch(`${SB_URL}/movimientos_caja?id=eq.${params.id}`, {
      method:  "PATCH",
      headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
      body:    JSON.stringify(patch),
    });
  } catch { /* silencioso */ }
}

async function syncDeleteMovimiento(env, params, gasRes) {
  if (!gasRes?.ok) return;
  try {
    await fetch(`${SB_URL}/movimientos_caja?id=eq.${params.id}`, {
      method:  "DELETE",
      headers: sbWriteH(env.SUPABASE_SERVICE_KEY),
    });
  } catch { /* silencioso */ }
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

  if (seg === "saldo") {
    // Paginar de a 1000 filas (límite de Supabase free tier)
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
        // Solo cheques RECIBIDOS (ingreso) que aún no fueron entregados/cobrados
        if (m.tipo === "Ingreso" && !st.startsWith("ENTREGADO") && st !== "COBRADO" && st !== "DEPOSITADO") {
          s.cheques += v;
        }
      } else if (fp === "banco" || fp === "transferencia") {
        s.banco += m.tipo === "Ingreso" ? v : -v;
      }
    }
    return json({ ok: true, ...s, total: allMovs.length }, 200, cors);
  }

  if (seg === "movimientos") {
    let q = `${SB_URL}/movimientos_caja?deleted_at=is.null&order=fecha.asc,hora.asc&limit=9999`;
    if (p.get("fecha"))            q += `&fecha=eq.${p.get("fecha")}`;
    else if (p.get("from") && p.get("to")) q += `&fecha=gte.${p.get("from")}&fecha=lte.${p.get("to")}`;
    const r    = await fetch(q, { headers: rH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
  }

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

  if (seg === "rendiciones") {
    const limit = parseInt(p.get("limit") || "40", 10);
    const r     = await fetch(`${SB_URL}/rendiciones_caja?order=id.desc&limit=${limit}`, { headers: rH });
    const data  = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
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

    const url  = new URL(request.url);

    // ── Supabase read endpoints
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

    // Doble escritura en Supabase (background, no bloquea la respuesta)
    const fn     = body.fn     || "";
    const params = body.params || {};
    if (fn === "registrarMovimientoCaja") {
      ctx.waitUntil(syncMovimiento(env, params, gasRes));
    } else if (fn === "registrarArqueo") {
      ctx.waitUntil(syncArqueo(env, params, gasRes));
    } else if (fn === "procesarRendicionDesdeRecibo") {
      ctx.waitUntil(syncRendicion(env, params, gasRes));
    } else if (fn === "editarMovimientoCaja") {
      ctx.waitUntil(syncEditMovimiento(env, params, gasRes));
    } else if (fn === "eliminarMovimientoCaja") {
      ctx.waitUntil(syncDeleteMovimiento(env, params, gasRes));
    }

    const response = typeof gasRes === "string" ? gasRes : JSON.stringify(gasRes);
    return new Response(response, { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  }
};
