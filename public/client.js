// Picks the backend: the real Supabase project, or the in-browser demo sandbox at /demo.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

// A single-segment path like /demo or /indoco opens that company's demo
// (public/sandbox/companies.js); everything else is the real portal.
const slug = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
const demoSlug = /^[a-z0-9-]+$/.test(slug) && (await import('./sandbox/companies.js')).COMPANIES[slug] ? slug : null;
export const DEMO = Boolean(demoSlug);

async function connect() {
  if (!DEMO) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return { sb: createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY), demo: null };
  }
  const status = document.createElement('div');
  status.className = 'demo-boot';
  status.innerHTML = '<span class="logo">✈</span><strong>TravelDesk demo</strong><span class="muted"></span>';
  document.getElementById('app').replaceChildren(status);
  const say = (m) => { status.querySelector('.muted').textContent = m; };
  try {
    const demo = await import('./sandbox/client.js');
    const sb = await demo.createDemoClient(demoSlug, say);
    return { sb, demo };
  } catch (err) {
    say(`Couldn't start the demo: ${err.message || err}. Please use a recent Chrome, Edge, Firefox or Safari.`);
    throw err;
  }
}

export const { sb, demo } = await connect();
