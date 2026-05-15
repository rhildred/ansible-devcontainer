import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { hasUncaughtExceptionCaptureCallback } from 'node:process';
import Database from 'better-sqlite3';
import { FORGEJO_URL } from './main.js';

// 1. Configure the connection
const db = new Database("/home/ubuntu/devcontainers.sqlite3");
db.prepare(`
          CREATE TABLE IF NOT EXISTS devcontainers (
            id TEXT primary key,
            username TEXT NOT NULL,
            branch TEXT not null,
            repo_url TEXT not null,
            accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )  
  `).run();

db.prepare(`
          CREATE INDEX IF NOT EXISTS idx_user_name 
          ON devcontainers (username)
  `).run();
const DB_SELECT = db.prepare("SELECT * FROM devcontainers WHERE username = ? ORDER BY accessed_at DESC");
const DB_SELECT_ONE = db.prepare("SELECT * FROM devcontainers WHERE id = ? AND username = ?")
const DB_INSERT = db.prepare("INSERT INTO devcontainers(id, username, branch, repo_url) VALUES(?, ?, ?, ?)")
const DB_DELETE = db.prepare("DELETE FROM devcontainers WHERE id = ? AND username = ?")
const DB_UPDATE = db.prepare("UPDATE devcontainers SET accessed_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?")

async function cloneRepo(req, res, { serviceName, repo_url, branch, repoName }){
  const token = req.session.passport.user.token;

  
  // 1. Prepare target directory
  const targetDir = `/home/ubuntu/${serviceName}/${repoName}`;
  
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 3. Simple Checkout
    const git = simpleGit();
    await git.clone(repo_url, targetDir, [
      '--branch', branch,
      '--single-branch',
      '--depth', '1', // Shallow clone for speed
      '-c', `http.extraHeader=Authorization: Bearer ${token}`
    ]);
  } catch (err) {
    console.error('Git Error:', err);
    throw err;
  }

}

