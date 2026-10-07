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

// ---------------------------------------------------------------- search suggestions
// Airport codes for common Indian business destinations (used to pre-fill flight searches).
const IATA = {
  mumbai: 'BOM', bombay: 'BOM', 'navi mumbai': 'BOM', thane: 'BOM',
  delhi: 'DEL', 'new delhi': 'DEL', gurgaon: 'DEL', gurugram: 'DEL', noida: 'DEL', ghaziabad: 'DEL', faridabad: 'DEL',
  bangalore: 'BLR', bengaluru: 'BLR', chennai: 'MAA', madras: 'MAA', kolkata: 'CCU', calcutta: 'CCU',
  hyderabad: 'HYD', secunderabad: 'HYD', pune: 'PNQ', ahmedabad: 'AMD', gandhinagar: 'AMD', goa: 'GOI', panaji: 'GOI',
  jaipur: 'JAI', lucknow: 'LKO', kochi: 'COK', cochin: 'COK', thiruvananthapuram: 'TRV', trivandrum: 'TRV',
  guwahati: 'GAU', bhubaneswar: 'BBI', cuttack: 'BBI', patna: 'PAT', nagpur: 'NAG', indore: 'IDR', chandigarh: 'IXC',
  srinagar: 'SXR', amritsar: 'ATQ', jalandhar: 'ATQ', varanasi: 'VNS', coimbatore: 'CJB', visakhapatnam: 'VTZ',
  vizag: 'VTZ', ranchi: 'IXR', raipur: 'RPR', bhopal: 'BHO', vadodara: 'BDQ', baroda: 'BDQ', surat: 'STV',
  udaipur: 'UDR', mangalore: 'IXE', mangaluru: 'IXE', madurai: 'IXM', dehradun: 'DED', leh: 'IXL',
  'port blair': 'IXZ', jammu: 'IXJ', siliguri: 'IXB', bagdogra: 'IXB', imphal: 'IMF', agartala: 'IXA',
  rajkot: 'RAJ', aurangabad: 'IXU', vijayawada: 'VGA', tirupati: 'TIR', jodhpur: 'JDH', kanpur: 'KNU',
  agra: 'AGR', gwalior: 'GWL', nashik: 'ISK', nasik: 'ISK', shillong: 'SHL', dibrugarh: 'DIB', hubli: 'HBX',
  belgaum: 'IXG', belagavi: 'IXG', mysore: 'MYQ', mysuru: 'MYQ', kozhikode: 'CCJ', calicut: 'CCJ', tiruchirappalli: 'TRZ',
};

const cityKey = (s) => String(s || '').toLowerCase().replace(/\s*\(.*\)\s*/g, ' ').trim();

// ---------------------------------------------------------------- geography
// Places (city coordinates) and airports, loaded once. Used to estimate rail/road journey time
// (same formula as public.surface_hours in the database) and to find the nearest airports.
const geo = { places: {}, airports: [], loaded: null };
function loadGeo() {
  geo.loaded ||= Promise.all([
    call(sb.from('places').select('name, lat, lon, state')),
    call(sb.from('airports').select('*')),
  ]).then(([places, airports]) => {
    geo.places = Object.fromEntries(places.map((p) => [p.name, p]));
    geo.airports = airports;
  });
  return geo.loaded;
}

function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const placeOf = (city) => geo.places[cityKey(city)] || null;

/** { km, hours } by rail/road between two known cities, or null. */
function surfaceEstimate(from, to) {
  const a = placeOf(from);
  const b = placeOf(to);
  if (!a || !b) return null;
  const factor = Number(ctx.settings?.road_factor) || 1.3;
  const speed = Number(ctx.settings?.surface_speed_kmph) || 50;
  const km = kmBetween(a, b) * factor;
  return { km: Math.round(km), hours: Math.round((km / speed) * 10) / 10 };
}

/** Airports sorted by distance from a city: [{ iata, name, km }]. */
function nearestAirports(city, limit = 3, maxKm = 300) {
  const p = placeOf(city);
  if (!p) return [];
  return geo.airports
    .map((a) => ({ ...a, km: Math.round(kmBetween(p, a)) }))
    .filter((a) => a.km <= maxKm)
    .sort((x, y) => x.km - y.km)
    .slice(0, limit);
}

/** IATA code if the city has its own airport (within 40 km), else null. */
function airportOf(city) {
  const near = nearestAirports(city, 1, 40)[0];
  return near?.iata || IATA[cityKey(city)] || null;
}

