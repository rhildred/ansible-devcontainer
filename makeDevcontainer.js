import { readFile, writeFile, mkdir } from 'fs/promises';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';

const filePath = './.devcontainer/devcontainer.json';

async function updateJson() {
    try {
        // 1. Read and parse
        let data = {};
        try {
            const content = await readFile(filePath, 'utf8');
            data = JSON.parse(content) || {};

        } catch {
            0;
        }
        const name = uniqueNamesGenerator({
            dictionaries: [adjectives, animals], // colors can be omitted here as not used
            length: 2
        });
        const tld = "k3p.dev";
        data.name = data.name || name;
        if(!data.build && !data.dockerComposeFile){
            data.image = data.image || "mcr.microsoft.com/devcontainers/universal";
        }
        // 2. Add new elements
        // 1. Ensure 'features' exists
        data.features = data.features || {};

        // 2. Ensure the specific feature key exists
        const featureKey = "ghcr.io/coder/devcontainer-features/code-server:2";
        data.features[featureKey] = data.features[featureKey] || {};

        // 3. Now you can safely set the version
        data.features[featureKey]["auth"] = "none";
        // 4. same pattern for forwardPorts
        data.forwardPorts = data.forwardPorts || [];
        if (!data.forwardPorts.includes(8080)) {
            data.forwardPorts.push(8080);
        }
        data.runArgs = data.runArgs || [];
        if(!data.runArgs.includes("hostname")){
            data.runArgs.push(`hostname=${name}`);
        }
        if(!data.runArgs.includes("network")){
            data.runArgs.push("network=devcontainer_network");
        }
        if(!data.runArgs.includes("network-alias")){
            data.runArgs.push(`network-alias=${name}.k3p.dev`);
        }
        data.remoteUser = data.remoteUser || "codespace",
        data.containerUser =  data.containerUser || "codespace";

        // 3. Write back
        // JSON.stringify(object, replacer, space)
        // make sure folder exists
        await mkdir('.devcontainer', { recursive: true });
        await writeFile(filePath, JSON.stringify(data, null, 2));

        console.log('File updated successfully using imports!');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

updateJson();