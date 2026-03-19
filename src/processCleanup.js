const { execSync } = require('child_process');
const { logger } = require('./logger');

async function killExistingProcesses() {
  const currentPid = process.pid;
  const patterns = [
    { name: 'node', cmdline: 'index.js' },
    { name: 'node', cmdline: 'start-3080.js' },
    { name: 'python', cmdline: 'chatbot_memory_service.py' },
  ];

  for (const pattern of patterns) {
    try {
      // Find processes matching the pattern
      const command = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '${pattern.name}' -and $_.CommandLine -match '${pattern.cmdline}' } | Select-Object ProcessId, CommandLine`;
      const output = execSync(command, {
        shell: 'powershell.exe',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse output and kill processes
      const lines = output.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+/);
        if (match) {
          const pid = parseInt(match[1], 10);
          if (pid && pid !== currentPid) {
            try {
              execSync(`taskkill /PID ${pid} /F`, {
                shell: 'powershell.exe',
                stdio: 'pipe',
              });
              logger.info(`Killed existing process: PID ${pid} (${pattern.cmdline})`);
            } catch (error) {
              // Process may have already exited
              logger.debug(`Could not kill PID ${pid}: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      // No matching processes found or command error
      logger.debug(`Process check for ${pattern.cmdline}: ${error.message}`);
    }
  }
}

module.exports = { killExistingProcesses };
