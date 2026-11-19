// Isolated local smoke test. No packages, normal profiles, or installed saves.
// node tool/verify_web_preview.mjs [http://127.0.0.1:8771/]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8771/');
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
  throw new Error('Only an explicit loopback preview origin is permitted.');
}
const outputRoot = join(root, 'verification', 'web-preview');
const checkedAt = new Date().toISOString();
const output = join(outputRoot, 'runs', checkedAt.replaceAll(/[:.]/g, '-'));
const listingOutput = join(root, 'release', 'play-store', 'screenshots', 'phone', checkedAt.replaceAll(/[:.]/g, '-'));
const temporary = join(root, 'build', 'verification-tests');
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const profile = await mkdtemp(join(temporary, 'web-profile-'));
const report = {
  checkedAt,
  url: url.href,
  scope: 'Actual release web app in a new test-only Chrome profile; no ordinary browser or installed storage accessed or cleared.',
  profile: relative(root, profile).replaceAll('\\', '/'),
  status: 'failed',
  captures: [],
  listingCaptures: [],
  checks: [],
  exceptions: [],
  console: [],
  failedRequests: [],
  externalRequests: [],
};

class Connection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  request(method, params = {}, sessionId) {
    return new Promise((resolveRequest, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 35000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  event(method, sessionId) {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 35000);
      const listener = (message) => {
        if (message.method !== method || message.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolveEvent(message.params);
      };
      this.listeners.add(listener);
    });
  }
}

