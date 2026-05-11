import express from 'express';
import cookieSession from 'cookie-session';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import httpProxy from 'http-proxy';
import axios from 'axios';
import { CRUDDevcontainer, updateData, listDevcontainers, deleteDevcontainer } from "./CRUDDevcontainer.js";
import ViteExpress from "vite-express";
import 'dotenv/config';


const FORGEJO_URL = process.env.FORGEJO_URL;
const DOMAIN = process.env.DOMAIN; // Leading dot is critical for subdomain sharing
const proxy = httpProxy.createProxyServer({});
const app = express();

// 1. Mandatory for HTTPS cookies behind a proxy
app.set('trust proxy', 1);

// Parse form data
app.use(express.urlencoded({ extended: true }));


// 2. Cookie-based Session (Stateless)
app.use(cookieSession({
  name: 'devcontainer_session',
  keys: ['EOP0XZ4XWVMXODNS0GJJ35WYZ3AZ2K42'], // Use a secure secret
  domain: DOMAIN,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  secure: true,                // Required for HTTPS
  httpOnly: true,              // Prevents XSS
  sameSite: 'lax'              // Allows cookie during OAuth redirect
}));

// SHIM: cookie-session doesn't have regenerate/save, but Passport wants them
app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = (cb) => cb();
  }
  if (req.session && !req.session.save) {
    req.session.save = (cb) => cb();
  }
  next();
});


app.use(passport.initialize());
app.use(passport.session());

// 3. Forgejo OAuth2 Configuration
passport.use('forgejo', new OAuth2Strategy({
    authorizationURL: `${FORGEJO_URL}/login/oauth/authorize`,
    tokenURL: `${FORGEJO_URL}/login/oauth/access_token`,
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Fetch user info from Forgejo API since profile is often empty in OAuth2
      const { data } = await axios.get(`${FORGEJO_URL}/api/v1/user`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return done(null, { username: data.username, token: accessToken });
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// 4. Auth Routes
app.get('/login', (req, res, next) => {
  // Ensure the returnTo URL is absolute for subdomain redirects
  if (!req.session.returnTo || req.session.returnTo.includes("/login")) {
    req.session.returnTo = `${req.protocol}://${req.get('host')}${req.path.replace("/login", "/devcontainers")}`;
  }
  passport.authenticate('forgejo')(req, res, next);
});

app.get('/auth/callback', 
  passport.authenticate('forgejo', { failureRedirect: '/login' }),
  (req, res) => {
    const destination = req.session.returnTo || `/`;
    delete req.session.returnTo;
    res.redirect(destination);
  }
);

app.get("/hello", (req, res) => {
  res.send("Hello Vite + React!");
});

app.post('/api/devcontainers', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  CRUDDevcontainer(req, res);
});

app.delete('/api/devcontainers/:id', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  deleteDevcontainer(req, res);
});

app.get('/api/devcontainers', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
  await listDevcontainers(req, res);
});


// 5. Proxy Logic
const getTarget = (host) => {
  const sHost = host.split(".").shift();
  const aHost = sHost.split("_");
  const sPossPort = aHost.pop();
  if(/^\d+$/.test(sPossPort)){
    return `http://${aHost.join("_")}:${sPossPort}`
  }else{
    return `http://${sHost}:8080`
  }
}

app.all(/^(?!\/login|\/auth\/callback|\/hello|\/devcontainers).*$/, async (req, res) => {
  // bypass for auth paths
  if (['/login', '/auth/callback'].includes(req.path)) return;

  if (req.isAuthenticated()) {
    const target = getTarget(req.headers.host);
    const oUrl = new URL(target);
    if(req.path == "/"){
      await updateData({serviceName: oUrl.hostname,username: req.session.passport.user.username});
    }
    return proxy.web(req, res, { target });
  }

  // Not authenticated: Store current canonical URL and redirect
  req.session.returnTo = `${req.protocol}://${req.get('host')}${req.path}`;
  res.redirect('/login');
});

if(process.env.NODE_ENV == "production"){
  const sBase = "/devcontainers/"
  ViteExpress.config({
    base: sBase,      // Matches your vite.config.js 'base'
    inlineViteConfig: {
      base: sBase    // Ensure Vite logic knows the base during runtime
    },
    hmr: {
      // Ensure HMR connects through the base
      path: sBase,
    },

  });

}

const server = ViteExpress.listen(app, 8000, () => console.log('Proxy running'));

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

