const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Load environment variables from root .env
const rootEnv = path.join(__dirname, '.env');
const envVars = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" };

if (fs.existsSync(rootEnv)) {
  console.log("[CONFIG] Loading environment variables from .env...");
  const content = fs.readFileSync(rootEnv, 'utf-8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        envVars[key] = val;
      }
    }
  });
}

const services = [
  { name: "Gatekeeper", path: "services/gateway", command: "yarn", args: ["start:dev"] },
  { name: "Orchestrator", path: "services/orchestrator", command: "yarn", args: ["start:dev"] },
  { name: "Research", path: "services/research", command: "yarn", args: ["start:dev"] },
  { name: "Email", path: "services/email", command: "yarn", args: ["start:dev"] },
  { name: "File-Code", path: "services/file-code", command: "yarn", args: ["start:dev"] },
  { name: "Chaos", path: "services/chaos", command: "yarn", args: ["start:dev"] },
  { name: "Config", path: "services/config", command: "yarn", args: ["start:dev"] },
  { name: "Auth", path: "services/auth", command: "yarn", args: ["start:dev"] },
  { name: "GitHub", path: "services/github", command: "yarn", args: ["start:dev"] },
  { name: "News", path: "services/news", command: "yarn", args: ["start:dev"] },
  { name: "Scheduler", path: "services/scheduler", command: "yarn", args: ["start:dev"] },
  { name: "Health", path: "services/health", command: "yarn", args: ["start:dev"] },
  { name: "Coding", path: "services/coding", command: "yarn", args: ["start:dev"] },
  { name: "Deploy", path: "services/deploy", command: "yarn", args: ["start:dev"] },
  { name: "Web", path: "apps/web", command: "yarn", args: ["dev"] }
];

function startService(svc) {
  const svcPath = path.join(__dirname, svc.path);
  
  if (!fs.existsSync(svcPath)) {
    console.error(`[ERROR] [${svc.name}] Path not found: ${svc.path}`);
    return;
  }

  // Ensure service has its own copy of .env for NestJS native discovery if needed
  if (fs.existsSync(rootEnv)) {
    fs.copyFileSync(rootEnv, path.join(svcPath, '.env'));
  }

  console.log(`[INIT] [${svc.name}] Starting in ${svc.path}...`);

  const child = spawn(svc.command, svc.args, {
    cwd: svcPath,
    shell: true,
    env: envVars
  });

  const rlOut = readline.createInterface({ input: child.stdout });
  rlOut.on('line', (line) => {
    console.log(`[${svc.name}] ${line}`);
  });

  const rlErr = readline.createInterface({ input: child.stderr });
  rlErr.on('line', (line) => {
    console.error(`[${svc.name}] [ERR] ${line}`);
  });

  child.on('close', (code) => {
    console.log(`[${svc.name}] Process exited with code ${code}`);
  });

  return child;
}

let children = [];

async function startAll() {
  console.log("Starting Concaretti Unified Orchestrator (Staggered Boot to prevent Redis drops)...");
  console.log("------------------------------------------");
  
  for (const svc of services) {
    const child = startService(svc);
    if (child) children.push(child);
    // Stagger startup by 1.5s to prevent massive simultaneous TCP spikes to Redis in WSL
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

startAll();

process.on('SIGINT', () => {
  console.log("\nShutting down all services...");
  children.forEach(child => child.kill());
  process.exit();
});