let chrome;
let connection;
let session;
try {
  chrome = spawn(
    process.env.FINDIT_HIDDEN_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      '--headless=new', '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--mute-audio', '--window-size=1440,960',
      '--force-device-scale-factor=1', 'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start.')), 20000);
    chrome.once('error', reject);
    chrome.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolveEndpoint(match[1]);
      }
    });
    chrome.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code}): ${stderr.slice(-1500)}`));
    });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  connection = new Connection(socket);
  report.browser = await connection.request('Browser.getVersion');
  const target = await connection.request('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await connection.request('Target.attachToTarget', {
    targetId: target.targetId, flatten: true,
  }));
  const call = (method, params) => connection.request(method, params, session);
  connection.listeners.add((message) => {
    if (message.sessionId !== session) return;
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
      report.console.push({ type: message.params.type, text: message.params.args.map((arg) => arg.value ?? arg.description).join(' ') });
    }
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      report.failedRequests.push({ url: message.params.response.url, status: message.params.response.status });
    }
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) report.failedRequests.push(message.params);
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)
      && new URL(message.params.request.url).origin !== url.origin) {
      report.externalRequests.push(message.params.request.url);
    }
  });
  await Promise.all([
    call('Page.enable'), call('Runtime.enable'), call('Network.enable'),
    call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false }),
  ]);
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = (expression, label) => evaluate(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(${JSON.stringify(`Did not appear: ${label}`)})), 25000);
    const check = () => {
      if (${expression}) { clearTimeout(timer); resolve(true); }
      else requestAnimationFrame(check);
    };
    check();
  })`);
  const waitText = (text) => waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, text);
  const labelOf = '(element.getAttribute("aria-label") || element.innerText || element.textContent).trim()';
  const matchingButton = (label, contains = false) => `[...document.querySelectorAll('[role="button"]')].filter(element =>
    element.getAttribute('aria-disabled') !== 'true' && ${labelOf}${contains ? `.includes(${JSON.stringify(label)})` : ` === ${JSON.stringify(label)}`}).at(-1)`;
  const matchingSwitch = (label) => `[...document.querySelectorAll('[role="checkbox"], [role="switch"]')].find(element =>
    element.getAttribute('aria-disabled') !== 'true' && ${labelOf}.startsWith(${JSON.stringify(label)}))`;
  let lastPointer = 0;
  let touchMode = false;
  const tapElement = async (expression, label) => {
    // Honor the game's 180 ms tap debounce, not an arbitrary page-load sleep.
    await waitFor(`Date.now() >= ${lastPointer + 200}`, 'input debounce');
    const box = await evaluate(`new Promise((resolve, reject) => {
      let previous = '', stable = 0;
      const timer = setTimeout(() => reject(new Error(${JSON.stringify(`Button unavailable: ${label}`)})), 25000);
      const check = () => {
        const element = ${expression};
        if (element) {
          const rect = element.getBoundingClientRect();
          const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          const current = JSON.stringify(point);
          stable = current === previous ? stable + 1 : 0;
          previous = current;
          if (stable >= 3 && point.x > 0 && point.y > 0 && point.x < innerWidth && point.y < innerHeight) {
            clearTimeout(timer); resolve(point); return;
          }
        }
        requestAnimationFrame(check);
      };
      check();
    })`);
    if (touchMode) {
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...box, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
    }
    lastPointer = Date.now();
  };
  const click = (label, contains = false) => tapElement(matchingButton(label, contains), label);
  const settleFrame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  const setViewport = async (width, height, { scale = 1, mobile = true } = {}) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    touchMode = mobile;
    await waitFor(`innerWidth === ${width} && innerHeight === ${height} && document.querySelector('flutter-view')?.style.width === '${width}px'`, `${width} by ${height} layout`);
    await settleFrame();
  };
  const scrollToElement = async (expression, label) => {
    await waitFor(`${expression} !== undefined`, label);
    for (let attempt = 0; attempt < 20; attempt++) {
      const box = await evaluate(`(() => {
        const element = ${expression};
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { y: rect.y + rect.height / 2, width: innerWidth, height: innerHeight };
      })()`);
      if (box && box.y >= 90 && box.y <= box.height - 110) return;
      const delta = box ? Math.max(-480, Math.min(480, box.y - box.height / 2)) : 400;
      if (touchMode) {
        await call('Input.synthesizeScrollGesture', {
          x: box ? box.width / 2 : 180, y: box ? box.height / 2 : 320,
          yDistance: -delta, speed: 1500, gestureSourceType: 'touch',
        });
      } else {
        await call('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: box.width / 2, y: box.height / 2, deltaX: 0, deltaY: delta,
        });
      }
      await settleFrame();
    }
    throw new Error(`Could not bring ${label} into the app's scroll viewport.`);
  };
  const scrollAndClick = async (label, contains = false) => {
    await scrollToElement(matchingButton(label, contains), label);
    await click(label, contains);
  };
  const checkBranding = async (page) => {
    const result = await evaluate(`(() => ({
      title: document.title,
      text: document.body.innerText + '\\n' + [...document.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label')).join('\\n'),
      width: innerWidth, height: innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }))()`);
    if (result.title !== 'Seek More' || /\bFind[ -]?It\b/.test(result.text) || result.text.includes('development build')) {
      throw new Error(`Incorrect player-facing branding or non-production copy on ${page}.`);
    }
    if (result.horizontalOverflow) throw new Error(`Horizontal document overflow on ${page}.`);
    report.checks.push({ check: `Seek More production branding and responsive document: ${page}`, status: 'passed', width: result.width, height: result.height });
  };
  const coins = () => evaluate(`(() => {
    const values = [...document.querySelectorAll('flt-semantics')].map(element => ${labelOf});
    const value = values.find(text => /^[0-9]+ coins$/.test(text));
    if (!value) throw new Error('Coin balance is missing from semantics.');
    return Number(value.split(' ')[0]);
  })()`);
  const activateAccessibility = () => evaluate("document.querySelector('flt-semantics-placeholder')?.click()");
  const capture = async (name, listingName) => {
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const bytes = Buffer.from(data, 'base64');
    const file = join(output, `${name}.png`);
    await writeFile(file, bytes);
    report.captures.push({
      file: relative(root, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    });
    if (listingName) {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (Math.min(width, height) < 320 || Math.max(width, height) > 3840 || Math.max(width, height) > Math.min(width, height) * 2) {
        throw new Error('Listing screenshot dimensions do not meet the phone listing requirements.');
      }
      let listingBytes = bytes;
      let format = 'png';
      // Chrome normally produces RGB PNGs. If the capture has an alpha channel,
      // use JPEG instead; Play screenshots must not contain alpha.
      if (bytes[24] !== 8 || bytes[25] !== 2) {
        const jpeg = await call('Page.captureScreenshot', { format: 'jpeg', quality: 95, captureBeyondViewport: false });
        listingBytes = Buffer.from(jpeg.data, 'base64');
        format = 'jpg';
      }
      await mkdir(listingOutput, { recursive: true });
      const listingFile = join(listingOutput, `${listingName}.${format}`);
      await writeFile(listingFile, listingBytes);
      report.listingCaptures.push({
        file: relative(root, listingFile).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(listingBytes).digest('hex'),
        width, height, format, alpha: false,
      });
    }
  };
  const loading = connection.event('Page.loadEventFired', session);
  await call('Page.navigate', { url: url.href });
  await loading;
  await waitFor("document.querySelector('flt-semantics-placeholder') !== null", 'Flutter accessibility activation');
  await activateAccessibility();
  await waitText('Start searching');
  report.checks.push({ check: 'Rendered Home and Flutter semantics', status: 'passed' });
  report.environment = await evaluate(`(async () => ({
    title: document.title, crossOriginIsolated, viewport: { width: innerWidth, height: innerHeight },
    semantics: document.querySelector('flt-semantics-host')?.innerText,
    localStorageKeys: Object.keys(localStorage), databases: await indexedDB.databases(),
    storage: await navigator.storage.estimate(),
  }))()`);
  await capture('wide-home');
  await checkBranding('desktop home');
  const servedScript = Buffer.from(await (await fetch(new URL('main.dart.js', url))).arrayBuffer());
  const localScript = await readFile(join(root, 'build', 'web', 'main.dart.js'));
  if (!servedScript.equals(localScript)) throw new Error('The preview server is serving a different or stale web build.');
  report.webBuildSha256 = createHash('sha256').update(servedScript).digest('hex');
  report.webManifest = await evaluate("fetch('manifest.json').then(response => response.json()).then(value => ({ name: value.name, shortName: value.short_name, id: value.id }))");
  if (report.webManifest.name !== 'Seek More' || report.webManifest.shortName !== 'Seek More') {
    throw new Error('Installable web-app names do not match Seek More.');
  }
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390]]) {
    await setViewport(width, height);
    await waitText('Start searching');
    await checkBranding(`home at ${width} by ${height}`);
    await capture(`mobile-home-${width}x${height}`);
  }
  await setViewport(1440, 960, { mobile: false });
  await writeFile(join(output, 'home-semantics.html'), await evaluate('document.body.outerHTML'));
  if (!report.environment.crossOriginIsolated) throw new Error('Preview is not cross-origin isolated.');
  report.checks.push({ check: 'Cross-origin isolation for durable storage', status: 'passed' });

  await click('Start searching');
  await waitText('Find these objects');
  await waitText('No rush');
  await waitText('Area hint · 20 coins');
  await capture('wide-search');
  await writeFile(join(output, 'search-semantics.html'), await evaluate('document.body.outerHTML'));
  const targets = await evaluate(`(() => [...new Set([...document.querySelectorAll('flt-semantics')]
    .map(element => ${labelOf})
    .filter(text => text.endsWith(', still to find') && !text.includes('\\n'))
    .map(text => text.replace(/, still to find$/, '')))])()`);
  if (targets.length !== 6) throw new Error(`Expected six checklist targets, got ${targets.length}.`);
  if (await coins() !== 100) throw new Error('A new isolated profile did not start with 100 coins.');
  report.checks.push({ check: 'Six-target scene and relaxed searching', status: 'passed' });

  const saveReloadResume = async () => {
    await click('Pause puzzle');
    await waitText('A little breather');
    await click('Save & leave');
    await waitText('Your little journey');
    // Reload Home explicitly, then resume through the public saved-game card.
    // This checks durable storage without assuming that a nested route survives
    // Flutter's asynchronous bootstrap on a full document reload.
    await click('Back to play');
    await waitText('Pick up your last discovery');
    const loaded = connection.event('Page.loadEventFired', session);
    await call('Page.reload');
    await loaded;
    await waitFor("document.querySelector('flt-semantics-placeholder') !== null", 'accessibility after full reload');
    await activateAccessibility();
    await waitText('Pick up your last discovery');
    await click('Pick up your last discovery', true);
    await waitText('Find these objects');
  };

  await click('Area hint · 20 coins');
  await waitText('Search the golden area');
  await waitText('Reveal object · free');
  if (await coins() !== 80) throw new Error('An area hint did not deduct exactly 20 coins.');
  await capture('wide-area-hint');
  await saveReloadResume();
  await waitText('Reveal object · free');
  await waitText('0 of 6 found');
  if (await coins() !== 80) throw new Error('The paid hint balance changed after reload.');
  report.checks.push({ check: 'Area hint and 20-coin charge survive full page reload', status: 'passed' });

  await click('Reveal object · free');
  await waitText('Your object is circled in gold');
  await waitText('0 of 6 found');
  if (await coins() !== 80) throw new Error('The precise reveal charged extra coins.');
  await capture('wide-precise-reveal');
  await saveReloadResume();
  await waitText('Your object is circled in gold');
  await waitText('0 of 6 found');
  if (await coins() !== 80) throw new Error('The free reveal balance changed after reload.');
  report.checks.push({ check: 'Free precise reveal survives reload and never auto-finds a target', status: 'passed' });

  const highlighted = await evaluate(`(() => {
    const element = [...document.querySelectorAll('[role="button"]')].find(element =>
      ${labelOf}.startsWith('Picture A,') && ${labelOf}.endsWith(', hint highlighted'));
    return element ? ${labelOf} : null;
  })()`);
  if (!highlighted) throw new Error('The precisely highlighted scene target is missing.');
  await click(highlighted);
  await waitText('1 of 6 found');
  await saveReloadResume();
  await waitText('1 of 6 found');
  if (await coins() !== 80) throw new Error('Finding or resuming a target changed the wallet.');
  report.checks.push({ check: 'Real pointer find and partial progress survive full page reload', status: 'passed' });
  await capture('wide-resumed-search');

  // Exercise the app's advertised screen-reader activation path for remaining
  // checklist objects. This does not inject engine state or call hidden APIs.
  const remaining = targets.filter(description => !highlighted.startsWith(`Picture A, ${description},`));
  for (let index = 0; index < remaining.length; index++) {
    const description = remaining[index];
    await waitFor(`Date.now() >= ${lastPointer + 200}`, 'scene input debounce');
    await evaluate(`(() => {
      const element = [...document.querySelectorAll('[role="button"]')].find(element =>
        ${labelOf}.startsWith(${JSON.stringify(`Picture A, ${description},`)}) && element.getAttribute('aria-disabled') !== 'true');
      if (!element) throw new Error(${JSON.stringify(`Scene target unavailable: ${description}`)});
      element.click();
    })()`);
    lastPointer = Date.now();
    await waitText(index === remaining.length - 1 ? 'The next little discovery' : `${index + 2} of 6 found`);
  }
  await waitText('coins safely saved');
  const completionCoins = await coins();
  if (completionCoins <= 80) throw new Error('Completion did not award earned coins.');
  await capture('wide-completed');
  report.checks.push({ check: 'Accessible manual finds complete the level and award earned coins', status: 'passed', coins: completionCoins });
  await click('The next little discovery');
  await waitText('The secret garden');
  await waitText('0 of 6 found');
  report.checks.push({ check: 'Completion unlocks and opens the next hidden-object level', status: 'passed' });

  await click('Pause puzzle');
  await waitText('A little breather');
  await click('Save & leave');
  await waitText('1 of 60 levels discovered');
  await click('Back to play');
  await waitText('Pick up your last discovery');
  const reloaded = connection.event('Page.loadEventFired', session);
  await call('Page.reload');
  await reloaded;
  await waitFor("document.querySelector('flt-semantics-placeholder') !== null", 'accessibility after completion reload');
  await activateAccessibility();
  await waitText('Pick up your last discovery');
  if (await coins() !== completionCoins) throw new Error('Completion coins changed after reload.');
  await click('Explore all 60 hidden-object levels');
  await waitText('1 of 60 levels discovered');
  report.checks.push({ check: 'Completed level and coin reward survive full page reload', status: 'passed' });

  await click('Back to play');
  await waitText('Start searching');
  await setViewport(390, 844);
  await waitText('Start searching');
  await capture('phone-home');
  await click('Start searching');
  await waitText('Pick up where you left off?');
  await capture('phone-resume-choice');
  await click('Continue');
  await waitText('Find these objects');
  await waitText('The secret garden');
  await waitText('Area hint · 20 coins');
  await capture('phone-search');
  await checkBranding('phone gameplay');
  report.checks.push({ check: 'Actual web Home, resume dialog and gameplay work with phone touch input', status: 'passed' });
  await click('Pause puzzle');
  await waitText('A little breather');
  await click('Save & leave');
  await waitText('Your little journey');
  await checkBranding('phone level journey');
  await click('Back to play');
  await waitText('Start searching');

  // 360 × 640 logical pixels at 3x yields valid 1080 × 1920 listing captures,
  // without browser chrome, fake progress, promotional overlays or resets.
  await setViewport(360, 640, { scale: 3 });
  await checkBranding('listing home');
  await capture('listing-home', '01-home');
  await click('Start searching');
  await waitText('Pick up where you left off?');
  await click('Continue');
  await waitText('The secret garden');
  await waitText('Find these objects');
  await capture('listing-garden-search', '02-garden-search');
  await click('Pause puzzle');
  await waitText('A little breather');
  await click('Save & leave');
  await waitText('Your little journey');
  await click('Back to play');
  await waitText('Start searching');
  await click('Progress');
  await waitText('Look how far you’ve come.');
  await checkBranding('phone progress');
  await capture('phone-progress');
  await click('Settings');
  await waitText('Just the way you like it.');
  await checkBranding('phone settings');
  await capture('phone-settings');

  const sound = matchingSwitch('Sound effects');
  await scrollToElement(sound, 'Sound effects');
  const initialSound = await evaluate(`(${sound})?.getAttribute('aria-checked')`);
  if (!['true', 'false'].includes(initialSound)) throw new Error('Sound preference is not exposed as an accessible switch.');
  await tapElement(sound, 'Sound effects');
  await waitFor(`(${sound})?.getAttribute('aria-checked') === ${JSON.stringify(initialSound === 'true' ? 'false' : 'true')}`, 'sound preference saved');
  await click('Play');
  await waitText('Start searching');
  const settingsReload = connection.event('Page.loadEventFired', session);
  await call('Page.reload');
  await settingsReload;
  await waitFor("document.querySelector('flt-semantics-placeholder') !== null", 'accessibility after preferences reload');
  await activateAccessibility();
  await waitText('Start searching');
  await click('Settings');
  await waitText('Just the way you like it.');
  if (await evaluate(`(${sound})?.getAttribute('aria-checked')`) !== (initialSound === 'true' ? 'false' : 'true')) {
    throw new Error('The sound preference did not survive a full browser reload.');
  }
  report.checks.push({ check: 'Phone sound preference is changed through touch UI and survives full reload', status: 'passed' });

  await scrollAndClick('Puzzle collection', true);
  await waitText('All 60 levels are included and ready to play offline.');
  await checkBranding('phone included collection');
  await capture('phone-collection');
  await click('Back to settings');
  await waitText('Just the way you like it.');
  await scrollAndClick('About Seek More', true);
  await waitText('About Seek More');
  await checkBranding('phone about');
  await capture('phone-about');
  await scrollAndClick('Open-source licenses');
  await waitText('Licenses');
  await checkBranding('phone licenses');
  await capture('phone-licenses');
  await click('Back');
  await waitText('About Seek More');
  await scrollAndClick('Privacy policy');
  await waitText('11. Contact the developer');
  await checkBranding('phone complete offline privacy policy');
  await capture('phone-privacy');
  await click('Back to settings');
  await waitText('Just the way you like it.');

  await click('Daily');
  await waitText('Your daily adventure');
  await waitText('Let’s begin');
  await checkBranding('phone daily challenges');
  await capture('listing-daily', '03-daily-challenges');
  await click('Play');
  await waitText('Start searching');
  await scrollAndClick('Explore all 60 hidden-object levels');
  await waitText('1 of 60 levels discovered');
  await checkBranding('phone level library');
  await capture('listing-levels', '04-level-library');
  await click('Back to play');
  await waitText('Start searching');
  await setViewport(390, 844);
  await checkBranding('final phone home');
  await capture('phone-home-final');
  report.checks.push({ check: 'Phone navigation, About, licenses, all 11 privacy sections, collection and Daily screens', status: 'passed' });
  if (report.listingCaptures.length !== 4) throw new Error('Four verified phone listing screenshots are required.');
  report.finalStorage = await evaluate(`(async () => {
    const paths = [];
    async function walk(directory, parent = '') {
      for await (const [name, handle] of directory.entries()) {
        const path = parent + name;
        paths.push(path);
        if (handle.kind === 'directory') await walk(handle, path + '/');
      }
    }
    await walk(await navigator.storage.getDirectory());
    return { opfsPaths: paths, estimate: await navigator.storage.estimate() };
  })()`);
  if (report.exceptions.length || report.console.some(message => message.type === 'error')
    || report.failedRequests.length || report.externalRequests.length) {
    throw new Error('Unexpected browser exceptions, failed requests, or external web dependencies.');
  }
  report.checks.push({ check: 'No uncaught errors, failed requests, or external web requests', status: 'passed' });
  report.status = 'passed';
  const listingManifest = {
    checkedAt, appName: 'Seek More', status: 'passed', webBuildSha256: report.webBuildSha256,
    scope: 'Actual production-config release-web app at 360 × 640 logical pixels and 3x scale, without browser chrome. Browser captures are not Android device QA; review against the Android app before listing use.',
    captures: report.listingCaptures,
  };
  await writeFile(join(listingOutput, 'manifest.json'), `${JSON.stringify(listingManifest, null, 2)}\n`);
  await writeFile(join(root, 'release', 'play-store', 'screenshots', 'manifest.json'), `${JSON.stringify(listingManifest, null, 2)}\n`);
} catch (error) {
  report.error = error.stack ?? String(error);
  if (connection && session) {
    try {
      const { data } = await connection.request('Page.captureScreenshot', { format: 'png' }, session);
      await writeFile(join(output, 'failure.png'), Buffer.from(data, 'base64'));
      const page = await connection.request('Runtime.evaluate', { expression: 'document.body.outerHTML', returnByValue: true }, session);
      await writeFile(join(output, 'failure.html'), page.result.value ?? 'No DOM.');
    } catch { /* Preserve the original failure even if diagnostic capture fails. */ }
  }
} finally {
  if (connection) {
    try { await connection.request('Browser.close'); } catch { /* Chrome may close the socket first. */ }
    connection.socket.close();
  } else if (chrome) chrome.kill();
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Web preview: ${report.status}. Report: verification/web-preview/report.json`);
if (report.error) console.error(report.error);
process.exitCode = report.status === 'passed' ? 0 : 1;
