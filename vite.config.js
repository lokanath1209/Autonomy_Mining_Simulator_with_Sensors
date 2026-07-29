// AUSSIM (AUtonomy Site SIMulator) © 2026 Lokanath.
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';


// Dev-only helper: POST a dataURL to /__snap_save?name=foo to write snapshots/foo.jpg
function snapSaver() {
  return {
    name: 'snap-saver',
    configureServer(server) {
      server.middlewares.use('/__snap_save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          const url = new URL(req.url, 'http://x');
          const name = (url.searchParams.get('name') || 'snap').replace(/[^\w-]/g, '');
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          const dir = path.resolve('snapshots');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.jpg`);
          fs.writeFileSync(file, Buffer.from(b64, 'base64'));
          res.end(JSON.stringify({ saved: file }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [snapSaver()],
  base: process.env.GITHUB_ACTIONS ? '/Autonomy_Mining_Simulator_with_Sensors/' : '/',
});