/** City name to use for an airport, e.g. "Bagdogra (Siliguri)" → "Siliguri". */
const airportCity = (a) => (a.name.match(/\(([^)]+)\)/)?.[1] || a.name).replace(/\s*\(.*\)/, '');
const slug = (s) => cityKey(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const enc = encodeURIComponent;
const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** Pre-filled search links on booking sites for one itinerary item. Returns [[label, url], …]. */
function searchLinks(sg, isIntl) {
  const from = sg.from_loc?.trim();
  const to = sg.to_loc?.trim();
  const date = sg.start_date;
  const out = [];
  if (sg.type === 'flight' && from && to) {
    out.push(['Google Flights', `https://www.google.com/travel/flights?q=${enc(`Flights from ${from} to ${to}${date ? ' on ' + date : ''} one way economy`)}`]);
    const a = airportOf(from) || nearestAirports(from, 1, 150)[0]?.iata;
    const b = airportOf(to) || nearestAirports(to, 1, 150)[0]?.iata;
    if (a && b && date && !isIntl) {
      out.push(['MakeMyTrip', `https://www.makemytrip.com/flight/search?itinerary=${a}-${b}-${dmy(date)}&tripType=O&paxType=A-1_C-0_I-0&intl=false&cabinClass=E`]);
      out.push(['Cleartrip', `https://www.cleartrip.com/flights/results?adults=1&childs=0&infants=0&class=Economy&depart_date=${dmy(date)}&from=${a}&to=${b}&intl=n`]);
    }
  }
  if (sg.type === 'train' && from && to) {
    out.push(['Trains on Google', `https://www.google.com/search?q=${enc(`trains from ${from} to ${to}${date ? ' on ' + fmtDate(date) : ''}`)}`]);
    out.push(['IRCTC', 'https://www.irctc.co.in/nget/train-search']);
  }
  if (sg.type === 'bus' && from && to) {
    out.push(['redBus', `https://www.redbus.in/bus-tickets/${slug(from)}-to-${slug(to)}`]);
  }
  if (sg.type === 'hotel' && to) {
    const dates = date && sg.end_date ? `&checkin=${date}&checkout=${sg.end_date}` : '';
    out.push(['Booking.com', `https://www.booking.com/searchresults.html?ss=${enc(to)}${dates}&group_adults=1&no_rooms=1&group_children=0`]);
    out.push(['Google Hotels', `https://www.google.com/travel/hotels?q=${enc(`hotels in ${to}`)}`]);
  }
  if (sg.type === 'cab' && from && to) {
    out.push(['Route on Google Maps', `https://www.google.com/maps/dir/${enc(from)}/${enc(to)}`]);
  }
  return out;
}

function nightsBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000));
}

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
  $app.replaceChildren(...nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
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
    t.traveller_count > 1 ? h('span', { class: 'badge intl' }, `Group of ${t.traveller_count}`) : null,
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
  return rows.filter((t) => !(t.traveller_ids || []).includes(ctx.user.id) && (t.manager_id === ctx.user.id || (isAdmin() && !t.manager_id)));
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
    isAdmin() ? ['#/admin/hotels', 'Preferred Hotels'] : null,
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
    if (a === 'admin' && b === 'hotels') return await viewAdminHotels();
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
  const trips = await call(sb.from('trips_view').select('*').contains('traveller_ids', [ctx.user.id]).order('start_date', { ascending: false }));
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
function blankSegment(type, date, extra = {}) {
  return {
    type, from_loc: '', to_loc: '', start_date: date || '', end_date: '', travel_class: '',
    duration_hours: '', est_cost: '', rooms: '1', notes: '', ...extra,
  };
}

async function viewNewTrip() {
  if (!ctx.policy || ctx.policy.rank === null) {
    return mount(h('div', { class: 'card empty' }, 'No travel policy is configured for your band yet. Please contact the travel desk.'));
  }
  const s = ctx.settings;
  const maxH = Number(s.air_min_surface_hours);
  const state = {
    title: '', purpose: '', origin: '', destination: '', start_date: '', end_date: '',
    is_international: false, is_urgent: false, urgency_reason: '', justification: '',
    traveller_ids: [],
    segments: [],
  };
  let lastCheck = null;
  let timer;

  const [, cities, hotels, people] = await Promise.all([
    loadGeo(),
    call(sb.from('cities').select('name, category').order('name')),
    call(sb.from('preferred_hotels').select('*').eq('active', true)),
    call(sb.from('profiles').select('id, full_name, grade, department').eq('active', true).neq('id', ctx.user.id).order('full_name')),
  ]);
  const cityCat = Object.fromEntries(cities.map((c) => [c.name, c.category]));
  const title = (n) => n.replace(/\b\w/g, (x) => x.toUpperCase());
  const allCities = [...new Set([...Object.keys(geo.places), ...cities.map((c) => c.name), ...hotels.map((x) => x.city)])].sort();
  const cityList = h('datalist', { id: 'city-list' }, allCities.map((c) => h('option', { value: title(c) })));
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]));

  const segWrap = h('div');
  const journey = h('div');
  const addBar = h('div', { class: 'actions' });
  const checkPanel = h('div', {}, h('p', { class: 'muted small' }, 'Fill in dates and itinerary to see the policy check.'));
  const urgentReason = h('textarea', { placeholder: 'Why must this trip happen urgently?', oninput: (e) => { state.urgency_reason = e.target.value; } });
  const urgentField = field('Urgency reason', urgentReason, 'Urgent trips always go to your reporting manager.', true);
  urgentField.hidden = true;
  const justification = h('textarea', { placeholder: 'Business justification for the exception / short notice', oninput: (e) => { state.justification = e.target.value; } });
  const justField = field('Justification for special approval', justification, null, true);
  justField.hidden = true;
  const submitBtn = h('button', { class: 'primary', type: 'submit' }, 'Submit for approval');

  const bind = (key, el, evt = 'input', after) => {
    el.addEventListener(evt, () => {
      state[key] = el.type === 'checkbox' ? el.checked : el.value;
      after?.();
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
      rooms: sg.type === 'hotel' ? Math.max(1, Number(sg.rooms) || 1) : 1,
      end_date: sg.end_date || null,
    }));
    const { segments: _omit, ...trip } = state;
    void _omit;
    return { trip, segments };
  }

  const groupSize = () => 1 + state.traveller_ids.length;

  // ---------- travellers
  const travellersBox = h('div');
  function renderTravellers() {
    const pick = select(
      Object.fromEntries([['', '+ Add a colleague…'], ...people.filter((p) => !state.traveller_ids.includes(p.id))
        .map((p) => [p.id, `${p.full_name} (${p.grade}${p.department ? ', ' + p.department : ''})`])]),
      '',
      { onchange: (e) => { if (e.target.value) { state.traveller_ids.push(e.target.value); renderTravellers(); renderSegments(); scheduleCheck(); } } }
    );
    travellersBox.replaceChildren(
      h('div', { class: 'links', style: 'margin-bottom:8px' },
        h('span', { class: 'chip' }, `${ctx.profile.full_name} (${ctx.profile.grade}) · organiser`),
        state.traveller_ids.map((id) => h('span', { class: 'chip' },
          `${peopleById[id]?.full_name || 'Colleague'} (${peopleById[id]?.grade || '?'}) `,
          h('button', { type: 'button', class: 'link', title: 'Remove', onclick: () => {
            state.traveller_ids = state.traveller_ids.filter((x) => x !== id);
            renderTravellers(); renderSegments(); scheduleCheck();
          } }, '✕')))),
      pick,
      h('div', { class: 'hint' }, groupSize() > 1
        ? `One request for all ${groupSize()} travellers — your manager approves once. Each person's band is still checked. Enter costs for the whole group.`
        : 'Travelling with colleagues? Add them here and book everyone in one request.'));
  }

  // ---------- journey: distance, allowed modes, nearest airports
  function airAllowedFor(from, to) {
    if (state.is_international) return { allowed: true };
    const est = surfaceEstimate(from, to);
    if (!est) return { allowed: null };
    return { allowed: est.hours > maxH, est };
  }

  function planViaAirport(airport) {
    const date = state.start_date;
    const segs = [];
    const fromAir = airportOf(state.origin) ? null : nearestAirports(state.origin, 1, 300)[0];
    if (fromAir) {
      segs.push(blankSegment('cab', date, { from_loc: title(cityKey(state.origin)), to_loc: airportCity(fromAir), travel_class: 'economy_cab', notes: `To ${fromAir.name} airport (${fromAir.iata})` }));
    }
    segs.push(blankSegment('flight', date, { from_loc: fromAir ? airportCity(fromAir) : title(cityKey(state.origin)), to_loc: airportCity(airport) }));
    if (cityKey(airportCity(airport)) !== cityKey(state.destination)) {
      segs.push(blankSegment('cab', date, { from_loc: airportCity(airport), to_loc: title(cityKey(state.destination)), travel_class: 'economy_cab', notes: `From ${airport.name} airport (${airport.iata})` }));
    }
    state.segments = state.segments.filter((x) => x.from_loc || x.to_loc || x.est_cost).concat(segs);
    renderSegments();
    scheduleCheck();
    toast(`Added flight to ${airportCity(airport)}${segs.length > 1 ? ' with road connections' : ''}`);
  }

  function renderJourney() {
    const parts = [];
    if (state.origin.trim() && state.destination.trim()) {
      const est = surfaceEstimate(state.origin, state.destination);
      if (state.is_international) {
        parts.push(h('div', { class: 'notice info' }, 'Foreign travel: flights are booked by the travel desk (45 days notice).'));
      } else if (!est) {
        parts.push(h('div', { class: 'notice info' },
          `We don't have map data for ${!placeOf(state.origin) ? state.origin : state.destination} yet, so enter the rail/road journey time on any flight. (The travel desk can add the town under Travel Policy.)`));
      } else if (est.hours > maxH) {
        parts.push(h('div', { class: 'notice ok' },
          `${title(cityKey(state.origin))} → ${title(cityKey(state.destination))}: about ${est.km.toLocaleString('en-IN')} km, ~${est.hours} h by rail/road. Air travel is allowed (journey over ${maxH} h).`));
      } else {
        parts.push(h('div', { class: 'notice warn' },
          `${title(cityKey(state.origin))} → ${title(cityKey(state.destination))}: about ${est.km.toLocaleString('en-IN')} km, ~${est.hours} h by rail/road. `,
          h('strong', {}, `Flights aren't allowed`), ` for journeys up to ${maxH} h — choose train, bus or cab.`));
      }

      const air = airAllowedFor(state.origin, state.destination);
      if (air.allowed !== false && !state.is_international && placeOf(state.destination) && !airportOf(state.destination)) {
        const near = nearestAirports(state.destination, 3, 250);
        if (near.length) {
          parts.push(h('div', { class: 'notice info' },
            h('strong', {}, `${title(cityKey(state.destination))} has no airport.`), ' Nearest airports:',
            h('div', { class: 'links', style: 'margin-top:6px' },
              near.map((a) => h('button', { type: 'button', onclick: () => planViaAirport(a) },
                `✈ Fly to ${airportCity(a)} (${a.iata}, ~${a.km} km) + cab`)))));
        }
      } else if (air.allowed === true && !state.is_international && airportOf(state.destination) && !state.segments.some((x) => x.type === 'flight')) {
        const a = nearestAirports(state.destination, 1, 40)[0];
        if (a) parts.push(h('div', { class: 'links' }, h('button', { type: 'button', onclick: () => planViaAirport(a) }, `✈ Add flight to ${airportCity(a)} (${a.iata})`)));
      }
    }
    journey.replaceChildren(...parts);
    renderAddBar();
  }

  function renderAddBar() {
    const air = state.origin && state.destination ? airAllowedFor(state.origin, state.destination) : { allowed: null };
    addBar.replaceChildren(
      ...['train', 'flight', 'hotel', 'cab', 'bus'].map((t) =>
        h('button', {
          type: 'button',
          disabled: t === 'flight' && air.allowed === false,
          title: t === 'flight' && air.allowed === false ? `Not allowed: ~${air.est.hours} h by rail/road (policy: air only above ${maxH} h)` : '',
          onclick: () => addSegment(t),
        }, `+ ${SEG_TYPES[t]}`)));
  }

  function addSegment(t) {
    const last = state.segments[state.segments.length - 1];
    const date = last?.end_date || last?.start_date || state.start_date;
    const extra = { travel_class: t === 'train' ? ctx.policy.rail_max_class : t === 'cab' ? 'economy_cab' : '' };
    if (t === 'hotel') Object.assign(extra, { to_loc: title(cityKey(state.destination)), end_date: state.end_date, rooms: String(groupSize()) });
    else if (!state.segments.length) Object.assign(extra, { from_loc: title(cityKey(state.origin)), to_loc: title(cityKey(state.destination)) });
    state.segments.push(blankSegment(t, date, extra));
    renderSegments();
    scheduleCheck();
  }

  // ---------- policy panel
  function renderCheck(c) {
    justField.hidden = !c.needs_justification;
    submitBtn.textContent = c.requires_approval ? 'Submit for manager approval' : 'Submit';
    const v = c.violations || [];
    checkPanel.replaceChildren(
      v.length
        ? h('div', { class: 'notice bad' }, h('strong', {}, `${v.length} policy exception${v.length > 1 ? 's' : ''}`), h('ul', {}, v.map((x) => h('li', {}, x.message))))
        : h('div', { class: 'notice ok' }, `✓ Itinerary is within ${c.traveller_count > 1 ? 'every traveller\'s' : 'your'} band entitlement`),
      c.short_notice
        ? h('div', { class: 'notice warn' }, `Short notice: ${c.days_until_travel} day(s) before travel. Policy asks for ${c.advance_days_required} days — special approval with justification is required.`)
        : null,
      c.requires_approval
        ? h('div', { class: 'notice info' }, h('strong', {}, 'Approval needed'), h('ul', {}, (c.reasons || []).map((r) => h('li', {}, r))))
        : h('div', { class: 'notice ok' }, 'No approval needed — this trip will be approved automatically.'),
      h('dl', { class: 'kv' },
        c.traveller_count > 1 ? [h('dt', {}, 'Travellers'), h('dd', {}, `${c.traveller_count}: ${c.traveller_names}`)] : null,
        h('dt', {}, 'Itinerary estimate'), h('dd', {}, money(c.total)),
        h('dt', {}, 'Trip length'), h('dd', {}, `${c.trip_days} day(s)`),
        h('dt', {}, 'Meals (on actuals)'), h('dd', {}, `up to ${money(c.meal_cap_per_day)}/day per person · ${money(c.meal_budget)}`),
        c.laundry_allowance > 0 ? [h('dt', {}, 'Laundry'), h('dd', {}, `up to ${money(c.laundry_allowance)} per person`)] : null,
        (c.hotels || []).map((ht) => [
          h('dt', {}, `Hotel (item ${ht.item})`),
          h('dd', {}, ht.category
            ? `${ht.city || '—'}: cat. ${ht.category}, cap ${money(ht.cap)}/night per room, you entered ${money(ht.per_night)}/night × ${ht.rooms || 1} room(s)`
            : `${ht.city || '—'}: foreign — cap agreed with manager & travel desk`),
        ])
      )
    );
  }

  // ---------- itinerary items
  function renderSegments() {
    segWrap.replaceChildren(
      ...(state.segments.length ? [] : [h('p', { class: 'muted small' }, 'Add your first item below. Fill in "Travelling from" and "Main destination" above for smart suggestions.')]),
      ...state.segments.map((sg, i) => {
        const sugg = h('div', { class: 'suggest' });
        const isHotel = sg.type === 'hotel';
        const durationInput = h('input', { type: 'number', min: '0', step: '0.5', value: sg.duration_hours, oninput: (e) => { sg.duration_hours = e.target.value; scheduleCheck(); } });
        const durationField = sg.type === 'flight' && !state.is_international
          ? field('Rail/road journey time (hours)', durationInput, `We couldn't estimate this route. Air is allowed only above ${maxH} h.`, true)
          : null;
        const refreshSugg = () => {
          if (durationField) {
            const known = !!surfaceEstimate(sg.from_loc, sg.to_loc);
            durationField.hidden = known;
            if (known) sg.duration_hours = '';
          }
          sugg.replaceChildren(...suggestions(sg, i));
        };
        const set = (k) => (e) => { sg[k] = e.target.value; refreshSugg(); scheduleCheck(); };
        const typeSel = select(SEG_TYPES, sg.type, {
          onchange: (e) => {
            sg.type = e.target.value;
            sg.travel_class = sg.type === 'train' ? ctx.policy.rail_max_class : sg.type === 'cab' ? 'economy_cab' : '';
            renderSegments();
            scheduleCheck();
          },
        });
        const classInput =
          sg.type === 'train'
            ? field('Class', select({ '': '— select —', ...RAIL }, sg.travel_class, { onchange: set('travel_class') }), `Your entitlement: up to ${RAIL[ctx.policy.rail_max_class]}`)
            : sg.type === 'cab'
              ? field('Mode', select(CAB_CLASSES, sg.travel_class || 'economy_cab', { onchange: set('travel_class') }), `Your entitlement: ${ROAD[ctx.policy.road_max_mode]}${ctx.policy.own_vehicle_allowed ? ' or own vehicle' : ''}`)
              : null;
        const el = h('div', { class: 'segment' },
          h('div', { class: 'seg-head' },
            h('span', { class: 'seg-num' }, `ITEM ${i + 1}`),
            h('button', { type: 'button', class: 'link', onclick: () => { state.segments.splice(i, 1); renderSegments(); renderAddBar(); scheduleCheck(); } }, 'Remove')),
          h('div', { class: 'row' },
            field('Type', typeSel),
            isHotel ? null : field('From', h('input', { value: sg.from_loc, oninput: set('from_loc'), placeholder: 'City', list: 'city-list' })),
            field(isHotel ? 'Hotel city' : 'To', h('input', { value: sg.to_loc, oninput: set('to_loc'), placeholder: 'City', list: 'city-list' }),
              isHotel ? 'City category (A/B/C) sets the hotel cap' : null, isHotel),
            field(isHotel ? 'Check-in' : 'Date', h('input', { type: 'date', value: sg.start_date, oninput: set('start_date') }), null, true),
            isHotel ? field('Check-out', h('input', { type: 'date', value: sg.end_date, oninput: set('end_date') }), null, true) : null,
            isHotel ? field('Rooms', h('input', { type: 'number', min: '1', max: '50', value: sg.rooms, oninput: set('rooms') })) : null,
            classInput,
            durationField,
            field(isHotel ? 'Total cost (all rooms, all nights)' : groupSize() > 1 ? 'Estimated cost (whole group)' : 'Estimated cost',
              h('input', { type: 'number', min: '0', step: '1', value: sg.est_cost, oninput: set('est_cost') }))),
          field('Notes', h('input', { value: sg.notes, oninput: set('notes'), placeholder: 'Preferred timing, train/flight no., hotel name…' })),
          sugg);
        refreshSugg();
        return el;
      })
    );
  }

  // Per-item suggestions: allowed-mode warning, nearest airports, search links, preferred hotels.
  function suggestions(sg, idx) {
    const parts = [];
    if (sg.type === 'flight' && !state.is_international && sg.from_loc?.trim() && sg.to_loc?.trim()) {
      const est = surfaceEstimate(sg.from_loc, sg.to_loc);
      if (est && est.hours <= maxH) {
        parts.push(h('div', { class: 'notice warn' },
          `${sg.from_loc} → ${sg.to_loc} is ~${est.hours} h by rail/road — flights are only allowed above ${maxH} h. `,
          h('button', { type: 'button', onclick: () => {
            Object.assign(sg, { type: 'train', travel_class: ctx.policy.rail_max_class, duration_hours: '' });
            renderSegments(); scheduleCheck();
          } }, 'Switch to train'), ' ',
          h('button', { type: 'button', onclick: () => {
            Object.assign(sg, { type: 'cab', travel_class: 'economy_cab', duration_hours: '' });
            renderSegments(); scheduleCheck();
          } }, 'Switch to cab')));
      } else if (est) {
        parts.push(h('div', { class: 'muted small' }, `~${est.km.toLocaleString('en-IN')} km, ~${est.hours} h by rail/road — air travel allowed.`));
      }
      for (const [end, label] of [['to_loc', 'arrival'], ['from_loc', 'departure']]) {
        const city = sg[end];
        if (placeOf(city) && !airportOf(city)) {
          const near = nearestAirports(city, 3, 250);
          if (near.length) {
            parts.push(h('div', { class: 'links' },
              h('span', { class: 'muted small' }, `${city} has no airport — use ${label} airport: `),
              near.map((a) => h('button', { type: 'button', onclick: () => {
                const town = sg[end];
                sg[end] = airportCity(a);
                const road = end === 'to_loc'
                  ? blankSegment('cab', sg.start_date, { from_loc: airportCity(a), to_loc: town, travel_class: 'economy_cab', notes: `From ${a.name} airport (${a.iata})` })
                  : blankSegment('cab', sg.start_date, { from_loc: town, to_loc: airportCity(a), travel_class: 'economy_cab', notes: `To ${a.name} airport (${a.iata})` });
                state.segments.splice(end === 'to_loc' ? idx + 1 : idx, 0, road);
                renderSegments(); scheduleCheck();
                toast(`Flight now ${end === 'to_loc' ? 'lands at' : 'departs from'} ${airportCity(a)}; added a cab leg for ${town}`);
              } }, `${airportCity(a)} (${a.iata}) ~${a.km} km`))));
          }
        }
      }
    }

    const links = searchLinks(sg, state.is_international);
    if (links.length) {
      parts.push(h('div', { class: 'links' },
        h('span', { class: 'muted small' }, 'Check options: '),
        links.map(([label, url]) => h('a', { class: 'chip', href: url, target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗'))));
    }

    if (sg.type === 'hotel' && sg.to_loc?.trim()) {
      const key = cityKey(sg.to_loc);
      const list = hotels.filter((x) => x.city === key).sort((a, b) => a.rate_per_night - b.rate_per_night);
      const cat = state.is_international ? null : cityCat[key] || 'C';
      const cap = cat ? Number(ctx.policy[`hotel_cap_${cat.toLowerCase()}`]) : null;
      const nights = nightsBetween(sg.start_date, sg.end_date);
      const rooms = Math.max(1, Number(sg.rooms) || 1);
      if (groupSize() > 1) {
        parts.push(h('div', { class: 'muted small' }, 'Policy 6.2: colleagues of the same or similar band and the same gender travelling together share rooms.'));
      }
      if (list.length) {
        parts.push(h('div', { class: 'hotels' },
          h('div', { class: 'small' }, h('strong', {}, `Company preferred hotels in ${sg.to_loc.trim()}`),
            cap !== null ? h('span', { class: 'muted' }, ` · category ${cat}, your cap ${money(cap)}/night per room`) : null),
          list.map((ht) => {
            const within = cap === null || Number(ht.rate_per_night) <= cap;
            return h('div', { class: `hotel${within ? '' : ' over'}` },
              h('div', {},
                h('strong', {}, ht.name),
                ht.area ? h('span', { class: 'muted small' }, ` · ${ht.area}`) : null,
                h('div', { class: 'small' },
                  `${money(ht.rate_per_night)}/night`, ht.includes_breakfast ? ' · breakfast included' : '',
                  ' ', within ? h('span', { class: 'badge s-booked' }, 'Within your cap') : h('span', { class: 'badge oop' }, 'Above your cap')),
                ht.notes ? h('div', { class: 'muted small' }, ht.notes) : null),
              h('div', { class: 'actions' },
                ht.booking_url ? h('a', { class: 'chip', href: ht.booking_url, target: '_blank', rel: 'noopener noreferrer' }, 'Details ↗') : null,
                h('button', { type: 'button', onclick: () => {
                  sg.notes = `${ht.name}${ht.area ? ', ' + ht.area : ''} (company preferred hotel)`;
                  if (nights > 0) sg.est_cost = String(Number(ht.rate_per_night) * nights * rooms);
                  renderSegments();
                  scheduleCheck();
                  toast(nights > 0 ? `${ht.name} selected · ${nights} night(s) × ${rooms} room(s) = ${money(sg.est_cost)}` : `${ht.name} selected — add check-in/out dates to fill the cost`);
                } }, 'Use this hotel')));
          })));
      } else if (cap !== null) {
        parts.push(h('div', { class: 'muted small' }, `No company preferred hotel in ${sg.to_loc.trim()} yet · category ${cat}, your cap is ${money(cap)}/night per room.`));
      }
    }
    return parts;
  }

  // ---------- form
  const intl = bind('is_international', h('input', { type: 'checkbox' }), 'change', () => { renderJourney(); renderSegments(); });
  const urgent = bind('is_urgent', h('input', { type: 'checkbox' }), 'change', () => { urgentField.hidden = !urgent.checked; });

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
      field('Trip title', bind('title', h('input', { placeholder: 'e.g. Distributor visit – Muzaffarpur', required: true })), null, true),
      h('div', { class: 'row' },
        field('Travelling from', bind('origin', h('input', { list: 'city-list', placeholder: 'Your base city' }), 'input', renderJourney)),
        field('Main destination', bind('destination', h('input', { required: true, list: 'city-list' }), 'input', renderJourney), null, true),
        field('Start date', bind('start_date', h('input', { type: 'date', required: true })), null, true),
        field('End date', bind('end_date', h('input', { type: 'date', required: true })), null, true)),
      field('Purpose of travel', bind('purpose', h('textarea', { required: true, placeholder: 'Meetings, market visits, client, expected outcome…' })), null, true),
      h('div', { class: 'actions', style: 'gap:24px;margin-bottom:10px' },
        h('label', { class: 'check' }, intl, `Foreign travel (${s.international_advance_days} days notice)`),
        h('label', { class: 'check' }, urgent, 'This is an urgent trip')),
      urgentField,
      field("Who's travelling?", travellersBox)),
    h('div', { class: 'card' },
      h('h2', {}, 'Itinerary'),
      h('p', { class: 'muted small' }, 'Air and rail are booked only by the Travel Desk. Road travel may be booked by you after approval and reimbursed on actuals.'),
      journey,
      segWrap,
      addBar),
    h('div', { class: 'card' }, justField, h('div', { class: 'actions' }, submitBtn, h('a', { class: 'btn', href: '#/trips' }, 'Cancel')))
  );

  renderTravellers();
  renderJourney();
  renderSegments();
  mount(
    cityList,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Plan a trip'),
      h('div', { class: 'muted' }, `Band ${ctx.profile.grade} · Domestic trips need ${s.domestic_advance_days} days notice · Air only for journeys over ${maxH} h`))),
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
    const helper = segs
      .map((sg, i) => [i, searchLinks(sg, trip.is_international)])
      .filter(([, links]) => links.length);
    if (helper.length) {
      actions.push(h('div', { class: 'card' },
        h('h2', {}, 'Find & book'),
        h('p', { class: 'muted small' }, 'Pre-filled searches for each item in this itinerary.'),
        helper.map(([i, links]) => h('div', { class: 'links', style: 'margin-bottom:8px' },
          h('strong', { class: 'small' }, `${i + 1}. ${SEG_TYPES[segs[i].type]}: `),
          links.map(([label, url]) => h('a', { class: 'chip', href: url, target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗'))))));
    }
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
    const route = sg.type === 'hotel' ? `${sg.to_loc}${sg.city_category ? ` (cat. ${sg.city_category})` : ''}${sg.rooms > 1 ? ` · ${sg.rooms} rooms` : ''}` : [sg.from_loc, sg.to_loc].filter(Boolean).join(' → ');
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
            h('dt', {}, trip.traveller_count > 1 ? 'Organiser' : 'Traveller'), h('dd', {}, `${trip.traveller_name} (${trip.grade}${trip.department ? ', ' + trip.department : ''})`),
            trip.traveller_count > 1 ? [h('dt', {}, 'Travellers'), h('dd', {}, `${trip.traveller_count}: ${trip.traveller_names}`)] : null,
            trip.origin ? [h('dt', {}, 'From'), h('dd', {}, trip.origin)] : null,
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
                h('td', {}, h('strong', {}, t.traveller_name), t.traveller_count > 1 ? h('span', { class: 'muted small' }, ` +${t.traveller_count - 1}`) : null,
                  h('div', { class: 'muted small' }, t.traveller_count > 1 ? t.traveller_names : `${t.grade} · ${t.department || '—'}`)),
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
      (!f.q || [t.title, t.destination, t.origin, t.traveller_names, t.booking_ref, t.traveller_email].join(' ').toLowerCase().includes(f.q.toLowerCase())));

  const draw = () => {
    const rows = filtered();
    shown.textContent = `${rows.length} of ${all.length} trips`;
    tbody.replaceChildren(...(rows.length ? rows.map((t) =>
      h('tr', { class: 'clickable', onclick: () => (location.hash = `#/trip/${t.id}`) },
        h('td', {}, `#${t.id}`),
        h('td', {}, h('strong', {}, t.traveller_name), t.traveller_count > 1 ? h('span', { class: 'muted small' }, ` +${t.traveller_count - 1}`) : null,
                  h('div', { class: 'muted small' }, t.traveller_count > 1 ? t.traveller_names : `${t.grade} · ${t.department || '—'}`)),
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
    ['id', 'Trip ID'], ['traveller_name', 'Organiser'], ['traveller_names', 'All travellers'], ['traveller_count', 'Group size'], ['origin', 'From'], ['traveller_email', 'Email'], ['department', 'Department'],
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
    h('div', { class: 'row' },
      field('Average rail/road speed (km/h)', num('surface_speed_kmph', { step: '1', min: '10' }), 'Used to estimate journey time from distance'),
      field('Road distance factor', num('road_factor', { step: '0.05', min: '1' }), 'Road km ÷ straight-line km (≈1.3 in India)')),
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

  // Places on the map (for distance estimates and nearest airports)
  await loadGeo();
  const pl = { name: '', lat: '', lon: '', state: '' };
  const plInputs = {
    name: h('input', { placeholder: 'e.g. Sitamarhi', oninput: (e) => (pl.name = e.target.value) }),
    lat: h('input', { type: 'number', step: '0.0001', placeholder: '26.59', oninput: (e) => (pl.lat = e.target.value) }),
    lon: h('input', { type: 'number', step: '0.0001', placeholder: '85.49', oninput: (e) => (pl.lon = e.target.value) }),
    state: h('input', { placeholder: 'Bihar', oninput: (e) => (pl.state = e.target.value) }),
  };
  const lookup = async () => {
    if (!pl.name.trim()) return toast('Type the town name first', true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&addressdetails=1&q=${enc(pl.name)}`, { headers: { Accept: 'application/json' } });
      const [hit] = await res.json();
      if (!hit) return toast(`No match for "${pl.name}" — enter coordinates manually`, true);
      pl.lat = Number(hit.lat).toFixed(4);
      pl.lon = Number(hit.lon).toFixed(4);
      pl.state = hit.address?.state || pl.state;
      plInputs.lat.value = pl.lat;
      plInputs.lon.value = pl.lon;
      plInputs.state.value = pl.state;
      toast(`Found: ${hit.display_name.split(',').slice(0, 3).join(',')} — check and save`);
    } catch {
      toast('Lookup failed — enter coordinates manually (from Google Maps: right-click → copy coordinates)', true);
    }
  };
  const placesByState = {};
  for (const p of Object.values(geo.places)) (placesByState[p.state || 'Other'] ||= []).push(p.name);
  const placeCard = h('div', { class: 'card' },
    h('h2', {}, 'Towns on the map'),
    h('p', { class: 'muted small' },
      'Distance between known towns sets the rail/road journey time (flights only above the threshold above) and powers nearest-airport suggestions. ',
      `${Object.keys(geo.places).length} towns and ${geo.airports.length} airports are loaded. Add the towns your team visits.`),
    h('div', { class: 'filters' },
      field('Town', plInputs.name),
      h('div', { class: 'field' }, h('button', { type: 'button', onclick: lookup }, '🔎 Find coordinates')),
      field('Latitude', plInputs.lat), field('Longitude', plInputs.lon), field('State', plInputs.state),
      h('div', { class: 'field' }, h('button', { class: 'primary', onclick: async () => {
        await call(sb.rpc('upsert_place', { p_name: pl.name, p_lat: Number(pl.lat), p_lon: Number(pl.lon), p_state: pl.state }));
        geo.loaded = null;
        toast('Town saved');
        router();
      } }, 'Save town'))),
    h('details', {}, h('summary', { class: 'small' }, 'Show all towns'),
      Object.entries(placesByState).sort().map(([st, names]) =>
        h('p', { class: 'small' }, h('strong', {}, `${st}: `), names.sort().map((n) => n.replace(/\b\w/g, (x) => x.toUpperCase())).join(', ')))));

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
    cityCard,
    placeCard
  );
}

// ---------------------------------------------------------------- admin: preferred hotels
async function viewAdminHotels() {
  const [list, bands, cities] = await Promise.all([
    call(sb.from('preferred_hotels').select('*').order('city').order('rate_per_night')),
    call(sb.from('policies').select('grade, hotel_cap_a, hotel_cap_b, hotel_cap_c').not('rank', 'is', null).order('rank')),
    call(sb.from('cities').select('name, category')),
  ]);
  const cityCat = Object.fromEntries(cities.map((c) => [c.name, c.category]));
  const title = (s) => s.replace(/\b\w/g, (x) => x.toUpperCase());

  // Which bands can stay at this rate without an exception.
  const bandsWithin = (ht) => {
    const col = `hotel_cap_${(cityCat[ht.city] || 'C').toLowerCase()}`;
    const ok = bands.filter((b) => Number(ht.rate_per_night) <= Number(b[col])).map((b) => b.grade);
    return ok.length ? (ok.length === bands.length ? 'All bands' : `${ok[0]} and above`) : 'Above every band cap';
  };

  const editor = (ht = {}) => {
    const st = {
      id: ht.id ?? '', city: ht.city ? title(ht.city) : '', name: ht.name ?? '', area: ht.area ?? '',
      rate_per_night: ht.rate_per_night ?? '', includes_breakfast: ht.includes_breakfast ?? false,
      contact: ht.contact ?? '', booking_url: ht.booking_url ?? '', notes: ht.notes ?? '', active: ht.active ?? true,
    };
    const inp = (k, attrs = {}) => h('input', { value: st[k], oninput: (e) => (st[k] = e.target.value), ...attrs });
    const chk = (k) => h('input', { type: 'checkbox', checked: st[k], onchange: (e) => (st[k] = e.target.checked), style: 'width:auto' });
    const dlg = h('dialog', {},
      h('h2', {}, ht.id ? 'Edit preferred hotel' : 'Add preferred hotel'),
      h('div', { class: 'row' },
        field('City', inp('city', { list: 'hotel-city-list', placeholder: 'e.g. Mumbai' }), null, true),
        field('Rate per night', inp('rate_per_night', { type: 'number', min: '0' }), 'Negotiated / corporate rate', true)),
      field('Hotel name', inp('name'), null, true),
      field('Area / address', inp('area', { placeholder: 'e.g. Andheri East, near airport' })),
      h('div', { class: 'row' },
        field('Contact (phone / email)', inp('contact')),
        field('Website / booking link', inp('booking_url', { placeholder: 'https://…' }))),
      field('Notes for travellers', inp('notes', { placeholder: 'Quote company code HSCV, free airport pickup…' })),
      h('div', { class: 'actions field' },
        h('label', { class: 'check' }, chk('includes_breakfast'), 'Breakfast included'),
        h('label', { class: 'check' }, chk('active'), 'Active (shown to travellers)')),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: async () => {
          await call(sb.rpc('upsert_preferred_hotel', { p: { ...st, city: cityKey(st.city) } }));
          dlg.close();
          toast('Hotel saved');
          router();
        } }, 'Save'),
        h('button', { onclick: () => dlg.close() }, 'Cancel')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  };

  const byCity = {};
  for (const ht of list) (byCity[ht.city] ||= []).push(ht);

  mount(
    h('datalist', { id: 'hotel-city-list' }, cities.map((c) => h('option', { value: title(c.name) }))),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Preferred hotels'),
        h('div', { class: 'muted' }, 'Hotels with company rates. Travellers see these when they add a hotel stay in that city.')),
      h('button', { class: 'primary', onclick: () => editor() }, '+ Add hotel')),
    list.length
      ? Object.entries(byCity).map(([city, rows]) =>
          h('div', { class: 'card' },
            h('h2', {}, title(city), h('span', { class: 'muted small' }, `  · category ${cityCat[city] || 'C'}`)),
            h('div', { class: 'table-wrap' }, h('table', {},
              h('thead', {}, h('tr', {}, ['Hotel', 'Rate / night', 'Within cap for', 'Contact', 'Status', ''].map((c) => h('th', {}, c)))),
              h('tbody', {}, rows.map((ht) =>
                h('tr', {},
                  h('td', {}, h('strong', {}, ht.name), ht.area ? h('div', { class: 'muted small' }, ht.area) : null,
                    ht.notes ? h('div', { class: 'muted small' }, ht.notes) : null),
                  h('td', { class: 'nowrap' }, money(ht.rate_per_night), ht.includes_breakfast ? h('div', { class: 'muted small' }, 'with breakfast') : null),
                  h('td', {}, bandsWithin(ht)),
                  h('td', { class: 'small' }, ht.contact || '—',
                    ht.booking_url ? h('div', {}, h('a', { href: ht.booking_url, target: '_blank', rel: 'noopener noreferrer' }, 'Website ↗')) : null),
                  h('td', {}, ht.active ? h('span', { class: 'badge s-booked' }, 'Active') : h('span', { class: 'badge s-cancelled' }, 'Hidden')),
                  h('td', {}, h('button', { onclick: () => editor(ht) }, 'Edit')))))))))
      : h('div', { class: 'card empty' }, 'No preferred hotels yet. Add the hotels your company regularly uses, with their corporate rates.')
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
