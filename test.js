const { spawn } = require('child_process');
const fs = require('fs');

const req = fs.readFileSync('req.json');
const child = spawn('.\\resources\\pyalign\\.venv\\Scripts\\python.exe', ['resources/pyalign/forced_align.py'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let stdout = '';
child.stdout.on('data', d => stdout += d.toString());
child.on('close', code => {
  console.log(`Exited with code ${code}`);
  console.log(stdout.substring(0, 1000));
});

child.stdin.write(req);
child.stdin.end();
