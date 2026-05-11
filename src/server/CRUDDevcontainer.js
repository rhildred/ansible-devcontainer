import { readFile, writeFile, mkdir } from 'fs/promises';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { spawn } from 'node:child_process'; 
import 'dotenv/config';
import pkg from 'pg';
import { hasUncaughtExceptionCaptureCallback } from 'node:process';
const { Pool } = pkg;

// 1. Configure the connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: 5432,
});


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
        let data = {};
        try {
            const content = await readFile(`/home/ubuntu/${serviceName}/${repoName}/.devcontainer/devcontainer.json`, 'utf8');
            data = JSON.parse(content) || {};

        } catch {
            0;
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
        // 1. Set headers to stream the CLI logs in real-time
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        // 2. Define your specific CLI command and arguments
        const command = 'devcontainer';
        const args = [
            'up',
            '--workspace-folder', `/home/ubuntu/${serviceName}/${repoName}`,
            '--config', `/home/ubuntu/${serviceName}/devcontainer.json`
        ];

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
            res.end();
        });

        // 7. Security: Kill the process if the user cancels the request
        req.on('close', () => {
            child.kill();
        });
        insertData(context);
    }catch(err){
        console.error('Error:', err.message);        
        res.status(500).send(`CrudDevContainer failed: ${err.message}`);
        throw err;
        
    }
}

async function insertData({ serviceName, username, repo_url, branch, repoName }) {
  const queryText = 'INSERT INTO devcontainers(id, username, branch, repo_url) VALUES($1, $2, $3, $4)';
  const values = [serviceName, username, branch, repo_url];

  try {
    // 2. Execute the query
    const res = await pool.query(queryText, values);

    // 3. Verify success
    if (res.rowCount === 1) {
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
  const queryText = 'UPDATE devcontainers SET accessed_at = now() WHERE id = $1 AND username = $2';
  const values = [serviceName, username];

  try {
    // 2. Execute the query
    const res = await pool.query(queryText, values);

    // 3. Verify success
    if (res.rowCount === 1) {
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


// 5. Proxy Logic
export const getTarget = (host) => {
  const sHost = host.split(".").shift();
  const aHost = sHost.split("_");
  const sPossPort = aHost.pop();
  if(/^\d+$/.test(sPossPort)){
    return `http://${aHost.join("_")}:${sPossPort}`
  }else{
    return `http://${sHost}:8080`
  }
}