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
  status.innerHTML = '<span class="logo"><svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M178 362V150a22 22 0 0 1 22-22h132" stroke-width="44"/><path d="M178 252h96" stroke-width="44"/><circle cx="178" cy="396" r="26" stroke-width="18"/></g><circle cx="358" cy="128" r="34" fill="#f7c58e"/><circle cx="358" cy="128" r="12" fill="#5b3be8"/></svg></span><strong>FieldYatra demo</strong><span class="muted"></span>';
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
