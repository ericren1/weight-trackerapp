type Phase = "Cut" | "Maintain" | "Gain";

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

interface WeightEntryRow {
  id: number;
  date: string;
  weight: number;
  phase: Phase | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SettingsRow {
  id: number;
  current_phase: Phase;
  current_phase_started_on: string;
  updated_at: string;
}

const SESSION_COOKIE = "weight_owner_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PHASES: Phase[] = ["Cut", "Maintain", "Gain"];

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return json({ error: "Not found" }, { status: 404 });
}

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && PHASES.includes(value as Phase);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function sanitizeNotes(value: unknown) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= 1000 ? trimmed : null;
}

function parseWeight(value: unknown) {
  const weight = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 1000) return null;
  return Math.round(weight * 100) / 100;
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function hmac(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function secureEqual(a: string, b: string) {
  const [aDigest, bDigest] = await Promise.all(
    [a, b].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  );
  const aBytes = new Uint8Array(aDigest);
  const bBytes = new Uint8Array(bDigest);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function createSessionToken(secret: string) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encoded = stringToBase64Url(JSON.stringify(payload));
  const signature = await hmac(encoded, secret);
  return `${encoded}.${signature}`;
}

async function isAuthenticated(request: Request, env: Env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  const expected = await hmac(encoded, env.SESSION_SECRET);
  if (!(await secureEqual(signature, expected))) return false;

  try {
    const payload = JSON.parse(base64UrlToString(encoded)) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function sessionCookie(request: Request, token: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function requireOwner(request: Request, env: Env) {
  if (!sameOrigin(request)) return false;
  return isAuthenticated(request, env);
}

async function ensureSettings(env: Env) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO settings (id, current_phase, current_phase_started_on)
     VALUES (1, 'Cut', date('now'))`
  ).run();
}

async function getSettings(env: Env) {
  await ensureSettings(env);
  return env.DB.prepare(
    `SELECT id, current_phase, current_phase_started_on, updated_at
     FROM settings WHERE id = 1`
  ).first<SettingsRow>();
}

async function getEntries(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id, date, weight, phase, notes, created_at, updated_at
     FROM weight_entries
     ORDER BY date ASC`
  ).all<WeightEntryRow>();
  return result.results ?? [];
}

function dateToUtcMs(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function rollingAverage(entries: WeightEntryRow[], index: number) {
  const end = dateToUtcMs(entries[index].date);
  const start = end - 6 * 24 * 60 * 60 * 1000;
  const weights = entries
    .filter((entry) => {
      const time = dateToUtcMs(entry.date);
      return time >= start && time <= end;
    })
    .map((entry) => entry.weight);
  if (!weights.length) return null;
  return Math.round((weights.reduce((sum, value) => sum + value, 0) / weights.length) * 100) / 100;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function apiRouter(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/data" && method === "GET") {
    const [entries, settings, authenticated] = await Promise.all([
      getEntries(env),
      getSettings(env),
      isAuthenticated(request, env),
    ]);
    return json({ entries, settings, authenticated });
  }

  if (path === "/api/session" && method === "GET") {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (path === "/api/login" && method === "POST") {
    if (!sameOrigin(request)) return unauthorized();
    const body = await readJson(request);
    if (!body || typeof body.password !== "string") return badRequest("Password is required.");
    if (!(await secureEqual(body.password, env.ADMIN_PASSWORD))) return unauthorized();

    const token = await createSessionToken(env.SESSION_SECRET);
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": sessionCookie(request, token),
        },
      }
    );
  }

  if (path === "/api/logout" && method === "POST") {
    return json(
      { ok: true },
      { headers: { "set-cookie": clearSessionCookie(request) } }
    );
  }

  if (path === "/api/settings/phase" && method === "PUT") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const body = await readJson(request);
    if (!body || !isPhase(body.phase)) return badRequest("Invalid phase.");
    const startedOn = isValidDate(body.startedOn) ? body.startedOn : null;
    if (!startedOn) return badRequest("A valid phase start date is required.");

    await ensureSettings(env);
    await env.DB.prepare(
      `UPDATE settings
       SET current_phase = ?, current_phase_started_on = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
      .bind(body.phase, startedOn)
      .run();

    return json({ settings: await getSettings(env) });
  }

  if (path === "/api/entries" && method === "POST") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const body = await readJson(request);
    if (!body || !isValidDate(body.date)) return badRequest("A valid date is required.");
    const weight = parseWeight(body.weight);
    if (weight == null) return badRequest("Enter a valid weight.");
    const notes = sanitizeNotes(body.notes);
    if (notes == null) return badRequest("Notes must be 1,000 characters or fewer.");

    const settings = await getSettings(env);
    if (!settings) return json({ error: "Settings unavailable." }, { status: 500 });

    const existing = await env.DB.prepare(
      `SELECT id, date, weight, phase, notes, created_at, updated_at
       FROM weight_entries WHERE date = ?`
    )
      .bind(body.date)
      .first<WeightEntryRow>();

    if (existing) {
      return json(
        { error: "An entry already exists for this date.", code: "ENTRY_EXISTS", existing },
        { status: 409 }
      );
    }

    await env.DB.prepare(
      `INSERT INTO weight_entries (date, weight, phase, notes)
       VALUES (?, ?, ?, ?)`
    )
      .bind(body.date, weight, settings.current_phase, notes)
      .run();

    const entry = await env.DB.prepare(
      `SELECT id, date, weight, phase, notes, created_at, updated_at
       FROM weight_entries WHERE date = ?`
    )
      .bind(body.date)
      .first<WeightEntryRow>();

    return json({ entry }, { status: 201 });
  }

  const entryMatch = path.match(/^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/);
  if (entryMatch && method === "PUT") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const originalDate = entryMatch[1];
    const body = await readJson(request);
    if (!body) return badRequest("Invalid request body.");

    const nextDate = body.date == null ? originalDate : body.date;
    if (!isValidDate(nextDate)) return badRequest("A valid date is required.");
    const weight = parseWeight(body.weight);
    if (weight == null) return badRequest("Enter a valid weight.");
    const phase = body.phase == null || body.phase === "" ? null : body.phase;
    if (phase !== null && !isPhase(phase)) return badRequest("Invalid phase.");
    const notes = sanitizeNotes(body.notes);
    if (notes == null && body.notes != null && body.notes !== "") return badRequest("Notes must be 1,000 characters or fewer.");

    const existing = await env.DB.prepare(`SELECT id FROM weight_entries WHERE date = ?`)
      .bind(originalDate)
      .first<{ id: number }>();
    if (!existing) return notFound();

    if (nextDate !== originalDate) {
      const conflict = await env.DB.prepare(`SELECT id FROM weight_entries WHERE date = ?`)
        .bind(nextDate)
        .first<{ id: number }>();
      if (conflict) {
        return json(
          { error: "Another entry already exists for that date.", code: "ENTRY_EXISTS" },
          { status: 409 }
        );
      }
    }

    await env.DB.prepare(
      `UPDATE weight_entries
       SET date = ?, weight = ?, phase = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`
    )
      .bind(nextDate, weight, phase, notes || null, originalDate)
      .run();

    const entry = await env.DB.prepare(
      `SELECT id, date, weight, phase, notes, created_at, updated_at
       FROM weight_entries WHERE date = ?`
    )
      .bind(nextDate)
      .first<WeightEntryRow>();

    return json({ entry });
  }

  if (entryMatch && method === "DELETE") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const result = await env.DB.prepare(`DELETE FROM weight_entries WHERE date = ?`)
      .bind(entryMatch[1])
      .run();
    if (!result.meta.changes) return notFound();
    return json({ ok: true });
  }


  if (path === "/api/import" && method === "POST") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const body = await readJson(request);
    const incoming = body?.entries;
    if (!Array.isArray(incoming)) return badRequest("Entries must be an array.");
    if (incoming.length > 10000) return badRequest("Import is limited to 10,000 rows at a time.");

    let imported = 0;
    let updated = 0;

    for (const raw of incoming) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (!isValidDate(row.date)) continue;
      const weight = parseWeight(row.weight);
      if (weight == null) continue;

      // Imported data is allowed to be incomplete. Missing Phase/Notes remain
      // NULL rather than being guessed from the current app settings.
      const phase = row.phase == null || row.phase === "" ? null : row.phase;
      if (phase !== null && !isPhase(phase)) continue;

      let notes: string | null = null;
      if (row.notes != null && row.notes !== "") {
        const parsedNotes = sanitizeNotes(row.notes);
        if (parsedNotes == null) continue;
        notes = parsedNotes || null;
      }

      const existing = await env.DB.prepare(`SELECT id FROM weight_entries WHERE date = ?`)
        .bind(row.date)
        .first<{ id: number }>();

      if (existing) {
        await env.DB.prepare(
          `UPDATE weight_entries
           SET weight = ?, phase = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
           WHERE date = ?`
        ).bind(weight, phase, notes, row.date).run();
        updated++;
      } else {
        await env.DB.prepare(
          `INSERT INTO weight_entries (date, weight, phase, notes) VALUES (?, ?, ?, ?)`
        ).bind(row.date, weight, phase, notes).run();
        imported++;
      }
    }

    return json({ imported, updated });
  }

  if (path === "/api/export.csv" && method === "GET") {
    if (!(await requireOwner(request, env))) return unauthorized();
    const entries = await getEntries(env);
    const rows = [
      ["Date", "Weight (lb)", "7-Day Average", "Phase", "Notes", "Created At", "Updated At"],
      ...entries.map((entry, index) => [
        entry.date,
        entry.weight.toFixed(2).replace(/\.00$/, ""),
        rollingAverage(entries, index)?.toFixed(2) ?? "",
        entry.phase ?? "",
        entry.notes ?? "",
        entry.created_at,
        entry.updated_at,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="weight-entries.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await apiRouter(request, env);
      } catch (error) {
        console.error(error);
        return json({ error: "Unexpected server error." }, { status: 500 });
      }
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
