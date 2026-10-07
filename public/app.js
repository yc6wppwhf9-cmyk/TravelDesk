import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $app = document.getElementById('app');

// Signed-in context, loaded once per session (and refreshed after admin edits).
const ctx = { user: null, profile: null, policy: null, settings: null, hasReports: false, pendingCount: 0 };

// ---------------------------------------------------------------- labels
const STATUS = {
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  booked: 'Booked',
  cancelled: 'Cancelled',
};
const SEG_TYPES = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab / Road',
  hotel: 'Hotel',
  other: 'Other',
};
const RAIL = {
  second_sitting: 'Second Sitting',
  sleeper: 'Sleeper / Second Class',
  chair_car: 'Chair Car',
  ac3: '3AC',
  ac2: '2AC',
  ac1: 'First Class / 1AC',
};
const ROAD = { public_transport: 'Public Transport', economy_cab: 'Economy / Shared Cab', ac_cab: 'AC Cab' };
const CAB_CLASSES = { economy_cab: 'Economy / Shared Cab (Ola, Uber, Rapido)', ac_cab: 'AC Cab', own_vehicle: 'Own Vehicle' };
const EVENT_LABEL = {
  submitted: 'Submitted',
  auto_approved: 'Auto-approved',
  approved: 'Approved',
  rejected: 'Rejected',
  booked: 'Booked by travel desk',
  cancelled: 'Cancelled',
};
const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', admin: 'Admin / Travel Desk' };

// ---------------------------------------------------------------- helpers
/** Tiny DOM builder: h('div', {class: 'x', onclick}, 'text', child, [children]). Text is never parsed as HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'hidden') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function mount(...nodes) {
  $app.replaceChildren(...nodes);
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 6000 : 3000);
}

function money(n) {
  const cur = ctx.settings?.currency || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0);
  } catch {
    return `${cur} ${Math.round(Number(n) || 0)}`;
  }
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function statusBadge(s) {
  return h('span', { class: `badge s-${s}` }, STATUS[s] || s);
}

function tripBadges(t) {
  return [
    statusBadge(t.status),
    t.is_urgent ? h('span', { class: 'badge urgent' }, 'Urgent') : null,
    t.is_international ? h('span', { class: 'badge intl' }, 'Foreign') : null,
    (t.violations || []).length ? h('span', { class: 'badge oop' }, 'Out of policy') : null,
  ].filter(Boolean).reduce((acc, b) => (acc.length ? [...acc, ' ', b] : [b]), []);
}

/** Run a Supabase call, toast + rethrow on error. */
async function call(promise) {
  const { data, error } = await promise;
  if (error) {
    toast(error.message || 'Something went wrong', true);
    throw error;
  }
  return data;
}

function field(labelText, input, hint, required = false) {
  return h('div', { class: 'field' }, h('label', { class: required ? 'required' : '' }, labelText), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

function select(options, value, attrs = {}) {
  return h('select', attrs, Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function isAdmin() {
  return ctx.profile?.role === 'admin';
}
function canSeeApprovals() {
  return isAdmin() || ctx.profile?.role === 'manager' || ctx.hasReports;
}

function toCSV(rows, cols) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map(([k, , fn]) => esc(fn ? fn(r) : r[k])).join(','))].join('\n');
}
function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- session
async function loadContext() {
  const { data } = await sb.auth.getUser();
  ctx.user = data.user;
  if (!ctx.user) return;
  const [profile, settings, reports] = await Promise.all([
    call(sb.from('profiles').select('*').eq('id', ctx.user.id).single()),
    call(sb.from('settings').select('*').single()),
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('manager_id', ctx.user.id),
  ]);
  ctx.profile = profile;
  ctx.settings = settings;
  ctx.hasReports = (reports.count || 0) > 0;
  ctx.policy = await call(sb.from('policies').select('*').eq('grade', profile.grade).maybeSingle());
  await refreshPendingCount();
}

async function refreshPendingCount() {
  ctx.pendingCount = 0;
  if (!canSeeApprovals()) return;
  const rows = await pendingApprovals();
  ctx.pendingCount = rows.length;
}

async function pendingApprovals() {
  const rows = await call(
    sb.from('trips_view').select('*').eq('status', 'pending_approval').neq('user_id', ctx.user.id)
      .order('is_urgent', { ascending: false }).order('start_date')
  );
  return rows.filter((t) => t.manager_id === ctx.user.id || (isAdmin() && !t.manager_id));
}

function renderNav(route) {
  const bar = document.getElementById('topbar');
  if (!ctx.profile) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  document.getElementById('me-name').textContent = `${ctx.profile.full_name} · ${ctx.profile.grade}`;
  const links = [
    ['#/trips', 'My Trips'],
    ['#/new', 'Plan a Trip'],
    canSeeApprovals() ? ['#/approvals', 'Approvals', ctx.pendingCount] : null,
    isAdmin() ? ['#/admin', 'All Bookings'] : null,
    isAdmin() ? ['#/admin/users', 'People'] : null,
    isAdmin() ? ['#/admin/policy', 'Travel Policy'] : null,
    !isAdmin() ? ['#/policy', 'My Entitlements'] : null,
  ].filter(Boolean);
  document.getElementById('nav').replaceChildren(
    ...links.map(([href, label, n]) =>
      h('a', { href, class: route === href ? 'active' : '' }, label, n ? h('span', { class: 'count' }, n) : null)
    )
  );
}

document.getElementById('logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  Object.assign(ctx, { user: null, profile: null, policy: null });
  location.hash = '#/login';
});

