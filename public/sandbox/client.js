// In-browser demo backend for /demo. Runs the real TravelDesk schema (supabase/migrations, bundled
// into schema.sql) in PGlite (Postgres in WebAssembly) and exposes the small slice of the
// supabase-js API the app uses: from().select() queries, rpc(), auth and storage. Queries run as
// the signed-in demo user with the same roles and row level security as production. Data lives
// only in this browser (IndexedDB), and "Reset demo" starts over with fresh sample data.

const PGLITE = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js';
const SESSION_KEY = 'td-demo-user';
const DOMAIN = 'sunrisepharma.demo';

export const COMPANY = 'Sunrise Pharma Ltd';

// The people prospects can sign in as. `pick` = shown on the demo sign-in screen.
export const PERSONAS = [
  { key: 'neha', name: 'Neha Kapoor', title: 'HR & Travel Desk', grade: 'L5', role: 'admin', dept: 'Human Resources', pick: true,
    does: 'Sees every booking, books tickets, uploads PDFs, edits the travel policy' },
  { key: 'vikram', name: 'Vikram Rao', title: 'Zonal Sales Head', grade: 'L7', role: 'manager', dept: 'Sales' },
  { key: 'arjun', name: 'Arjun Mehta', title: 'Regional Sales Manager', grade: 'L6', role: 'manager', dept: 'Sales', manager: 'vikram', pick: true,
    does: 'Approves his team’s trips, urgent ones first' },
  { key: 'priya', name: 'Priya Sharma', title: 'Area Sales Executive', grade: 'L2', role: 'employee', dept: 'Sales', manager: 'arjun', pick: true,
    does: 'Plans trips within policy, adds colleagues, gets tickets' },
  { key: 'rahul', name: 'Rahul Verma', title: 'Medical Representative', grade: 'L1', role: 'employee', dept: 'Sales', manager: 'arjun' },
  { key: 'kavita', name: 'Kavita Iyer', title: 'Medical Representative', grade: 'L1', role: 'employee', dept: 'Sales', manager: 'arjun' },
  { key: 'sameer', name: 'Sameer Khan', title: 'Product Manager', grade: 'L4', role: 'employee', dept: 'Marketing', manager: 'vikram' },
].map((p) => ({ ...p, email: `${p.key}@${DOMAIN}` }));

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsupported identifier: ${s}`);
  return `"${s}"`;
};
const pgArray = (arr) => `{${arr.map((v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
const toError = (e) => ({ message: e?.message || String(e), code: e?.code || 'P0001', details: e?.detail || null });

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Split "a, b(c, d), e" on top-level commas. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------- query builder (PostgREST subset)
class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, cols: '*', filters: [], orders: [], max: null, mode: 'many', count: null, head: false });
  }
  select(cols = '*', opts = {}) {
    this.cols = cols;
    this.count = opts.count || null;
    this.head = !!opts.head;
    return this;
  }
  eq(col, v) { this.filters.push({ col, op: '=', v }); return this; }
  neq(col, v) { this.filters.push({ col, op: '<>', v }); return this; }
  contains(col, arr) { this.filters.push({ col, op: '@>', v: pgArray(arr) }); return this; }
  not(col, op, v) {
    if (op !== 'is' || v !== null) throw new Error('Demo client: unsupported not() filter');
    this.filters.push({ col, op: 'is not null' });
    return this;
  }
  order(col, { ascending = true } = {}) { this.orders.push(`t.${ident(col)} ${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.max = Number(n); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(resolve, reject) { return this.client.runQuery(this).then(resolve, reject); }
}

// ---------------------------------------------------------------- the client
class DemoClient {
  constructor(db, dbName) {
    this.db = db;
    this.dbName = dbName;
    this.listeners = [];
    this.fkCache = {};
    this.fnCache = {};
    this.urls = {};
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { /* private mode */ }
    this.session = saved?.user?.id ? saved : null;

    this.auth = {
      getSession: async () => ({ data: { session: this.session }, error: null }),
      getUser: async () => ({ data: { user: this.session?.user || null }, error: null }),
      onAuthStateChange: (cb) => {
        this.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => { this.listeners = this.listeners.filter((x) => x !== cb); } } } };
      },
      signInWithPassword: async ({ email }) => {
        const r = await this.db.query('select id, email from auth.users where lower(email) = lower($1)', [String(email || '').trim()]);
        if (!r.rows.length) return { data: {}, error: { message: 'Pick one of the demo people to sign in.' } };
        this.setSession({ user: { id: r.rows[0].id, email: r.rows[0].email } }, 'SIGNED_IN');
        return { data: { session: this.session, user: this.session.user }, error: null };
      },
      signUp: async () => ({ data: {}, error: { message: 'Sign-up is turned off in the demo. Pick one of the demo people.' } }),
      signOut: async () => {
        this.setSession(null, 'SIGNED_OUT');
        return { error: null };
      },
    };

    this.storage = { from: (bucket) => this.bucket(bucket) };
  }

  setSession(session, event) {
    this.session = session;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* private mode */ }
    for (const cb of this.listeners) cb(event, session);
  }

  /** Run fn(tx) as the signed-in user: role `authenticated` and auth.uid() set, so RLS applies. */
  asUser(fn, uid = this.session?.user?.id) {
    return this.db.transaction(async (tx) => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid || '', role: uid ? 'authenticated' : 'anon' })]);
      return fn(tx);
    });
  }

  from(table) {
    return new Query(this, table);
  }

  async foreignKey(table, target, name) {
    const k = `${table}>${target}>${name || ''}`;
    if (!(k in this.fkCache)) {
      const r = await this.db.query(
        `select a.attname from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.conrelid = ('public.' || $1)::regclass and c.confrelid = ('public.' || $2)::regclass
            and ($3::text is null or c.conname = $3)`,
        [table, target, name || null]
      );
      if (r.rows.length !== 1) throw new Error(`Demo client: can't resolve ${table} → ${target}`);
      this.fkCache[k] = r.rows[0].attname;
    }
    return this.fkCache[k];
  }

  async columnsSql(q) {
    const out = [];
    for (const item of splitTop(q.cols)) {
      if (item === '*') {
        out.push('t.*');
        continue;
      }
      const m = item.match(/^(\w+):(\w+)(?:!(\w+))?\((.*)\)$/);
      if (m) {
        const [, alias, target, fkName, inner] = m;
        const fk = await this.foreignKey(q.table, target, fkName);
        const innerCols = splitTop(inner).map((c) => (c === '*' ? 'r.*' : `r.${ident(c)}`)).join(', ');
        out.push(`(select row_to_json(x) from (select ${innerCols} from public.${ident(target)} r where r.id = t.${ident(fk)}) x) as ${ident(alias)}`);
      } else {
        out.push(`t.${ident(item)}`);
      }
    }
    return out.join(', ');
  }

  async runQuery(q) {
    try {
      const params = [];
      const where = q.filters.map(({ col, op, v }) => {
        if (op === 'is not null') return `t.${ident(col)} is not null`;
        if (v === null) return `t.${ident(col)} ${op === '=' ? 'is' : 'is not'} null`;
        params.push(String(v));
        return `t.${ident(col)} ${op} $${params.length}`;
      });
      const from = `from public.${ident(q.table)} t${where.length ? ' where ' + where.join(' and ') : ''}`;

      if (q.head) {
        const r = await this.asUser((tx) => tx.query(`select count(*)::int as n ${from}`, params));
        return { data: null, count: r.rows[0].n, error: null };
      }
      const sql = `select row_to_json(q)::text as r from (select ${await this.columnsSql(q)} ${from}`
        + `${q.orders.length ? ' order by ' + q.orders.join(', ') : ''}${q.max ? ` limit ${q.max | 0}` : ''}) q`;
      const r = await this.asUser((tx) => tx.query(sql, params));
      const rows = r.rows.map((x) => JSON.parse(x.r));
      if (q.mode === 'many') return { data: rows, count: q.count ? rows.length : null, error: null };
      if (rows.length > 1 || (q.mode === 'single' && rows.length === 0)) {
        return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      }
      return { data: rows[0] || null, error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  }

  async fnMeta(name) {
    if (!this.fnCache[name]) {
      const r = await this.db.query(
        `select p.proretset as set, format_type(p.prorettype, null) as ret, coalesce(p.proargnames, '{}') as names,
                array(select format_type(t, null) from unnest(p.proargtypes) t) as types
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [name]
      );
      if (r.rows.length !== 1) throw new Error(`Unknown function ${name}`);
      this.fnCache[name] = r.rows[0];
    }
    return this.fnCache[name];
  }

  /** Same contract as supabase-js rpc(): named arguments, JSON in, JSON out. */
  rpc(name, args = {}) {
    const run = async () => {
      try {
        ident(name);
        const meta = await this.fnMeta(name);
        const params = [];
        const named = meta.names.slice(0, meta.types.length).map((arg, i) => {
          if (!(arg in args)) return null;
          params.push(JSON.stringify(args[arg] ?? null));
          const p = `$${params.length}::jsonb`;
          const type = meta.types[i];
          const expr = type === 'jsonb' || type === 'json' ? `nullif(${p}, 'null'::jsonb)`
            : type.endsWith('[]') ? `(select array_agg(e) from jsonb_array_elements_text(${p}) e)::${type}`
            : `(${p} #>> '{}')::${type}`;
          return `${ident(arg)} => ${expr}`;
        }).filter(Boolean).join(', ');
        const call = `public.${ident(name)}(${named})`;
        const r = await this.asUser((tx) =>
          meta.set ? tx.query(`select row_to_json(r)::text as r from ${call} r`, params)
            : meta.ret === 'void' ? tx.query(`select ${call}`, params)
            : tx.query(`select to_json(${call})::text as r`, params));
        const data = meta.set ? r.rows.map((x) => JSON.parse(x.r)) : meta.ret === 'void' ? null : JSON.parse(r.rows[0].r);
        return { data, error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    };
    return run();
  }

  bucket(bucket) {
    return {
      upload: async (path, file, opts = {}) => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await this.asUser(async (tx) => {
            // The insert runs as the user, so the storage policies from the migrations decide.
            await tx.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)',
              [bucket, path, JSON.stringify({ mimetype: opts.contentType || file.type || 'application/octet-stream', size: bytes.length })]);
            await tx.exec('reset role');
            await tx.query('insert into demo.files (bucket_id, name, mime, data) values ($1, $2, $3, $4)',
              [bucket, path, opts.contentType || file.type || 'application/octet-stream', bytes]);
          });
          return { data: { path }, error: null };
        } catch (e) {
          return { data: null, error: toError(e) };
        }
      },
      createSignedUrl: async (path) => {
        try {
          const seen = await this.asUser((tx) => tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, path]));
          if (!seen.rows.length) return { data: null, error: { message: 'Object not found' } };
          const key = `${bucket}/${path}`;
          if (!this.urls[key]) {
            const f = await this.db.query('select mime, data from demo.files where bucket_id = $1 and name = $2', [bucket, path]);
            if (!f.rows.length) return { data: null, error: { message: 'Object not found' } };
            this.urls[key] = URL.createObjectURL(new Blob([f.rows[0].data], { type: f.rows[0].mime }));
          }
          return { data: { signedUrl: this.urls[key] }, error: null };
        } catch (e) {
          return { data: null, error: toError(e) };
        }
      },
      remove: async (paths) => {
        try {
          const removed = await this.asUser(async (tx) => {
            const r = await tx.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [bucket, pgArray(paths)]);
            await tx.exec('reset role');
            await tx.query('delete from demo.files where bucket_id = $1 and name = any($2::text[])', [bucket, pgArray(r.rows.map((x) => x.name))]);
            return r.rows;
          });
          return { data: removed, error: null };
        } catch (e) {
          return { data: null, error: toError(e) };
        }
      },
    };
  }

  /** Wipe this browser's demo database and start over with fresh sample data. */
  async reset() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
    try { await this.db.close(); } catch { /* already closed */ }
    await new Promise((done) => {
      const req = indexedDB.deleteDatabase(`/pglite/${this.dbName}`);
      req.onsuccess = req.onerror = req.onblocked = () => done();
    });
    location.reload();
  }

  personaFor(userId) {
    return this.personaIds ? PERSONAS.find((p) => this.personaIds[p.key] === userId) || null : null;
  }
}

