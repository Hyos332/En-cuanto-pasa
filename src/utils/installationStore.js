const fs = require('fs').promises;
const path = require('path');

// Carpeta data en la raíz del proyecto (subiendo un nivel desde src/utils)
const DATA_DIR = path.join(__dirname, '../../data');

async function storeInstallation(installation) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const id = installation.team?.id || installation.enterprise?.id || 'unknown';
    const filePath = path.join(DATA_DIR, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(installation, null, 2));
}

async function fetchInstallation(query) {
    const id = query.teamId || query.enterpriseId;
    const filePath = path.join(DATA_DIR, `${id}.json`);
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`No installation found for ${id}`);
    }
}

async function deleteInstallation(query) {
    const id = query.teamId || query.enterpriseId;
    const filePath = path.join(DATA_DIR, `${id}.json`);
    await fs.unlink(filePath).catch(() => { });
}

module.exports = {
    storeInstallation,
    fetchInstallation,
    deleteInstallation
};