// ---------------------------------------------------------------- router
async function router() {
  const hash = location.hash || '#/trips';
  if (!ctx.user && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }
  if (ctx.user && !ctx.profile) await loadContext();

  const [, a, b] = hash.split('/');
  const route = b && a !== 'trip' ? `#/${a}/${b}` : `#/${a || 'trips'}`;
  renderNav(route);
  window.scrollTo(0, 0);
  try {
    if (a === 'login') return ctx.user ? (location.hash = '#/trips') : viewLogin();
    if (a === 'trips' || !a) return await viewMyTrips();
    if (a === 'new') return await viewNewTrip();
    if (a === 'trip' && b) return await viewTrip(Number(b));
    if (a === 'approvals') return await viewApprovals();
    if (a === 'policy') return await viewPolicy();
    if (a === 'admin' && !isAdmin()) return mount(h('div', { class: 'card empty' }, 'Admins only.'));
    if (a === 'admin' && !b) return await viewAdminBookings();
    if (a === 'admin' && b === 'users') return await viewAdminUsers();
    if (a === 'admin' && b === 'policy') return await viewAdminPolicy();
    mount(h('div', { class: 'card empty' }, 'Page not found.'));
  } catch (err) {
    console.error(err);
    mount(h('div', { class: 'card empty' }, 'Could not load this page: ', err.message || String(err)));
  }
}

// ---------------------------------------------------------------- login / sign up
function viewLogin() {
  let mode = 'signin';
  const name = h('input', { autocomplete: 'name', placeholder: 'Full name' });
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@company.com', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', minlength: '8', required: true });
  const nameField = field('Full name', name, null, true);
  const submit = h('button', { class: 'primary', type: 'submit', style: 'width:100%' }, 'Sign in');
  const tabs = h('div', { class: 'tabs' });
  const note = h('p', { class: 'muted small' });

  const setMode = (m) => {
    mode = m;
    nameField.hidden = m !== 'signup';
    submit.textContent = m === 'signup' ? 'Create account' : 'Sign in';
    pass.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    note.textContent =
      m === 'signup' ? 'Use your work email. An admin will assign your band (L0–L10) and reporting manager.' : '';
    tabs.replaceChildren(
      h('button', { type: 'button', class: m === 'signin' ? 'active' : '', onclick: () => setMode('signin') }, 'Sign in'),
      h('button', { type: 'button', class: m === 'signup' ? 'active' : '', onclick: () => setMode('signup') }, 'Create account')
    );
  };

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          if (mode === 'signup') {
            if (!name.value.trim()) throw new Error('Please enter your name');
            const { data, error } = await sb.auth.signUp({
              email: email.value.trim(),
              password: pass.value,
              options: { data: { full_name: name.value.trim() }, emailRedirectTo: location.origin + location.pathname },
            });
            if (error) throw error;
            if (!data.session) {
              toast('Account created. Check your email to confirm, then sign in.');
              setMode('signin');
              return;
            }
          } else {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
            if (error) throw error;
          }
          await loadContext();
          location.hash = '#/trips';
        } catch (err) {
          toast(err.message || 'Sign in failed', true);
        } finally {
          submit.disabled = false;
        }
      },
    },
    nameField,
    field('Work email', email, null, true),
    field('Password', pass, null, true),
    submit,
    note
  );
  setMode('signin');
  mount(
    h('div', { class: 'auth' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '✈'), ' TravelDesk'),
      h('p', { class: 'muted center' }, 'Plan business travel within company policy'),
      h('div', { class: 'card' }, tabs, form))
  );
}