// ---------------------------------------------------------------- sample PDF (ticket / voucher)
/** A one-page PDF with the given lines (ASCII), used for seeded tickets and the "sample ticket" download. */
export function makePdf(lines) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '-').replace(/[\\()]/g, '\\$&');
  let text = `BT /F2 18 Tf 56 770 Td (${esc(lines[0])}) Tj /F1 11 Tf`;
  for (const line of lines.slice(1)) text += ` 0 -22 Td (${esc(line)}) Tj`;
  text += ' ET 0.31 0.27 0.9 RG 3 w 56 800 m 539 800 l S';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

// ---------------------------------------------------------------- sample company
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function plusDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const seg = (type, from_loc, to_loc, start_date, extra = {}) => ({
  type, from_loc, to_loc, start_date, end_date: null, travel_class: '', duration_hours: null, est_cost: 0, rooms: 1, notes: '', ...extra,
});

async function seed(client) {
  const db = client.db;
  const today = todayIST();
  const d = (n) => plusDays(today, n);

  await db.exec(`update public.settings set company_name = '${COMPANY}'`);
  const ids = {};
  for (const p of PERSONAS) {
    const r = await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [p.email, JSON.stringify({ full_name: p.name })]);
    ids[p.key] = r.rows[0].id;
  }
  for (const p of PERSONAS) {
    await db.query('update public.profiles set full_name = $2, role = $3::public.app_role, grade = $4, department = $5, manager_id = $6 where id = $1',
      [ids[p.key], p.name, p.role, p.grade, p.dept, p.manager ? ids[p.manager] : null]);
  }
  await db.query(`update public.settings set allowed_email_domain = $1`, [DOMAIN]);
  const details = {
    priya: ['Priya Sharma', 'female', '1996-04-12', '98200 11223', 'Vegetarian', 'Lower'],
    rahul: ['Rahul Verma', 'male', '1998-09-03', '98200 44556', 'Non-vegetarian', 'Upper'],
    kavita: ['Kavita Iyer', 'female', '1997-01-21', '98200 77889', 'Vegetarian', 'Lower'],
    arjun: ['Arjun Mehta', 'male', '1988-06-30', '98200 99001', 'Non-vegetarian', 'Lower'],
    sameer: ['Sameer Khan', 'male', '1991-11-08', '98200 33445', 'Non-vegetarian', 'Side lower'],
  };
  for (const [k, [id_name, gender, dob, phone, meal, berth]] of Object.entries(details)) {
    await db.query('insert into public.person_details (id, id_name, gender, date_of_birth, phone, meal_pref, berth_pref) values ($1,$2,$3,$4,$5,$6,$7)',
      [ids[k], id_name, gender, dob, phone, meal, berth]);
  }
  await db.exec(`insert into public.preferred_hotels (city, name, area, rate_per_night, includes_breakfast, contact, notes) values
    ('mumbai', 'Hotel Sahara Star Business', 'Vile Parle East, near airport', 2400, true, 'corporate@sahara.example', 'Corporate code SUNRISE'),
    ('mumbai', 'Ginger Andheri', 'Andheri East (MIDC)', 1900, false, '', ''),
    ('delhi', 'Lemon Tree Premier', 'Aerocity', 2450, true, '', 'Airport shuttle included'),
    ('delhi', 'Treebo Trend Paharganj', 'Near New Delhi station', 1450, false, '', ''),
    ('ahmedabad', 'Fortune Park', 'Ashram Road', 1950, true, '', ''),
    ('nagpur', 'Hotel Centre Point', 'Ramdaspeth', 1400, true, '', 'Close to medical college'),
    ('patna', 'Hotel Maurya', 'Gandhi Maidan', 1950, true, '', ''),
    ('pune', 'Ibis Viman Nagar', 'Viman Nagar', 1850, true, '', ''),
    ('lucknow', 'Hotel Clarks Avadh', 'Mahatma Gandhi Marg', 1750, true, '', '')`);
  client.personaIds = ids;

  const as = (key) => ({
    rpc: async (name, args) => {
      const prev = client.session;
      client.session = { user: { id: ids[key] } };
      try {
        const { data, error } = await client.rpc(name, args);
        if (error) throw new Error(`Seeding ${name} as ${key}: ${error.message}`);
        return data;
      } finally {
        client.session = prev;
      }
    },
  });
  const pax = (key, extra = {}) => {
    const [full_name, gender, dob, phone, meal_pref, berth_pref] = details[key];
    return { profile_id: ids[key], full_name, gender, age: new Date().getFullYear() - Number(dob.slice(0, 4)), phone, meal_pref, berth_pref, ...extra };
  };
  const ticket = async (tripId, file, kind, lines) => {
    const path = `${tripId}/seed-${file}`;
    const bytes = makePdf(lines);
    await db.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)', ['trip-docs', path, JSON.stringify({ mimetype: 'application/pdf' })]);
    await db.query('insert into demo.files (bucket_id, name, mime, data) values ($1, $2, $3, $4)', ['trip-docs', path, 'application/pdf', bytes]);
    await as('neha').rpc('add_trip_document', { p_trip_id: tripId, p_path: path, p_file_name: file, p_kind: kind, p_size: bytes.length });
  };

  // 1. Urgent trip waiting for Arjun's approval.
  const t1 = await as('rahul').rpc('submit_trip', {
    p_trip: { title: `Pune → Nagpur · CME`, purpose: 'Doctor meetings and CME sponsorship at GMC Nagpur', origin: 'Pune', destination: 'Nagpur',
      start_date: d(4), end_date: d(6), is_urgent: true, urgency_reason: 'CME date was moved up by the organisers',
      justification: 'Short notice: dates confirmed by the hospital this week', traveller_ids: [] },
    p_segments: [
      seg('train', 'Pune', 'Nagpur', d(4), { travel_class: 'sleeper', notes: 'Preferred: Night · No. 12135' }),
      seg('hotel', '', 'Nagpur', d(4), { end_date: d(6), notes: 'Hotel Centre Point' }),
      seg('train', 'Nagpur', 'Pune', d(6), { travel_class: 'sleeper', notes: 'Preferred: Evening' }),
    ],
  });
  await as('rahul').rpc('add_trip_passengers', { p_trip_id: t1, p: [pax('rahul')] });

  // 2. Group trip approved by Arjun, waiting for the travel desk to book.
  const t2 = await as('kavita').rpc('submit_trip', {
    p_trip: { title: 'Mumbai → Ahmedabad · Stockist meet', purpose: 'Quarterly stockist meet, Gujarat region', origin: 'Mumbai', destination: 'Ahmedabad',
      start_date: d(35), end_date: d(36), is_urgent: false, traveller_ids: [ids.rahul] },
    p_segments: [
      seg('train', 'Mumbai', 'Ahmedabad', d(35), { travel_class: 'sleeper', notes: 'Preferred: Early morning · No. 12009' }),
      seg('hotel', '', 'Ahmedabad', d(35), { end_date: d(36), rooms: 2, notes: 'Fortune Park' }),
      seg('train', 'Ahmedabad', 'Mumbai', d(36), { travel_class: 'sleeper', notes: 'Preferred: Evening' }),
    ],
  });
  await as('kavita').rpc('add_trip_passengers', { p_trip_id: t2, p: [pax('kavita'), pax('rahul')] });
  await as('arjun').rpc('decide_trip', { p_trip_id: t2, p_decision: 'approve', p_comment: 'Approved. Please carry the Q3 scheme sheets.' });

  // 3. Flight (Mumbai–Delhi is a 30h+ surface journey, so air is allowed): approved, booked, tickets uploaded.
  const t3 = await as('sameer').rpc('submit_trip', {
    p_trip: { title: 'Mumbai → Delhi · Brand launch', purpose: 'North zone launch of CardioSun range', origin: 'Mumbai', destination: 'Delhi',
      start_date: d(40), end_date: d(42), is_urgent: false, traveller_ids: [] },
    p_segments: [
      seg('flight', 'Mumbai', 'Delhi', d(40), { notes: 'Preferred: Morning' }),
      seg('hotel', '', 'Delhi', d(40), { end_date: d(42), notes: 'Lemon Tree Premier, Aerocity' }),
      seg('flight', 'Delhi', 'Mumbai', d(42), { notes: 'Preferred: Evening' }),
    ],
  });
  await as('sameer').rpc('add_trip_passengers', { p_trip_id: t3, p: [pax('sameer')] });
  await as('vikram').rpc('decide_trip', { p_trip_id: t3, p_decision: 'approve', p_comment: 'Go ahead.' });
  await as('neha').rpc('set_trip_cost', { p_trip_id: t3, p_amount: 18450 });
  await as('neha').rpc('book_trip', { p_trip_id: t3, p_booking_ref: 'PNR 6E-4XK2Q / AI-7HM31', p_note: 'Hotel confirmation LT-55120' });
  await ticket(t3, 'E-ticket Mumbai-Delhi.pdf', 'ticket', ['E-TICKET  (demo)', `Passenger: SAMEER KHAN   PNR: 6E-4XK2Q`,
    `${d(40)}  BOM 07:10 -> DEL 09:25   Economy`, `${d(42)}  DEL 19:40 -> BOM 21:55   Economy`, `Booked by ${COMPANY} Travel Desk`]);
  await ticket(t3, 'Hotel voucher Delhi.pdf', 'hotel', ['HOTEL VOUCHER  (demo)', 'Lemon Tree Premier, Aerocity, New Delhi',
    `Check-in ${d(40)}   Check-out ${d(42)}   1 room`, 'Confirmation: LT-55120   Breakfast included']);

  // 4. Priya: a past trip, booked, with the ticket attached.
  const t4 = await as('priya').rpc('submit_trip', {
    p_trip: { title: 'Mumbai → Nashik · Distributor review', purpose: 'Monthly distributor review and secondary sales audit', origin: 'Mumbai', destination: 'Nashik',
      start_date: d(31), end_date: d(31), is_urgent: false, traveller_ids: [] },
    p_segments: [seg('cab', 'Mumbai', 'Nashik', d(31), { travel_class: 'economy_cab', notes: 'Return same day' })],
  });
  await as('priya').rpc('add_trip_passengers', { p_trip_id: t4, p: [pax('priya')] });
  await as('arjun').rpc('decide_trip', { p_trip_id: t4, p_decision: 'approve', p_comment: '' });
  await as('neha').rpc('set_trip_cost', { p_trip_id: t4, p_amount: 2400 });
  await as('neha').rpc('book_trip', { p_trip_id: t4, p_booking_ref: 'Cab MH-04-KX-2231', p_note: 'Driver: Santosh, 98190 22110' });
  await ticket(t4, 'Cab booking Nashik.pdf', 'ticket', ['CAB BOOKING  (demo)', 'Passenger: PRIYA SHARMA', `${d(-18)}  Mumbai (Andheri) -> Nashik, return same day`, 'Vehicle: MH-04-KX-2231 (Dzire)   Driver: Santosh']);
  // Move it into the past: it happened 18 days ago.
  await db.query(`update public.trips set start_date = $2, end_date = $2, created_at = now() - interval '25 days', updated_at = now() - interval '19 days' where id = $1`, [t4, d(-18)]);
  await db.query('update public.trip_segments set start_date = $2 where trip_id = $1', [t4, d(-18)]);
  await db.query(`update public.trip_events set created_at = now() - interval '24 days' where trip_id = $1`, [t4]);

  // 5. Priya: an out-of-policy flight that Arjun rejected (Pune is a short drive).
  const t5 = await as('priya').rpc('submit_trip', {
    p_trip: { title: 'Mumbai → Pune · Hospital tender', purpose: 'Rate contract presentation at Ruby Hall', origin: 'Mumbai', destination: 'Pune',
      start_date: d(33), end_date: d(33), is_urgent: false, justification: 'Early 9 am slot with the purchase committee', traveller_ids: [] },
    p_segments: [seg('flight', 'Mumbai', 'Pune', d(33), { notes: 'Preferred: Early morning' })],
  });
  await as('priya').rpc('add_trip_passengers', { p_trip_id: t5, p: [pax('priya')] });
  await as('arjun').rpc('decide_trip', { p_trip_id: t5, p_decision: 'reject', p_comment: 'Pune is about 3 hours by road. Please take the Deccan Queen or an economy cab the evening before.' });

  await db.query('insert into demo.meta (k, v) values ($1, $2)', ['personas', JSON.stringify(ids)]);
}

