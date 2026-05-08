import { readFile, writeFile, mkdir } from 'fs/promises';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { spawn } from 'node:child_process'; 


async function cloneRepo(req, res, { serviceName, repo_url, branch }){
  const token = req.session.passport.user.token;

  
  // 1. Prepare target directory
  const repoName = repo_url.split('/').pop().replace('.git', '');
  const targetDir = path.join("/tmp/", serviceName);
  
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
  } catch (err) {
    console.error('Git Error:', err);
    throw err;
  }

}

async function createDevcontainerJSON({ serviceName, repo_url }) {
    try {
        // 1. Read and parse
        let data = {};
        try {
            const content = await readFile(`/tmp/${serviceName}/.devcontainer/devcontainer.json`, 'utf8');
            data = JSON.parse(content) || {};

        } catch {
            0;
        }
        data.name = serviceName;
        if(!data.build && !data.dockerComposeFile){
            data.image = data.image || "mcr.microsoft.com/devcontainers/universal";
        }else if(data.build && data.build.dockerfile){
            data.build.dockerfile = `/tmp/${serviceName}/.devcontainer/${data.build.dockerfile}`;
        }
        else{
            data.dockerComposeFile = `/tmp/${serviceName}/.devcontainer/${data.dockerComposeFile}`;
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
        const repoName = repo_url.split("/").pop().replace(".git", "");
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

        // 3. Write back
        // JSON.stringify(object, replacer, space)
        // make sure folder exists
        await mkdir(`/tmp/${serviceName}_devcontainer`, { recursive: true });

        await writeFile(`/tmp/${serviceName}_devcontainer/devcontainer.json`, JSON.stringify(data, null, 2));
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

        const context = { serviceName, repo_url, branch };
        await cloneRepo(req, res, context);
        await createDevcontainerJSON(context);
        // 1. Set headers to stream the CLI logs in real-time
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        // 2. Define your specific CLI command and arguments
        const command = 'devcontainer';
        const args = [
            'up',
            '--workspace-folder', `/tmp/${serviceName}`,
            '--config', `/tmp/${serviceName}_devcontainer/devcontainer.json`
        ];

        // 3. Spawn the process
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

    }catch(err){
        console.error('Error:', err.message);        
        res.status(500).send(`CrudDevContainer failed: ${err.message}`);
        throw err;
        
    }
}