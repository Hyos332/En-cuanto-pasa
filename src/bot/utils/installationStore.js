const fs = require('fs').promises;
const path = require('path');
const DATA_DIR = path.join(__dirname, '../../../data');

async function storeInstallation(installation) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const id = installation.team?.id || installation.enterprise?.id || 'unknown';
  const filePath = path.join(DATA_DIR, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(installation, null, 2));
}

async function fetchInstallation(query) {
  const id = query.teamId || query.enterpriseId;
  const p = path.join(DATA_DIR, `${id}.json`);
  const content = await fs.readFile(p, 'utf8');
  return JSON.parse(content);
}

async function deleteInstallation(query) {
  const id = query.teamId || query.enterpriseId;
  await fs.unlink(path.join(DATA_DIR, `${id}.json`)).catch(()=>{});
}

module.exports = {
  storeInstallation,
  fetchInstallation,
  deleteInstallation
};
