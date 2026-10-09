'use strict';

// Static file server for the TravelDesk front end. All data and business rules live in
// Supabase (see supabase/migrations), so any static host (Vercel, Netlify, S3, nginx) works too.

const path = require('node:path');
const express = require('express');

const app = express();
const dir = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;

// /demo is the in-browser sandbox for prospects (same page, demo backend). Keep it slash-free so
// relative asset URLs resolve from the site root.
app.use((req, res, next) => (req.path === '/demo/' ? res.redirect(301, '/demo') : next()));
app.use(express.static(dir));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dir, 'index.html')));

app.listen(port, () => console.log(`TravelDesk running at http://localhost:${port}`));