// ---------------------------------------------------------------- my trips
async function viewMyTrips() {
  const trips = await call(sb.from('trips_view').select('*').eq('user_id', ctx.user.id).order('start_date', { ascending: false }));
  const upcoming = trips.filter((t) => ['pending_approval', 'approved', 'booked'].includes(t.status));
  const past = trips.filter((t) => !upcoming.includes(t));

  const table = (rows) =>
    rows.length
      ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {}, ['Trip', 'Dates', 'Estimate', 'Status'].map((c) => h('th', {}, c)))),
            h('tbody', {}, rows.map((t) =>
              h('tr', { class: 'clickable', onclick: () => (location.hash = `#/trip/${t.id}`) },
                h('td', {}, h('strong', {}, t.title), h('div', { class: 'muted small' }, t.destination)),
                h('td', { class: 'nowrap' }, fmtDate(t.start_date), ' – ', fmtDate(t.end_date)),
                h('td', { class: 'nowrap' }, money(t.total_estimate)),
                h('td', {}, tripBadges(t)))))))
      : h('div', { class: 'empty' }, 'Nothing here yet.');

  mount(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Hello, ${ctx.profile.full_name.split(' ')[0]}`),
        h('div', { class: 'muted' }, `Band ${ctx.profile.grade}${ctx.policy ? ' · ' + ctx.policy.label : ''}`)),
      h('a', { class: 'btn primary', href: '#/new' }, '+ Plan a trip')),
    !ctx.profile.manager_id && !isAdmin()
      ? h('div', { class: 'notice warn' }, 'You have no reporting manager assigned yet, so approvals will go to the travel desk admin. Ask an admin to set your manager and band.')
      : null,
    h('div', { class: 'card' }, h('h2', {}, 'Active & upcoming'), table(upcoming)),
    h('div', { class: 'card' }, h('h2', {}, 'Past, rejected & cancelled'), table(past))
  );
}

// ---------------------------------------------------------------- plan a trip
function blankSegment(type, date) {
  return { type, from_loc: '', to_loc: '', start_date: date || '', end_date: '', travel_class: '', duration_hours: '', est_cost: '', notes: '' };
}

async function viewNewTrip() {
  if (!ctx.policy || ctx.policy.rank === null) {
    return mount(h('div', { class: 'card empty' }, 'No travel policy is configured for your band yet. Please contact the travel desk.'));
  }
  const s = ctx.settings;
  const state = {
    title: '', purpose: '', destination: '', start_date: '', end_date: '',
    is_international: false, is_urgent: false, urgency_reason: '', justification: '',
    segments: [blankSegment('train')],
  };
  let lastCheck = null;
  let timer;

  const segWrap = h('div');
  const checkPanel = h('div', {}, h('p', { class: 'muted small' }, 'Fill in dates and itinerary to see the policy check.'));
  const urgentReason = h('textarea', { placeholder: 'Why must this trip happen urgently?', oninput: (e) => { state.urgency_reason = e.target.value; } });
  const urgentField = field('Urgency reason', urgentReason, 'Urgent trips always go to your reporting manager.', true);
  urgentField.hidden = true;
  const justification = h('textarea', { placeholder: 'Business justification for the exception / short notice', oninput: (e) => { state.justification = e.target.value; } });
  const justField = field('Justification for special approval', justification, null, true);
  justField.hidden = true;
  const submitBtn = h('button', { class: 'primary', type: 'submit' }, 'Submit for approval');

  const bind = (key, el, evt = 'input') => {
    el.addEventListener(evt, () => {
      state[key] = el.type === 'checkbox' ? el.checked : el.value;
      scheduleCheck();
    });
    return el;
  };

  function scheduleCheck() {
    clearTimeout(timer);
    timer = setTimeout(runCheck, 350);
  }

  async function runCheck() {
    if (!state.start_date) return;
    const payload = tripPayload();
    const { data, error } = await sb.rpc('check_trip', { p_trip: payload.trip, p_segments: payload.segments });
    if (error) {
      checkPanel.replaceChildren(h('div', { class: 'notice bad' }, error.message));
      return;
    }
    lastCheck = data;
    renderCheck(data);
  }

  function tripPayload() {
    const segments = state.segments.map((sg) => ({
      ...sg,
      est_cost: sg.est_cost === '' ? 0 : Number(sg.est_cost),
      duration_hours: sg.duration_hours === '' ? null : Number(sg.duration_hours),
      end_date: sg.end_date || null,
    }));
    const { segments: _omit, ...trip } = state;
    void _omit;
    return { trip, segments };
  }

  function renderCheck(c) {
    justField.hidden = !c.needs_justification;
    submitBtn.textContent = c.requires_approval ? 'Submit for manager approval' : 'Submit';
    const v = c.violations || [];
    checkPanel.replaceChildren(
      v.length
        ? h('div', { class: 'notice bad' }, h('strong', {}, `${v.length} policy exception${v.length > 1 ? 's' : ''}`), h('ul', {}, v.map((x) => h('li', {}, x.message))))
        : h('div', { class: 'notice ok' }, '✓ Itinerary is within your band entitlement'),
      c.short_notice
        ? h('div', { class: 'notice warn' }, `Short notice: ${c.days_until_travel} day(s) before travel. Policy asks for ${c.advance_days_required} days — special approval with justification is required.`)
        : null,
      c.requires_approval
        ? h('div', { class: 'notice info' }, h('strong', {}, 'Approval needed'), h('ul', {}, (c.reasons || []).map((r) => h('li', {}, r))))
        : h('div', { class: 'notice ok' }, 'No approval needed — this trip will be approved automatically.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Itinerary estimate'), h('dd', {}, money(c.total)),
        h('dt', {}, 'Trip length'), h('dd', {}, `${c.trip_days} day(s)`),
        h('dt', {}, 'Meals (on actuals)'), h('dd', {}, `up to ${money(c.meal_cap_per_day)}/day · ${money(c.meal_budget)}`),
        c.laundry_allowance > 0 ? [h('dt', {}, 'Laundry'), h('dd', {}, `up to ${money(c.laundry_allowance)}`)] : null,
        (c.hotels || []).map((ht) => [
          h('dt', {}, `Hotel (item ${ht.item})`),
          h('dd', {}, ht.category ? `${ht.city || '—'}: cat. ${ht.category}, cap ${money(ht.cap)}/night, you entered ${money(ht.per_night)}/night` : `${ht.city || '—'}: foreign — cap agreed with manager & travel desk`),
        ])
      )
    );
  }

  function renderSegments() {
    segWrap.replaceChildren(
      ...state.segments.map((sg, i) => {
        const set = (k) => (e) => { sg[k] = e.target.value; scheduleCheck(); };
        const typeSel = select(SEG_TYPES, sg.type, {
          onchange: (e) => {
            sg.type = e.target.value;
            sg.travel_class = sg.type === 'train' ? ctx.policy.rail_max_class : sg.type === 'cab' ? 'economy_cab' : '';
            renderSegments();
            scheduleCheck();
          },
        });
        const isHotel = sg.type === 'hotel';
        const classInput =
          sg.type === 'train'
            ? field('Class', select({ '': '— select —', ...RAIL }, sg.travel_class, { onchange: set('travel_class') }), `Your entitlement: up to ${RAIL[ctx.policy.rail_max_class]}`)
            : sg.type === 'cab'
              ? field('Mode', select(CAB_CLASSES, sg.travel_class || 'economy_cab', { onchange: set('travel_class') }), `Your entitlement: ${ROAD[ctx.policy.road_max_mode]}${ctx.policy.own_vehicle_allowed ? ' or own vehicle' : ''}`)
              : null;
        const durationInput =
          sg.type === 'flight' && !state.is_international
            ? field('Rail/road journey time (hours)', h('input', { type: 'number', min: '0', step: '0.5', value: sg.duration_hours, oninput: set('duration_hours') }),
                `Air is allowed only when the surface journey exceeds ${s.air_min_surface_hours} hours.`, true)
            : null;
        return h('div', { class: 'segment' },
          h('div', { class: 'seg-head' },
            h('span', { class: 'seg-num' }, `ITEM ${i + 1}`),
            state.segments.length > 1
              ? h('button', { type: 'button', class: 'link', onclick: () => { state.segments.splice(i, 1); renderSegments(); scheduleCheck(); } }, 'Remove')
              : null),
          h('div', { class: 'row' },
            field('Type', typeSel),
            isHotel ? null : field('From', h('input', { value: sg.from_loc, oninput: set('from_loc'), placeholder: 'City' })),
            field(isHotel ? 'Hotel city' : 'To', h('input', { value: sg.to_loc, oninput: set('to_loc'), placeholder: 'City', list: isHotel ? 'city-list' : null }),
              isHotel ? 'City category (A/B/C) sets your hotel cap' : null, isHotel),
            field(isHotel ? 'Check-in' : 'Date', h('input', { type: 'date', value: sg.start_date, oninput: set('start_date') }), null, true),
            isHotel ? field('Check-out', h('input', { type: 'date', value: sg.end_date, oninput: set('end_date') }), null, true) : null,
            classInput,
            durationInput,
            field(isHotel ? 'Total cost (all nights)' : 'Estimated cost', h('input', { type: 'number', min: '0', step: '1', value: sg.est_cost, oninput: set('est_cost') }))),
          field('Notes', h('input', { value: sg.notes, oninput: set('notes'), placeholder: 'Preferred timing, train/flight no., hotel name…' })));
      })
    );
  }

  const cities = await call(sb.from('cities').select('name').order('name'));
  const cityList = h('datalist', { id: 'city-list' }, cities.map((c) => h('option', { value: c.name.replace(/\b\w/g, (x) => x.toUpperCase()) })));

  const intl = bind('is_international', h('input', { type: 'checkbox' }), 'change');
  intl.addEventListener('change', renderSegments);
  const urgent = bind('is_urgent', h('input', { type: 'checkbox' }), 'change');
  urgent.addEventListener('change', () => { urgentField.hidden = !urgent.checked; });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      try {
        const p = tripPayload();
        const id = await call(sb.rpc('submit_trip', { p_trip: p.trip, p_segments: p.segments }));
        toast(lastCheck?.requires_approval ? 'Trip submitted for approval' : 'Trip approved');
        await refreshPendingCount();
        location.hash = `#/trip/${id}`;
      } catch {
        /* toast already shown */
      } finally {
        submitBtn.disabled = false;
      }
    },
  },
    h('div', { class: 'card' },
      h('h2', {}, 'Trip details'),
      field('Trip title', bind('title', h('input', { placeholder: 'e.g. Client visit – Mumbai', required: true })), null, true),
      h('div', { class: 'row' },
        field('Main destination', bind('destination', h('input', { required: true, list: 'city-list' })), null, true),
        field('Start date', bind('start_date', h('input', { type: 'date', required: true })), null, true),
        field('End date', bind('end_date', h('input', { type: 'date', required: true })), null, true)),
      field('Purpose of travel', bind('purpose', h('textarea', { required: true, placeholder: 'Meetings, market visits, client, expected outcome…' })), null, true),
      h('div', { class: 'actions', style: 'gap:24px;margin-bottom:10px' },
        h('label', { class: 'check' }, intl, `Foreign travel (${s.international_advance_days} days notice)`),
        h('label', { class: 'check' }, urgent, 'This is an urgent trip')),
      urgentField),
    h('div', { class: 'card' },
      h('h2', {}, 'Itinerary'),
      h('p', { class: 'muted small' }, 'Air and rail are booked only by the Travel Desk. Road travel may be booked by you after approval and reimbursed on actuals.'),
      segWrap,
      h('div', { class: 'actions' },
        ...['train', 'flight', 'hotel', 'cab', 'bus'].map((t) =>
          h('button', { type: 'button', onclick: () => {
            const last = state.segments[state.segments.length - 1];
            state.segments.push(blankSegment(t, last?.end_date || last?.start_date || state.start_date));
            const ns = state.segments[state.segments.length - 1];
            ns.travel_class = t === 'train' ? ctx.policy.rail_max_class : t === 'cab' ? 'economy_cab' : '';
            renderSegments();
            scheduleCheck();
          } }, `+ ${SEG_TYPES[t]}`)))),
    h('div', { class: 'card' }, justField, h('div', { class: 'actions' }, submitBtn, h('a', { class: 'btn', href: '#/trips' }, 'Cancel')))
  );

  state.segments[0].travel_class = ctx.policy.rail_max_class;
  renderSegments();
  mount(
    cityList,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Plan a trip'),
      h('div', { class: 'muted' }, `Band ${ctx.profile.grade} · Domestic trips need ${s.domestic_advance_days} days notice`))),
    h('div', { class: 'grid two' }, form, h('div', { class: 'card sticky' }, h('h2', {}, 'Policy check'), checkPanel))
  );
}

