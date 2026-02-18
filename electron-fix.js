const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Electron fix process...\n');

const isWindows = process.platform === 'win32';

if (isWindows) {
  console.log('Windows detected - Running PowerShell command to close handles...');
  
  const psScript = `
    $processes = Get-Process | Where-Object { $_.ProcessName -like '*electron*' -or $_.ProcessName -like '*node*' }
    if ($processes) {
      foreach ($p in $processes) {
        Write-Host "Terminating process: $($p.ProcessName) (PID: $($p.Id))"
        $p.Kill()
      }
    }
  `;
  
  const ps = spawn('powershell.exe', ['-Command', psScript]);
  
  ps.stdout.on('data', (data) => console.log(data.toString()));
  ps.stderr.on('data', (data) => console.error(data.toString()));
  
  ps.on('close', (code) => {
    console.log(`\nProcess cleanup complete (code: ${code})`);
    console.log('\nPlease manually delete node_modules folder and run npm install');
  });
} else {
  console.log('Non-Windows system detected');
}

