import express from 'express';
import cookieSession from 'cookie-session';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import httpProxy from 'http-proxy';
import axios from 'axios';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';



const FORGEJO_URL = 'https://f5o.k3p.dev';
const DOMAIN = '.k3p.dev'; // Leading dot is critical for subdomain sharing
const proxy = httpProxy.createProxyServer({});
const app = express();

// 1. Mandatory for HTTPS cookies behind a proxy
app.set('trust proxy', 1);

// Parse form data
app.use(express.urlencoded({ extended: true }));


// 2. Cookie-based Session (Stateless)
app.use(cookieSession({
  name: 'k3p_session',
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
    clientID: 'af4e510e-fecc-40e6-a306-dfa12a47cca2',
    clientSecret: 'gto_yhbxmk5coaxsdgdummk75voqmxsikziwmh7tncqwy4nbeziugmta',
    callbackURL: 'https://k3p.dev/auth/callback'
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
  if (!req.session.returnTo) {
    req.session.returnTo = `${req.protocol}://${req.get('host')}${req.path}`;
  }
  passport.authenticate('forgejo')(req, res, next);
});

app.get('/auth/callback', 
  passport.authenticate('forgejo', { failureRedirect: '/login' }),
  (req, res) => {
    const destination = req.session.returnTo || `https://k3p.dev`;
    delete req.session.returnTo;
    res.redirect(destination);
  }
);

app.post('/new_devcontainer', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');

  const { repo_url, branch } = req.body;
  const token = req.session.passport.user.token;

  
  // 1. Prepare target directory
  const repoName = repo_url.split('/').pop().replace('.git', '');
  const targetDir = path.join(process.cwd(), 'temp_repos', `${repoName}_${Date.now()}`);
  
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 2. Build Authenticated URL
    // Forgejo/Gitea uses 'oauth2' as the username for Git-over-HTTPS
    const url = new URL(repo_url);
    url.username = 'oauth2';
    url.password = token;

    // 3. Simple Checkout
    const git = simpleGit();
    await git.clone(url.toString(), targetDir, [
      '--branch', branch,
      '--single-branch',
      '--depth', '1' // Shallow clone for speed
    ]);

    res.end(`Successfully checked out ${branch} to ${targetDir}`);
  } catch (err) {
    console.error('Git Error:', err);
    res.status(500).send(`Checkout failed: ${err.message}`);
  }
});

// 5. Proxy Logic
const getTarget = (host) => "http://localhost:8080";

app.all(/^(?!\/login|\/auth\/callback).*$/, (req, res) => {
  // bypass for auth paths
  if (['/login', '/auth/callback'].includes(req.path)) return;

  if (req.isAuthenticated()) {
    return proxy.web(req, res, { target: getTarget(req.headers.host) });
  }

  // Not authenticated: Store current canonical URL and redirect
  req.session.returnTo = `${req.protocol}://${req.get('host')}${req.path}`;
  res.redirect('https://k3p.dev/login');
});

const server = app.listen(8000, () => console.log('Proxy running'));

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