// ---------------------------------------------------------------- trip detail
async function viewTrip(id) {
  const [trip, segs, events] = await Promise.all([
    call(sb.from('trips_view').select('*').eq('id', id).maybeSingle()),
    call(sb.from('trip_segments').select('*').eq('trip_id', id).order('position')),
    call(sb.from('trip_events').select('*, actor:profiles(full_name)').eq('trip_id', id).order('id')),
  ]);
  if (!trip) return mount(h('div', { class: 'card empty' }, 'Trip not found or you do not have access.'));

  const canApprove = trip.status === 'pending_approval' && (await call(sb.rpc('can_approve_trip', { p_trip: id })));
  const mine = trip.user_id === ctx.user.id;
  const canCancel = (mine && ['pending_approval', 'approved'].includes(trip.status)) || (isAdmin() && ['pending_approval', 'approved', 'booked'].includes(trip.status));
  const canBook = isAdmin() && trip.status === 'approved';

  const actions = [];
  if (canApprove) {
    const comment = h('textarea', { placeholder: 'Comment (required when rejecting)' });
    const decide = async (decision) => {
      await call(sb.rpc('decide_trip', { p_trip_id: id, p_decision: decision, p_comment: comment.value }));
      toast(decision === 'approve' ? 'Trip approved' : 'Trip rejected');
      await refreshPendingCount();
      router();
    };
    actions.push(h('div', { class: 'card' },
      h('h2', {}, 'Your decision'),
      field('Comment', comment),
      h('div', { class: 'actions' },
        h('button', { class: 'success', onclick: () => decide('approve') }, 'Approve'),
        h('button', { class: 'danger', onclick: () => decide('reject') }, 'Reject'))));
  }
  if (canBook) {
    const ref = h('input', { placeholder: 'PNR / booking reference(s)' });
    const note = h('input', { placeholder: 'Optional note to traveller' });
    actions.push(h('div', { class: 'card' },
      h('h2', {}, 'Travel desk: mark as booked'),
      field('Booking reference', ref, null, true),
      field('Note', note),
      h('button', { class: 'primary', onclick: async () => {
        await call(sb.rpc('book_trip', { p_trip_id: id, p_booking_ref: ref.value, p_note: note.value }));
        toast('Marked as booked');
        router();
      } }, 'Mark booked')));
  }
  if (canCancel) {
    actions.push(h('div', { class: 'card' },
      h('button', { class: 'danger', onclick: async () => {
        const reason = prompt('Reason for cancelling this trip?');
        if (reason === null) return;
        await call(sb.rpc('cancel_trip', { p_trip_id: id, p_comment: reason }));
        toast('Trip cancelled');
        await refreshPendingCount();
        router();
      } }, 'Cancel trip')));
  }

  const segRow = (sg, i) => {
    const cls = sg.type === 'train' ? RAIL[sg.travel_class] : sg.type === 'cab' ? CAB_CLASSES[sg.travel_class] : '';
    const route = sg.type === 'hotel' ? `${sg.to_loc}${sg.city_category ? ` (cat. ${sg.city_category})` : ''}` : [sg.from_loc, sg.to_loc].filter(Boolean).join(' → ');
    return h('tr', {},
      h('td', {}, i + 1),
      h('td', {}, SEG_TYPES[sg.type] || sg.type),
      h('td', {}, route || '—', sg.notes ? h('div', { class: 'muted small' }, sg.notes) : null),
      h('td', { class: 'nowrap' }, fmtDate(sg.start_date), sg.end_date ? ` – ${fmtDate(sg.end_date)}` : ''),
      h('td', {}, cls || '', sg.duration_hours ? h('div', { class: 'muted small' }, `surface ${sg.duration_hours} h`) : null),
      h('td', { class: 'right nowrap' }, money(sg.est_cost)));
  };

  mount(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'muted small' }, `Trip #${trip.id}`), h('h1', {}, trip.title), h('div', {}, tripBadges(trip))),
      h('a', { class: 'btn', href: mine ? '#/trips' : isAdmin() ? '#/admin' : '#/approvals' }, '← Back')),
    h('div', { class: 'grid two' },
      h('div', {},
        h('div', { class: 'card' },
          h('dl', { class: 'kv' },
            h('dt', {}, 'Traveller'), h('dd', {}, `${trip.traveller_name} (${trip.grade}${trip.department ? ', ' + trip.department : ''})`),
            h('dt', {}, 'Destination'), h('dd', {}, trip.destination),
            h('dt', {}, 'Dates'), h('dd', {}, `${fmtDate(trip.start_date)} – ${fmtDate(trip.end_date)}`),
            h('dt', {}, 'Purpose'), h('dd', {}, trip.purpose),
            trip.urgency_reason ? [h('dt', {}, 'Urgency'), h('dd', {}, trip.urgency_reason)] : null,
            trip.justification ? [h('dt', {}, 'Justification'), h('dd', {}, trip.justification)] : null,
            h('dt', {}, 'Estimate'), h('dd', {}, money(trip.total_estimate)),
            h('dt', {}, 'Approver'), h('dd', {}, trip.approver_name || trip.manager_name || 'Travel desk admin'),
            trip.approval_comment ? [h('dt', {}, 'Approver comment'), h('dd', {}, trip.approval_comment)] : null,
            trip.booking_ref ? [h('dt', {}, 'Booking ref'), h('dd', {}, trip.booking_ref)] : null,
            trip.admin_note ? [h('dt', {}, 'Travel desk note'), h('dd', {}, trip.admin_note)] : null)),
        (trip.violations || []).length
          ? h('div', { class: 'notice bad' }, h('strong', {}, 'Policy exceptions'), h('ul', {}, trip.violations.map((v) => h('li', {}, v.message))))
          : null,
        (trip.approval_reasons || []).length
          ? h('div', { class: 'notice info' }, h('strong', {}, 'Why approval was needed'), h('ul', {}, trip.approval_reasons.map((r) => h('li', {}, r))))
          : null,
        h('div', { class: 'card' },
          h('h2', {}, 'Itinerary'),
          h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['#', 'Type', 'Route / City', 'Dates', 'Class', 'Cost'].map((c, i) => h('th', { class: i === 5 ? 'right' : '' }, c)))),
            h('tbody', {}, segs.map(segRow)))))),
      h('div', {},
        ...actions,
        h('div', { class: 'card' },
          h('h2', {}, 'Timeline'),
          h('ul', { class: 'timeline' }, events.map((ev) =>
            h('li', {},
              h('strong', {}, EVENT_LABEL[ev.action] || ev.action),
              ev.actor?.full_name ? ` by ${ev.actor.full_name}` : '',
              h('div', { class: 'muted small' }, fmtDateTime(ev.created_at)),
              ev.comment ? h('div', { class: 'small' }, ev.comment) : null)))))));
}

