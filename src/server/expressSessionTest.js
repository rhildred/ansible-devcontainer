import express from 'express';
import session from 'express-session';

const app = express();

// Trust cloudflared's HTTPS headers
app.set('trust proxy', true);

// Configure the shared session cookie
app.use(session({
  secret: 'simple-test-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    domain: '.k3p.dev', // The dot shares the session across k3p.dev and api.k3p.dev
    secure: true,       // Required for HTTPS via cloudflared
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 // 1 hour
  }
}));

// A single route that works on both https://k3p.dev/hello and https://api.k3p.dev/hello
app.get('/devcontainers/api/hello', (req, res) => {
  // 1. If no data exists yet, write it to the session
  if (!req.session.testData) {
    req.session.testData = `Session created at ${new Date().toLocaleTimeString()}`;
    
    return res.send(`
      <h1>Session Initialized!</h1>
      <p>Data stored: "<b>${req.session.testData}</b>"</p>
      <p>Now open a new tab and visit the other URL to see it transfer.</p>
    `);
  }

  // 2. If data already exists, read it and show which domain we are on
  const currentHost = req.headers.host;
  
  res.send(`
    <h1>Session Read Successfully!</h1>
    <p>Current URL Host: <b>${currentHost}</b></p>
    <p>Retrieved Data: "<b>${req.session.testData}</b>"</p>
  `);
});

app.listen(8000, () => console.log('App running on port 8000'));