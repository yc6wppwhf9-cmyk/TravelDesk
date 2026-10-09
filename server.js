'use strict';

// Static file server for the FieldYatra front end. All data and business rules live in
// Supabase (see supabase/migrations), so any static host (Vercel, Netlify, S3, nginx) works too.

const path = require('node:path');
const express = require('express');

const app = express();
const dir = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;

// Company demos live at /<company> (see public/sandbox/companies.js); the catch-all below serves them.
app.use(express.static(dir));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dir, 'index.html')));

app.listen(port, () => console.log(`FieldYatra running at http://localhost:${port}`));
