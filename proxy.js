import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import httpProxy from 'http-proxy';

const FORGEJO_URL = 'https://f5o.k3p.dev';
const proxy = httpProxy.createProxyServer({});
const app = express();

// 1. Session & Passport Setup
app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// 2. Configure Forgejo OAuth2 Strategy
passport.use('forgejo', new OAuth2Strategy({
    authorizationURL: `${FORGEJO_URL}/login/oauth/authorize`,
    tokenURL: `${FORGEJO_URL}/login/oauth/access_token`,
    clientID: 'af4e510e-fecc-40e6-a306-dfa12a47cca2',
    clientSecret: 'gto_yhbxmk5coaxsdgdummk75voqmxsikziwmh7tncqwy4nbeziugmta',
    callbackURL: 'https://oauth.k3p.dev/auth/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    // For simple proxying, we just need to know they authenticated
    return done(null, { token: accessToken });
  }
));

// 3. Auth Routes
app.get('/login', passport.authenticate('forgejo'));
app.get('/auth/callback', 
  passport.authenticate('forgejo', { failureRedirect: '/login' }),
  (req, res) => res.redirect('/')
);

// 4. Integrated Proxy Logic
const getTarget = (sHost) => "http://localhost:8080";

const server = app.all('{*path}', (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }

  const target = getTarget(req.headers.host);
  proxy.web(req, res, { target });
}).listen(8000);

// 5. Secure WebSocket Upgrades
server.on('upgrade', (req, socket, head) => {
  // Simple check: Cookies are sent with the upgrade request
  if (!req.headers.cookie) return socket.destroy();

  const target = getTarget(req.headers.host);
  proxy.ws(req, socket, head, { target });
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  if (res.writeHead && !res.headersSent) {
    res.writeHead(502);
    res.end('Bad Gateway');
  }
});
