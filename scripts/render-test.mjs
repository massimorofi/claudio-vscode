// Standalone render smoke test for the built webview bundle.
//
// Serves dist/webview over HTTP with acquireVsCodeApi stubbed, loads it in
// headless Chrome, and checks that React actually mounted into #root (i.e. the
// bundle runs without a runtime crash). This is NOT a CSP test — it deliberately
// omits CSP so we isolate "does the app render" from "does the policy allow it".
//
// Chrome's background GCM service prevents --virtual-time-budget from reaching
// idle, so instead of --dump-dom we use a side-channel: the page POSTs its render
// status to this server the moment React commits, and Chrome is bounded by a hard
// timeout.
import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

const distDir = path.resolve('dist/webview')
const reportFile = '/tmp/claudio-render-report.txt'
try { fs.unlinkSync(reportFile) } catch {}

const raw = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8')

const stub = `<script>
window.acquireVsCodeApi = () => ({
  postMessage() {},
  getState() { return undefined },
  setState() {},
});
(function () {
  var reported = false;
  function report(status) {
    if (reported) return;
    reported = true;
    try { fetch('/report?status=' + encodeURIComponent(status)); } catch (e) {}
  }
  function check() {
    var root = document.getElementById('root');
    var html = root ? root.innerHTML : '';
    var hasTabs = /chat/i.test(html) && /config/i.test(html);
    if (html.length > 50 && hasTabs) { report('OK:' + html.length); return true; }
    return false;
  }
  var root = document.getElementById('root');
  if (root) {
    new MutationObserver(function () { check(); }).observe(root, { childList: true, subtree: true });
  }
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!check()) {
        var r = document.getElementById('root');
        report('EMPTY:' + (r ? r.innerHTML.length : 0));
      }
    }, 1000);
  });
})();
</script>`

const harness = raw.replace('<head>', `<head>\n${stub}`)
fs.writeFileSync(path.join(distDir, '_render_test.html'), harness)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/report') {
    fs.writeFileSync(reportFile, u.searchParams.get('status') || 'EMPTY')
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join(distDir, rel)
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/_render_test.html`
  const chrome = spawn(
    'google-chrome-stable',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-proxy-server',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--disable-default-apps',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=/tmp/chrome-render-test-profile',
      url,
    ],
    { stdio: 'ignore' },
  )
  const deadline = setTimeout(() => {
    try { chrome.kill('SIGKILL') } catch {}
  }, 15000)
  chrome.on('exit', () => {
    clearTimeout(deadline)
    setTimeout(() => {
      let status = 'NO_REPORT'
      try { status = fs.readFileSync(reportFile, 'utf-8') } catch {}
      server.close()
      console.log('report:', status)
      if (status.startsWith('OK')) {
        console.log('RESULT: PASS — React mounted and rendered the tab bar')
        process.exit(0)
      } else {
        console.log('RESULT: FAIL — #root did not render (' + status + ')')
        process.exit(1)
      }
    }, 300)
  })
})