// ---------------------------------------------------------------- start-up
export async function createDemoClient(onProgress = () => {}, inject = {}) {
  onProgress('Loading the database engine…');
  const [{ PGlite }, schema] = inject.PGlite ? [inject, inject.schema] : await Promise.all([
    import(PGLITE),
    fetch(new URL('./schema.sql', import.meta.url)).then((r) => {
      if (!r.ok) throw new Error('Demo schema missing. Run `npm run build`.');
      return r.text();
    }),
  ]);
  const dbName = `traveldesk-demo-${hash(schema)}`;
  let db;
  try {
    db = await PGlite.create(inject.PGlite ? {} : { dataDir: `idb://${dbName}` });
  } catch {
    db = await PGlite.create(); // IndexedDB blocked (private mode): keep the demo in memory
  }
  const client = new DemoClient(db, dbName);

  const ready = await db.query(`select to_regclass('demo.meta') is not null as ok`);
  let ids = null;
  if (ready.rows[0].ok) {
    const r = await db.query(`select v from demo.meta where k = 'personas'`);
    ids = r.rows[0] ? JSON.parse(r.rows[0].v) : null;
  }
  if (!ids) {
    const partial = await db.query(`select to_regclass('public.trips') is not null as yes`);
    if (partial.rows[0].yes) return client.reset(); // an earlier set-up was interrupted
    onProgress('Setting up Sunrise Pharma (sample company)…');
    await db.exec(schema);
    await db.exec(`create schema demo;
      create table demo.meta (k text primary key, v text not null);
      create table demo.files (bucket_id text not null, name text not null, mime text not null, data bytea not null, primary key (bucket_id, name));`);
    await seed(client);
  } else {
    client.personaIds = ids;
  }
  if (client.session && !Object.values(client.personaIds).includes(client.session.user.id)) client.session = null;
  return client;
}