async function createDevcontainerJSON({ serviceName, repo_url, repoName }) {
    try {
        // 1. Read and parse
        let data = null;
        let content;
        try{
            content = await readFile(`/home/ubuntu/${serviceName}/${repoName}/.devcontainer/devcontainer.json`, 'utf8');
        }catch{
          data = {};
        }
        if(data == null){
          data = JSON.parse(content);
        }
        data.name = serviceName;
        if(!data.build && !data.dockerComposeFile){
            data.image = data.image || "mcr.microsoft.com/devcontainers/universal";
        }else if(data.build && data.build.dockerfile){
            data.build.dockerfile = `/home/ubuntu/${serviceName}/${repoName}.devcontainer/${data.build.dockerfile}`;
        }
        else{
            data.dockerComposeFile = `/home/ubuntu/${serviceName}/${repoName}/.devcontainer/${data.dockerComposeFile}`;
        }
        // 2. Add new elements
        // 1. Ensure 'features' exists
        data.features = data.features || {};

        // 2. Ensure the specific feature key exists
        const featureKey = "ghcr.io/coder/devcontainer-features/code-server:2";
        data.features[featureKey] = data.features[featureKey] || {};

        // 3. Now you can safely set the version
        data.features[featureKey]["auth"] = "none";
        data.features[featureKey]["port"] = 8080;
        data.features[featureKey]["host"] = "0.0.0.0";
        data.features[featureKey]["workspace"] = `/workspaces/${repoName}`;

        // 4. same pattern for forwardPorts
        data.runArgs = data.runArgs || [];
        const newArgs = [...data.runArgs];
        for(const index = 0; index < data.runArgs.length; index++){
            if(runArgs[index].toLowerCase().includes("hostname")
            || runArg.toLowerCase().includes("network")
            || runArg.toLowerCase().includes("name")){
                newArgs.splice(index, 1);
            }
        }
        newArgs.push(`--hostname=${serviceName}`)
        newArgs.push("--network=proxy-tier")
        newArgs.push(`--network-alias=${serviceName}`)
        newArgs.push(`--name=${serviceName}`)
        data.runArgs = newArgs;
        data.remoteUser = data.remoteUser || "codespace",
        data.containerUser =  data.containerUser || "codespace";
        data.containerName = data.containerName || serviceName;
        data.updateRemoteUserUID = true;


        // 3. Write back
        // JSON.stringify(object, replacer, space)
        // make sure folder exists
        await mkdir(`/home/ubuntu/${serviceName}`, { recursive: true });

        await writeFile(`/home/ubuntu/${serviceName}/devcontainer.json`, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
        throw err;
    }
}

export async function CRUDDevcontainer(req, res){
    try{
        const { repo_url, branch } = req.body;
        const serviceName = uniqueNamesGenerator({
            dictionaries: [adjectives, animals], // colors can be omitted here as not used
            length: 2
        });
        const repoName = repo_url.split('/').pop().replace('.git', '');

        const context = { serviceName, repo_url, branch, repoName, username: req.session.passport.user.username };
        await cloneRepo(req, res, context);
        await createDevcontainerJSON(context);
        await startDevcontainer(req, res, context);
        res.end();
        insertData(context);
    }catch(err){
        console.error('Error:', err.message);        
        res.status(500).send(`CrudDevContainer failed: ${err.message}`);
        throw err;
        
    }
}

export async function listDevcontainers(req, res){
  try {
    const rows  = DB_SELECT.all(req.session.passport.user.username);

    const supplementedRows = await Promise.all(
      rows.map(async (row) => {
        try {
          const sPath = `/home/ubuntu/${row.id}/${row.repo_url.split("/").pop().replace(".git", "")}`;
          // simple-git expects the directory path to the repo
          const status = await simpleGit(sPath).status();

          return {
            ...row, // Spreads all DB columns (id, name, path, etc.)
            isClean: status.isClean(),
            ahead: status.ahead,
          };
        } catch (error) {
          return { ...row, gitError: true };
        }
      })
    );

    res.json(supplementedRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }  
}

export async function deleteDevcontainer(req, res){
  const { id } = req.params; // Grabs the ID from the URL
  try {
    const result = DB_DELETE.run(id, req.session.passport.user.username)

    if (result.changes === 0) {
      throw new Error("devocntainer not in database");
    }
    // docker rm container
    await dockerRM(id);
    // delete the folder
    await rm(`/home/ubuntu/${id}`, { 
      recursive: true, // Deletes the folder and everything inside it
      force: true      // Prevents errors if the folder doesn't exist
    });

    // Return the deleted item 
    res.json({ message: "Deleted successfully", deleted: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete record", err });
  }
}

export async function updateDevContainer(req, res){
  const { id } = req.params; // Grabs the ID from the URL
  const username = req.session.passport.user.username;
  try{
    const row = DB_SELECT_ONE.get(id, username);
    const context = { serviceName: row.id, repo_url: row.repo_url, branch: row.branch, repoName: row.repo_url.split('/').pop().replace('.git', ''), username};
    await createDevcontainerJSON(context);
    await buildDevcontainer(req, res, context);
    await startDevcontainer(req, res, context);
    res.end();
  }catch(err){
    console.error(err);
    res.status(500).json({ error: "Failed to update record" });
  }
}

function dockerRM(name){
  const { status, stdout, stderr } = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  if(status != 0){
    console.log(`docker rm failed stdout: ${stdout}, stderr: ${stderr}`);
    throw new Error(stdout || "" + stderr || "");
  }
  return `docker rm -f ${name}`;
}

async function startDevcontainer(req, res, {serviceName, repoName}){
  const command = 'devcontainer';
  const args = [
      'up',
      '--workspace-folder', `/home/ubuntu/${serviceName}/${repoName}`,
      '--config', `/home/ubuntu/${serviceName}/devcontainer.json`
  ];

  await pipeAsync(req, res, {command, args});
}

async function buildDevcontainer(res, req, {serviceName, repoName}){
  const command = 'devcontainer';
  const args = [
      'build',
      '--workspace-folder', `/home/ubuntu/${serviceName}/${repoName}`,
      '--config', `/home/ubuntu/${serviceName}/devcontainer.json`
  ];
  await pipeAsync(res, req, {command, args});
}

function pipeAsync(req, res, {command, args}){
  return new Promise((resolve, reject) => {
    // 1. Set headers to stream the CLI logs in real-time
    if(!res.headersSent){
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

    }

    // 3. Spawn the process
    console.log(`command: ${command} args: ${JSON.stringify(args)}`)
    const child = spawn(command, args);

    // 4. Pipe stdout (standard output) to the response
    child.stdout.pipe(res);

    // 5. Pipe stderr (errors/warnings) to the response so you can debug failures
    child.stderr.pipe(res);

    // 6. Handle process completion
    child.on('close', (code) => {
      res.write(`\nProcess exited with code: ${code}\n`);
      if(code == 0){
        resolve();
      }else{
        reject(`rejected code: ${code}`);
      }
    });

    // 7. Security: Kill the process if the user cancels the request
    req.on('close', () => {
        child.kill();
    });
    
  });
}

async function insertData({ serviceName, username, repo_url, branch, repoName }) {

  try {
    // 2. Execute the query
    const res = DB_INSERT.run(serviceName, username, branch, repo_url);

    // 3. Verify success
    if (res.changes === 1) {
      console.log('✅ Success! Inserted row ID:', serviceName);
    } else {
      console.log('⚠️ Warning: No rows were inserted.');
      throw "no rows inserted";
    }

  } catch (err) {
    // 4. Handle errors (e.g., unique constraint violations)
    console.error('❌ Database error:', err.message);
  }
}

export async function updateData({ serviceName, username }) {

  try {
    // 2. Execute the query
    const res = DB_UPDATE.run(serviceName, username);

    // 3. Verify success
    if (res.changes === 1) {
      console.log('✅ Success! updated row ID:', serviceName);
    } else {
      console.log(`⚠️ Warning: No rows were updated. serviceName: ${serviceName} username ${username}`);
      throw new Error("no rows updated");
    }

  } catch (err) {
    // 4. Handle errors (e.g., unique constraint violations)
    console.error('❌ Database error:', err.message);
  }
}

export async function refreshToken(req){
    const response = await axios.post(`${FORGEJO_URL}/login/oauth/access_token`, {
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
    return(access_token);
}