// ---------------------------------------------------------------- approvals
async function viewApprovals() {
  const rows = await pendingApprovals();
  ctx.pendingCount = rows.length;
  renderNav('#/approvals');
  const team = await call(
    sb.from('trips_view').select('*').eq('manager_id', ctx.user.id).neq('status', 'pending_approval').order('start_date', { ascending: false }).limit(50)
  );

  const quick = async (t, decision) => {
    let comment = '';
    if (decision === 'reject') {
      comment = prompt(`Reason for rejecting "${t.title}"?`);
      if (!comment) return;
    }
    await call(sb.rpc('decide_trip', { p_trip_id: t.id, p_decision: decision, p_comment: comment }));
    toast(decision === 'approve' ? 'Approved' : 'Rejected');
    router();
  };

  mount(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Approvals'), h('div', { class: 'muted' }, 'Urgent requests are listed first'))),
    h('div', { class: 'card' },
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Traveller', 'Trip', 'Dates', 'Estimate', 'Flags', ''].map((c) => h('th', {}, c)))),
            h('tbody', {}, rows.map((t) =>
              h('tr', {},
                h('td', {}, h('strong', {}, t.traveller_name), h('div', { class: 'muted small' }, `${t.grade} · ${t.department || '—'}`)),
                h('td', {}, h('a', { href: `#/trip/${t.id}` }, t.title), h('div', { class: 'muted small' }, t.destination)),
                h('td', { class: 'nowrap' }, fmtDate(t.start_date), ' – ', fmtDate(t.end_date)),
                h('td', { class: 'nowrap' }, money(t.total_estimate)),
                h('td', {}, tripBadges(t).slice(1)),
                h('td', {}, h('div', { class: 'actions' },
                  h('a', { class: 'btn', href: `#/trip/${t.id}` }, 'Review'),
                  h('button', { class: 'success', onclick: () => quick(t, 'approve') }, 'Approve'),
                  h('button', { class: 'danger', onclick: () => quick(t, 'reject') }, 'Reject'))))))))
        : h('div', { class: 'empty' }, '🎉 Nothing waiting for your approval.')),
    team.length
      ? h('div', { class: 'card' }, h('h2', {}, 'Recent trips by your team'),
          h('div', { class: 'table-wrap' }, h('table', {},
            h('tbody', {}, team.map((t) =>
              h('tr', { class: 'clickable', onclick: () => (location.hash = `#/trip/${t.id}`) },
                h('td', {}, t.traveller_name), h('td', {}, t.title), h('td', { class: 'nowrap' }, fmtDate(t.start_date)), h('td', {}, statusBadge(t.status))))))))
      : null
  );
}

