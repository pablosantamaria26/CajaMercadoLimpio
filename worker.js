/**
 * CAJA MERCADO LIMPIO — CLOUDFLARE WORKER
 * - POST /          → proxy al Google Apps Script (GAS)
 * - GET  /sb/*      → lectura directa de Supabase (rápida)
 *
 * Secret requerido: SUPABASE_ANON_KEY (Cloudflare dashboard → Settings → Variables)
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbyWwaLm9lI07YykVzFOIuXnqALteUxzGqWwoSl8ThAmeYvMoSRWve_JKmOMOyG92O_yWg/exec";
const SB_URL  = "https://gjeyvbidomxzofcdycya.supabase.co/rest/v1";

const ALLOWED_ORIGINS = [
  "https://pablosantamaria26.github.io",
  "https://pablosantamaria26.github.io/CajaMercadoLimpio",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "*",
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors   = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Supabase read endpoints (/sb/*)
    if (path.startsWith("/sb/")) {
      return handleSupabase(request, env, url, cors);
    }

    // ── GAS proxy (POST /)
    if (request.method !== "POST") {
      return json({ error: "Método no permitido, usar POST" }, 405, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "JSON inválido" }, 400, cors); }

    try {
      const res  = await fetch(GAS_URL, { method: "POST", body: JSON.stringify(body) });
      const text = await res.text();
      try   { return new Response(JSON.stringify(JSON.parse(text)), { status: 200, headers: cors }); }
      catch { return new Response(text, { status: 200 }); }
    } catch (err) {
      return json({ error: err.toString() }, 500, cors);
    }
  }
};

// ════════════════════════════════════════════════════════════════
// SUPABASE HANDLER
// Endpoints:
//   GET /sb/saldo                               → efectivo, cheques, banco actuales
//   GET /sb/movimientos?fecha=YYYY-MM-DD        → movimientos de un día
//   GET /sb/movimientos?from=YYYY-MM-DD&to=...  → movimientos de un rango
//   GET /sb/arqueos?fecha=YYYY-MM-DD            → arqueo del día (último del día)
//   GET /sb/rendiciones?limit=N                 → últimas N rendiciones (def: 40)
// ════════════════════════════════════════════════════════════════
async function handleSupabase(request, env, url, cors) {
  const key = env.SUPABASE_ANON_KEY;
  if (!key) return json({ error: "SUPABASE_ANON_KEY no configurado en el Worker" }, 500, cors);

  const sbH = {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };

  const seg    = url.pathname.replace(/^\/sb\//, "");
  const params = url.searchParams;

  // ── /sb/saldo ─────────────────────────────────────────────────
  // Suma todos los movimientos no eliminados para obtener saldo actual
  if (seg === "saldo") {
    const r    = await fetch(`${SB_URL}/movimientos_caja?select=tipo,forma_pago,importe&deleted_at=is.null`, { headers: sbH });
    const movs = await r.json();
    if (!Array.isArray(movs)) return json({ error: "Error Supabase", detail: movs }, 502, cors);

    const s = { efectivo: 0, cheques: 0, banco: 0 };
    for (const m of movs) {
      const v    = Number(m.importe || 0);
      const sign = m.tipo === "Ingreso" ? 1 : -1;
      const fp   = (m.forma_pago || "").toLowerCase();
      if (fp === "efectivo")                      s.efectivo += sign * v;
      else if (fp === "cheque")                   s.cheques  += sign * v;
      else if (fp === "banco" || fp === "transferencia") s.banco += sign * v;
    }
    return json({ ok: true, efectivo: s.efectivo, cheques: s.cheques, banco: s.banco }, 200, cors);
  }

  // ── /sb/movimientos ───────────────────────────────────────────
  if (seg === "movimientos") {
    let q = `${SB_URL}/movimientos_caja?deleted_at=is.null&order=fecha.asc,hora.asc`;
    const fecha = params.get("fecha");
    const from  = params.get("from");
    const to    = params.get("to");
    if (fecha)       q += `&fecha=eq.${fecha}`;
    else if (from && to) q += `&fecha=gte.${from}&fecha=lte.${to}`;

    const r    = await fetch(q, { headers: sbH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
  }

  // ── /sb/arqueos ───────────────────────────────────────────────
  if (seg === "arqueos") {
    const fecha = params.get("fecha");
    let q = `${SB_URL}/arqueos_caja?order=id.desc&limit=1`;
    if (fecha) q += `&fecha=eq.${fecha}`;

    const r    = await fetch(q, { headers: sbH });
    const data = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data: data[0] || null }, 200, cors);
  }

  // ── /sb/rendiciones ───────────────────────────────────────────
  if (seg === "rendiciones") {
    const limit = parseInt(params.get("limit") || "40", 10);
    const r     = await fetch(`${SB_URL}/rendiciones_caja?order=id.desc&limit=${limit}`, { headers: sbH });
    const data  = await r.json();
    if (!Array.isArray(data)) return json({ error: "Error Supabase", detail: data }, 502, cors);
    return json({ ok: true, data }, 200, cors);
  }

  return json({ error: `Ruta /sb/${seg} no encontrada` }, 404, cors);
}
