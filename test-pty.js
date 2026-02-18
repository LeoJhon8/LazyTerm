const pty = require('node-pty');
const os = require('os');

console.log('PTY Integration Test Script');
console.log('============================\n');

const platform = os.platform();
const shell = platform === 'win32' ? 'powershell.exe' : 'bash';

console.log(`Platform: ${platform}`);
console.log(`Shell: ${shell}\n`);

try {
  testInteractivePrograms();
} catch (error) {
  console.error('Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}

function testInteractivePrograms() {
  console.log('Testing basic PTY create, write, and read...\n');

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    useConpty: platform === 'win32'
  });

  let output = '';
  let testPassed = true;

  ptyProcess.on('data', (data) => {
    output += data;
    process.stdout.write(data);
  });

  console.log('PTY created, waiting for shell...');
  console.log('output variable length check:', output.length);

  setTimeout(() => {
    console.log('\n--- Test 1: dir/List command ---');
    const dirCmd = platform === 'win32' ? 'Get-ChildItem\r' : 'ls -la\r';
    ptyProcess.write(dirCmd);
  }, 500);

  setTimeout(() => {
    console.log('\n--- Test 2: echo command ---');
    ptyProcess.write('echo "PTY test successful"\r');
  }, 3000);

  setTimeout(() => {
    console.log('\n--- Test 3: Checking output ---');
    const hasList = platform === 'win32'
      ? (output.includes('ChildItem') || output.includes('Mode') || output.includes('Directory'))
      : output.includes('ls');
    if (output.includes('successfully') && hasList) {
      console.log('✓ PTY is working correctly');
    } else {
      console.log('✗ PTY output unexpected');
      console.log('  Output contains "successfully":', output.includes('successfully'));
      console.log('  Output contains list indicator:', hasList);
      console.log('  Full output length:', output.length);
      testPassed = false;
    }

    console.log('\n--- Test 4: Testing Ctrl+C signal ---');
    ptyProcess.write('\x03');
  }, 5000);

  setTimeout(() => {
    console.log('\n--- Cleanup ---');
    ptyProcess.write('exit\r');
  }, 6000);

  setTimeout(() => {
    ptyProcess.destroy();
    console.log('\n============================');
    if (testPassed) {
      console.log('✓ all tests passed!');
      process.exit(0);
    } else {
      console.log('✗ some tests failed');
      process.exit(1);
    }
  }, 7000);
}

console.log('Note: This test runs for 5 seconds with automated commands.');
console.log('Watch the output above to verify PTY functionality.\n');