// ---------------------------------------------------------------- entitlements (employee view)
function entitlementCard(p) {
  return h('div', { class: 'card' },
    h('h2', {}, `Band ${p.grade} — ${p.label}`),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Rail'), h('dd', {}, `Up to ${RAIL[p.rail_max_class]}`),
      h('dt', {}, 'Road'), h('dd', {}, `${ROAD[p.road_max_mode]}${p.own_vehicle_allowed ? ', own vehicle allowed' : ''}`),
      h('dt', {}, 'Hotel cap / night'), h('dd', {}, `A: ${money(p.hotel_cap_a)} · B: ${money(p.hotel_cap_b)} · C: ${money(p.hotel_cap_c)}`),
      h('dt', {}, 'Meals / day'), h('dd', {}, `Up to ${money(p.meal_cap_per_day)} on actuals`),
      p.notes ? [h('dt', {}, 'Notes'), h('dd', {}, p.notes)] : null));
}

async function viewPolicy() {
  const s = ctx.settings;
  mount(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My travel entitlements'), h('div', { class: 'muted' }, s.company_name))),
    ctx.policy ? entitlementCard(ctx.policy) : h('div', { class: 'card empty' }, 'No band assigned.'),
    h('div', { class: 'card' },
      h('h2', {}, 'Key rules'),
      h('ul', {},
        h('li', {}, `Submit domestic travel requests at least ${s.domestic_advance_days} days ahead; foreign travel ${s.international_advance_days} days. Shorter notice needs special approval with justification.`),
        s.require_approval_all ? h('li', {}, 'All travel requires your Reporting Manager\'s approval.') : null,
        h('li', {}, `Air travel only when the rail/road journey is above ${s.air_min_surface_hours} hours.`),
        h('li', {}, 'Air and rail are booked only through the Travel Desk. Road travel may be booked by you after approval.'),
        h('li', {}, 'Hotel caps depend on city category (A: metros, B: state capitals & listed cities, C: all others). No accommodation for single-day travel.'),
        h('li', {}, `Laundry up to ${money(s.laundry_per_day)}/day from day ${s.laundry_from_day} of travel.`),
        h('li', {}, 'Submit your reimbursement sheet within 7 days of return with all bills.')))
  );
}

