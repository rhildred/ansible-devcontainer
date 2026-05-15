import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import httpProxy from 'http-proxy';
import axios from 'axios';
import 'dotenv/config';

const FORGEJO_URL = process.env.FORGEJO_URL;
const DOMAIN = process.env.DOMAIN; // Leading dot is critical for subdomain sharing
const app = express();

// Trust cloudflared's HTTPS headers
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));

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
      return done(null, { username: data.username, email: data.email, token: refreshToken });
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// 4. Auth Routes
app.get('/devcontainers/api/login', (req, res, next) => {
  // Ensure the returnTo URL is absolute for subdomain redirects
  if (!req.session.returnTo || req.session.returnTo.includes("/login")) {
    req.session.returnTo = `${req.protocol}://${req.get('host')}${req.path.replace("/devcontainers/api/login", "/devcontainers")}`;
  }
  passport.authenticate('forgejo')(req, res, next);
});

app.get('/devcontainers/api/auth/callback', 
  passport.authenticate('forgejo', { failureRedirect: '/login' }),
  (req, res) => {
    const destination = req.session.returnTo || `/`;
    delete req.session.returnTo;
    res.redirect(destination);
  }
);

// A single route that works on both https://k3p.dev/hello and https://api.k3p.dev/hello
app.get('/devcontainers/api/hello', async (req, res) => {
    // 2. If data already exists, read it and show which domain we are on
    const currentHost = req.headers.host;
    if (!req.session.passport) return res.send("uninitialized");
    const response = await axios.post('https://k3p.dev/login/oauth/access_token', {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: req.session.passport.user.token
    }, {
        headers: { 'Accept': 'application/json' }
    });

    const { access_token, refresh_token } = response.data;
    if(refresh_token){
        req.session.passport.user.token = refresh_token;
            // Force express-session to save the newly mutated user data
        await new Promise((resolve, reject) => {
            req.session.save((err) => (err ? reject(err) : resolve()));
        });
    }

    res.send(`
    <h1>Session Read Successfully!</h1>
    <p>Current URL Host: <b>${currentHost}</b></p>
    <p>Retrieved Data: "<b>${JSON.stringify(req.session.passport.user)}</b>"</p>
    <p>Access Token: ${access_token}</p>
  `);
});

app.listen(8000, () => console.log('App running on port 8000'));