// ---------------------------------------------------------------- admin: all bookings
async function viewAdminBookings() {
  const all = await call(sb.from('trips_view').select('*').order('start_date', { ascending: false }).limit(2000));
  const today = new Date().toISOString().slice(0, 10);
  const depts = [...new Set(all.map((t) => t.department).filter(Boolean))].sort();
  const f = { status: '', dept: '', q: '', urgent: false, from: '', to: '' };

  const count = (pred) => all.filter(pred).length;
  const tiles = h('div', { class: 'grid tiles' },
    tile('Awaiting approval', count((t) => t.status === 'pending_approval')),
    tile('Urgent & pending', count((t) => t.status === 'pending_approval' && t.is_urgent), true),
    tile('Approved, to book', count((t) => t.status === 'approved')),
    tile('Upcoming booked', count((t) => t.status === 'booked' && t.start_date >= today)),
    tile('Approved spend', money(all.filter((t) => ['approved', 'booked'].includes(t.status)).reduce((a, t) => a + Number(t.total_estimate), 0))));

  const tbody = h('tbody');
  const shown = h('span', { class: 'muted small' });
  const filtered = () =>
    all.filter((t) =>
      (!f.status || t.status === f.status) &&
      (!f.dept || t.department === f.dept) &&
      (!f.urgent || t.is_urgent) &&
      (!f.from || t.end_date >= f.from) &&
      (!f.to || t.start_date <= f.to) &&
      (!f.q || [t.title, t.destination, t.traveller_name, t.booking_ref, t.traveller_email].join(' ').toLowerCase().includes(f.q.toLowerCase())));

  const draw = () => {
    const rows = filtered();
    shown.textContent = `${rows.length} of ${all.length} trips`;
    tbody.replaceChildren(...(rows.length ? rows.map((t) =>
      h('tr', { class: 'clickable', onclick: () => (location.hash = `#/trip/${t.id}`) },
        h('td', {}, `#${t.id}`),
        h('td', {}, h('strong', {}, t.traveller_name), h('div', { class: 'muted small' }, `${t.grade} · ${t.department || '—'}`)),
        h('td', {}, t.title, h('div', { class: 'muted small' }, t.destination)),
        h('td', { class: 'nowrap' }, fmtDate(t.start_date), h('div', { class: 'muted small' }, `to ${fmtDate(t.end_date)}`)),
        h('td', { class: 'nowrap' }, money(t.total_estimate)),
        h('td', {}, t.approver_name || t.manager_name || '—'),
        h('td', {}, t.booking_ref || '—'),
        h('td', {}, tripBadges(t))))
      : [h('tr', {}, h('td', { colspan: '8', class: 'empty' }, 'No trips match these filters.'))]));
  };

  const on = (k) => (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw(); };
  const exportCsv = () => download(`traveldesk-bookings-${today}.csv`, toCSV(filtered(), [
    ['id', 'Trip ID'], ['traveller_name', 'Traveller'], ['traveller_email', 'Email'], ['department', 'Department'],
    ['grade', 'Band'], ['title', 'Title'], ['destination', 'Destination'], ['start_date', 'Start'], ['end_date', 'End'],
    ['status', 'Status', (r) => STATUS[r.status]], ['is_urgent', 'Urgent', (r) => (r.is_urgent ? 'Yes' : 'No')],
    ['is_international', 'Foreign', (r) => (r.is_international ? 'Yes' : 'No')],
    ['violations', 'Policy exceptions', (r) => (r.violations || []).map((v) => v.message).join(' | ')],
    ['total_estimate', 'Estimate'], ['manager_name', 'Manager'], ['approver_name', 'Decided by'],
    ['booking_ref', 'Booking ref'], ['created_at', 'Submitted'],
  ]));

  mount(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'All bookings'), h('div', { class: 'muted' }, 'Every trip across the company')),
      h('button', { onclick: exportCsv }, '⬇ Export CSV')),
    tiles,
    h('div', { class: 'card' },
      h('div', { class: 'filters' },
        field('Search', h('input', { placeholder: 'Traveller, trip, city, PNR…', oninput: on('q') })),
        field('Status', select({ '': 'All statuses', ...STATUS }, '', { onchange: on('status') })),
        field('Department', select(Object.fromEntries([['', 'All departments'], ...depts.map((d) => [d, d])]), '', { onchange: on('dept') })),
        field('Travelling from', h('input', { type: 'date', onchange: on('from') })),
        field('Travelling to', h('input', { type: 'date', onchange: on('to') })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: on('urgent') }), 'Urgent only')),
      shown,
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['ID', 'Traveller', 'Trip', 'Dates', 'Estimate', 'Approver', 'Booking ref', 'Status'].map((c) => h('th', {}, c)))),
        tbody)))
  );
  draw();
}

function tile(label, value, alert = false) {
  return h('div', { class: `card tile${alert && value ? ' alert' : ''}` }, h('div', { class: 'num' }, value), h('div', { class: 'lbl' }, label));
}

// ---------------------------------------------------------------- admin: people
async function viewAdminUsers() {
  const [people, bands] = await Promise.all([
    call(sb.from('profiles').select('*').order('full_name')),
    call(sb.from('policies').select('grade, label, rank').not('rank', 'is', null).order('rank')),
  ]);
  const bandOpts = Object.fromEntries(bands.map((b) => [b.grade, `${b.grade} — ${b.label}`]));
  const managerOpts = (self) => Object.fromEntries([['', '— none —'], ...people.filter((p) => p.id !== self && p.active).map((p) => [p.id, p.full_name])]);

  const rows = people.map((p) => {
    const st = { full_name: p.full_name, role: p.role, grade: p.grade, department: p.department, manager_id: p.manager_id || '', active: p.active };
    const set = (k) => (e) => { st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const save = h('button', { class: 'primary', onclick: async () => {
      save.disabled = true;
      try {
        await call(sb.rpc('admin_update_profile', { p_id: p.id, p: st }));
        toast(`Saved ${st.full_name}`);
        if (p.id === ctx.user.id) await loadContext();
      } finally {
        save.disabled = false;
      }
    } }, 'Save');
    return h('tr', {},
      h('td', {}, h('input', { value: p.full_name, oninput: set('full_name') }), h('div', { class: 'muted small' }, p.email)),
      h('td', {}, select(ROLE_LABEL, p.role, { onchange: set('role') })),
      h('td', {}, select(bandOpts[p.grade] ? bandOpts : { [p.grade]: p.grade, ...bandOpts }, p.grade, { onchange: set('grade') })),
      h('td', {}, h('input', { value: p.department, oninput: set('department'), placeholder: 'e.g. Sales' })),
      h('td', {}, select(managerOpts(p.id), p.manager_id || '', { onchange: set('manager_id') })),
      h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: p.active, onchange: set('active'), style: 'width:auto' })),
      h('td', {}, save));
  });

  mount(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'People'),
        h('div', { class: 'muted' }, 'New employees sign up with their work email, then appear here. Assign their band and reporting manager.'))),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Name', 'Role', 'Band', 'Department', 'Reporting manager', 'Active', ''].map((c) => h('th', {}, c)))),
      h('tbody', {}, rows))))
  );
}

// ---------------------------------------------------------------- admin: policy & settings
async function viewAdminPolicy() {
  const [bands, cities, settings] = await Promise.all([
    call(sb.from('policies').select('*').not('rank', 'is', null).order('rank')),
    call(sb.from('cities').select('*').order('category').order('name')),
    call(sb.from('settings').select('*').single()),
  ]);
  ctx.settings = settings;

  // Settings
  const st = { ...settings };
  const num = (k, attrs = {}) => h('input', { type: 'number', min: '0', value: st[k], oninput: (e) => (st[k] = e.target.value), ...attrs });
  const txt = (k, attrs = {}) => h('input', { value: st[k], oninput: (e) => (st[k] = e.target.value), ...attrs });
  const settingsCard = h('div', { class: 'card' },
    h('h2', {}, 'General rules'),
    h('div', { class: 'row' },
      field('Company name', txt('company_name')),
      field('Currency', txt('currency', { maxlength: '3' })),
      field('Time zone', txt('timezone')),
      field('Allowed sign-up email domain', txt('allowed_email_domain', { placeholder: 'e.g. highspirit.in (blank = any)' }))),
    h('div', { class: 'row' },
      field('Domestic notice (days)', num('domestic_advance_days')),
      field('Foreign notice (days)', num('international_advance_days')),
      field('Air allowed above (surface hours)', num('air_min_surface_hours', { step: '0.5' })),
      field('Laundry / day', num('laundry_per_day')),
      field('Laundry from day', num('laundry_from_day', { min: '1' }))),
    h('label', { class: 'check field' },
      h('input', { type: 'checkbox', checked: st.require_approval_all, onchange: (e) => (st.require_approval_all = e.target.checked) }),
      'All trips require Reporting Manager approval (otherwise only urgent / short-notice / out-of-policy / foreign trips do)'),
    h('button', { class: 'primary', onclick: async () => {
      await call(sb.rpc('update_settings', { p: st }));
      ctx.settings = await call(sb.from('settings').select('*').single());
      toast('Settings saved');
    } }, 'Save rules'));

  // Bands
  const bandRow = (b) => {
    const st = { ...b };
    const set = (k) => (e) => { st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const n = (k) => h('input', { type: 'number', min: '0', value: b[k], oninput: set(k), style: 'width:90px' });
    return h('tr', {},
      h('td', {}, h('strong', {}, b.grade)),
      h('td', {}, h('input', { value: b.label, oninput: set('label') })),
      h('td', {}, select(RAIL, b.rail_max_class, { onchange: set('rail_max_class') })),
      h('td', {}, select(ROAD, b.road_max_mode, { onchange: set('road_max_mode') })),
      h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: b.own_vehicle_allowed, onchange: set('own_vehicle_allowed'), style: 'width:auto' })),
      h('td', {}, n('hotel_cap_a')), h('td', {}, n('hotel_cap_b')), h('td', {}, n('hotel_cap_c')), h('td', {}, n('meal_cap_per_day')),
      h('td', {}, h('button', { onclick: async () => {
        await call(sb.rpc('upsert_policy', { p: st }));
        toast(`Band ${b.grade} saved`);
        if (b.grade === ctx.profile.grade) ctx.policy = await call(sb.from('policies').select('*').eq('grade', b.grade).single());
      } }, 'Save')));
  };

  // Cities
  const cityName = h('input', { placeholder: 'City name' });
  const cityCat = select({ A: 'Category A', B: 'Category B', C: 'Category C (default)' }, 'B');
  const cityCard = h('div', { class: 'card' },
    h('h2', {}, 'City categories'),
    h('p', { class: 'muted small' }, 'Cities not listed are category C. Add alternative spellings (e.g. Bengaluru / Bangalore) as separate entries.'),
    h('div', { class: 'filters' },
      field('City', cityName), field('Category', cityCat),
      h('div', { class: 'field' }, h('button', { class: 'primary', onclick: async () => {
        await call(sb.rpc('upsert_city', { p_name: cityName.value, p_category: cityCat.value }));
        toast('City saved');
        router();
      } }, 'Save city'))),
    ['A', 'B'].map((cat) => h('p', {}, h('strong', {}, `Category ${cat}: `),
      cities.filter((c) => c.category === cat).map((c) => c.name.replace(/\b\w/g, (x) => x.toUpperCase())).join(', '))));

  mount(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Travel policy'), h('div', { class: 'muted' }, 'Travel & Expense Policy V5 (effective 1 Aug 2026) — edit to keep the portal in sync'))),
    settingsCard,
    h('div', { class: 'card' },
      h('h2', {}, 'Band entitlements'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Band', 'Designations', 'Rail up to', 'Road up to', 'Own vehicle', 'Hotel A', 'Hotel B', 'Hotel C', 'Meals/day', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, bands.map(bandRow))))),
    cityCard
  );
}

// ---------------------------------------------------------------- boot
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    Object.assign(ctx, { user: null, profile: null, policy: null });
  } else if (session?.user && ctx.user?.id !== session.user.id) {
    ctx.user = session.user;
    ctx.profile = null;
  }
});

window.addEventListener('hashchange', router);
(async () => {
  const { data } = await sb.auth.getSession();
  ctx.user = data.session?.user || null;
  router();
})();
