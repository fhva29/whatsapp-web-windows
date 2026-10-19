// WhatsApp Web wrapper pra Windows — Electron
// Janela propria, notifications, audio/video pra ligacoes, bandeja (tray), badge,
// Modo Bolinha (janela flutuante) e envio pra numero nao salvo.

const {
  app, BrowserWindow, Menu, Tray, shell, nativeImage,
  session, screen, globalShortcut, dialog, ipcMain,
} = require('electron');
const path = require('path');
const fs = require('fs');

const WEB_URL = 'https://web.whatsapp.com';
const ICON = path.join(__dirname, 'icon-256.png');
const ICON_512 = path.join(__dirname, 'icon-512.png');
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const CHROME_FULL = process.versions.chrome;

// ---- Temas (estilo GB) ---------------------------------------------
// Overlay fixo com mix-blend-mode: color — tinta todo o app sem depender
// de classes internas do WhatsApp (que mudam o tempo todo). Experimental.
const THEMES = [
  { id: 'padrao', name: 'Padrão WhatsApp', css: '' },
  { id: 'esmeralda', name: 'Esmeralda 🟢', css: 'html::after{content:"";position:fixed;inset:0;pointer-events:none;background:rgba(16,140,120,.42);mix-blend-mode:color;z-index:2147483646}' },
  { id: 'oceano', name: 'Oceano 🔵', css: 'html::after{content:"";position:fixed;inset:0;pointer-events:none;background:rgba(10,74,140,.45);mix-blend-mode:color;z-index:2147483646}' },
  { id: 'lilas', name: 'Lilás 💜', css: 'html::after{content:"";position:fixed;inset:0;pointer-events:none;background:rgba(118,72,175,.42);mix-blend-mode:color;z-index:2147483646}' },
  { id: 'posdosol', name: 'Pôr do Sol 🟠', css: 'html::after{content:"";position:fixed;inset:0;pointer-events:none;background:rgba(220,88,40,.4);mix-blend-mode:color;z-index:2147483646}' },
  { id: 'cinza', name: 'Cinza Profissional ⚫', css: 'html::after{content:"";position:fixed;inset:0;pointer-events:none;background:rgba(90,90,90,.35);mix-blend-mode:saturation;z-index:2147483646}' },
];
let currentTheme = 'padrao';
let themeCssKeys = [];

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadTheme() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (cfg && cfg.tema && THEMES.some((t) => t.id === cfg.tema)) currentTheme = cfg.tema;
  } catch { /* sem config ainda */ }
}
function saveTheme() {
  try { fs.writeFileSync(configFile(), JSON.stringify({ tema: currentTheme })); } catch { /* ignora */ }
}
async function applyTheme() {
  if (!win) return;
  for (const key of themeCssKeys) {
    try { await win.webContents.removeInsertedCSS(key); } catch { /* ja sumiu */ }
  }
  themeCssKeys = [];
  const theme = THEMES.find((t) => t.id === currentTheme);
  if (theme && theme.css) {
    try { themeCssKeys.push(await win.webContents.insertCSS(theme.css)); } catch { /* pagina fechando */ }
  }
}
function setTheme(id) {
  currentTheme = id;
  saveTheme();
  applyTheme();
  Menu.setApplicationMenu(buildMenu()); // atualiza o radio selecionado no menu
}
// ------------------------------------------------------------------------

// O porteiro do WhatsApp decide pelo header sec-ch-ua (client hints).
// O Electron manda "Electron;v=..." nessas hints — com isso serve a página
// de "atualize o Chrome". Reescreve as hints no fio HTTP pra parecer Chrome.
function installChromeHints(ses) {
  const hints = {
    'User-Agent': CHROME_UA,
    'sec-ch-ua': `"Not A(Brand";v="99", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-full-version-list': `"Not A(Brand";v="99.0.0.0", "Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}"`,
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform-version': '"10.0.0.0"',
    'sec-ch-ua-wow64': 'false',
  };
  const filter = {
    urls: ['https://web.whatsapp.com/*', 'https://*.whatsapp.com/*', 'https://*.whatsapp.net/*'],
  };
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, ...hints } });
  });
}

// Perfis de media features: microfone/camera nas ligacoes
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Evita duas instancias (igual app oficial)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
}

// Toasts de notification do Windows: usa o proprio exe como AppUserModelID
app.setAppUserModelId(process.execPath);

let win = null;
let tray = null;
let quitting = false;

// ---- Modo Bolinha -------------------------------------------------------
let miniMode = false;
let savedBounds = null;

function toggleMini() {
  if (!win) return;
  const wa = screen.getPrimaryDisplay().workArea;
  if (!miniMode) {
    savedBounds = win.getBounds();
    miniMode = true;
    win.setMinimumSize(300, 480);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setOpacity(0.9);
    win.setSize(370, 620);
    win.setPosition(wa.x + wa.width - 380, wa.y + wa.height - 632);
  } else {
    miniMode = false;
    win.setAlwaysOnTop(false);
    win.setOpacity(1);
    win.setMinimumSize(540, 420);
    if (savedBounds) win.setBounds(savedBounds);
  }
  win.show();
  win.focus();
}
// -------------------------------------------------------------------------

// ---- Enviar pra numero nao salvo ----------------------------------------
function promptNumero() {
  if (!win) return;
  const prompt = new BrowserWindow({
    width: 380,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    parent: win,
    title: 'Mandar pra número não salvo',
    backgroundColor: '#111b21',
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#111b21;color:#e9edef;
         display:flex;flex-direction:column;justify-content:center;gap:12px;padding:20px;margin:0}
    input{background:#2a3942;border:1px solid #2a3942;border-radius:8px;color:#e9edef;
          padding:10px 12px;font-size:15px;outline:none}
    input:focus{border-color:#21c063}
    button{background:#21c063;border:none;border-radius:8px;color:#111b21;font-weight:600;
           padding:10px;font-size:15px;cursor:pointer}
    small{color:#8696a0;font-size:11px}
  </style></head><body>
    <div>
      <input id="n" placeholder="55 22 99999-9999" autofocus>
      <button id="go">Enviar mensagem</button>
      <small>Formato internacional (55 + DDD + número), só dígitos.</small>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const enviar = () => {
        const v = document.getElementById('n').value.replace(/\\D/g, '');
        if (v.length >= 10) { ipcRenderer.send('enviar-numero', v); window.close(); }
      };
      document.getElementById('go').onclick = enviar;
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
    </script>
  </body></html>`;
  prompt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}
// -------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1250,
    height: 840,
    minWidth: 540,
    minHeight: 420,
    show: false,
    backgroundColor: '#111b21',
    autoHideMenuBar: true,
    title: 'WhatsApp Web',
    icon: ICON_512,
    webPreferences: {
      contextIsolation: false, // preciso do preload no mundo da pagina pra forjar a identidade Chrome
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      scrollBounce: true,
    },
  });

  // User-Agent de Chrome puro no header HTTP (uentes do site e subrequests)
  const ses = win.webContents.session;
  ses.setUserAgent(CHROME_UA);

  // Permissoes: media (mics/cam das ligacoes) e notifications
  const allowed = new Set([
    'media',
    'mediaKeySystem',
    'audioCapture',
    'videoCapture',
    'desktopCapture',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
  ]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));

  // Links externos (noticias etc.) abrem no navegador do sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(WEB_URL)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // A janela principal nunca sai do WhatsApp Web
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(WEB_URL)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // Badge de unread + piscar na taskbar
  win.webContents.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const match = title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    app.setBadgeCount(count);
    win.setTitle(count > 0 ? `WhatsApp Web (${count})` : 'WhatsApp Web');
    if (count > 0 && win && !win.isFocused()) win.flashFrame(true);
    if (count === 0 && win) win.flashFrame(false);
  });

  win.on('focus', () => win.flashFrame(false));
  win.once('ready-to-show', () => win.show());

  win.loadURL(WEB_URL);

  // Fechar = esconder na bandeja (comportamento de messenger). Abrir de novo pelo tray ou atalho.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  tray.setToolTip('WhatsApp Web');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Mostrar WhatsApp',
        click: () => {
          if (!win) createWindow();
          win.show();
          win.focus();
        },
      },
      {
        label: miniMode ? 'Sair do Modo Bolinha' : 'Modo Bolinha 🐣',
        click: toggleMini,
      },
      { label: 'Mandar pra número não salvo', click: promptNumero },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => {
    if (!win) createWindow();
    if (win.isVisible() && win.isFocused()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  installChromeHints(session.defaultSession);

  // Log de diagnostico: o que a pagina enxerga da identidade do navegador
  app.on('preload-error', (e, preloadPath, error) => {
    console.error('PRELOAD ERRO:', preloadPath, error);
  });
  const trace = (info) => {
    try { require('fs').writeFileSync('C:\\Users\\Public\\wap-debug.log', JSON.stringify(info)); } catch { /* ignora */ }
  };

  // Atalho global: ligar/desligar Modo Bolinha de qualquer lugar
  globalShortcut.register('CommandOrControl+Alt+M', toggleMini);

  // "Enviar pra numero nao salvo": abre a conversa com o numero informado
  ipcMain.on('enviar-numero', (e, digits) => {
    if (!win) return;
    win.webContents.loadURL(`${WEB_URL}/send?phone=${digits}`);
  });

  loadTheme();
  applyTheme();

  function buildMenu() {
    return Menu.buildFromTemplate([
      {
        label: 'Arquivo',
        submenu: [
          {
            label: 'Mostrar WhatsApp',
            accelerator: 'CmdOrCtrl+Shift+W',
            click: () => {
              if (win) {
                win.show();
                win.focus();
              }
            },
          },
          { label: 'Modo Bolinha 🐣', click: toggleMini },
          { label: 'Mandar pra número não salvo', click: promptNumero },
          { type: 'separator' },
          {
            label: 'Sair',
            accelerator: 'CmdOrCtrl+Q',
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ],
      },
      {
        label: 'Temas',
        submenu: THEMES.map((t) => ({
          label: t.name,
          type: 'radio',
          checked: currentTheme === t.id,
          click: () => setTheme(t.id),
        })),
      },
      {
        label: 'Visualizar',
        submenu: [
          { role: 'reload', label: 'Recarregar' },
          { role: 'forceReload', label: 'Forcar recarga' },
          { type: 'separator' },
          { role: 'zoomIn', label: 'Aumentar zoom' },
          { role: 'zoomOut', label: 'Diminuir zoom' },
          { role: 'resetZoom', label: 'Zoom padrao' },
          { type: 'separator' },
          { role: 'toggleDevTools', label: 'DevTools' },
        ],
      },
    ]);
  }
  Menu.setApplicationMenu(buildMenu());

  createWindow();
  createTray();

  win.webContents.on('did-finish-load', async () => {
    try {
      const info = await win.webContents.executeJavaScript(
        `JSON.stringify({ href: location.href, ua: navigator.userAgent, brands: (navigator.userAgentData ? navigator.userAgentData.brands : null) })`
      );
      trace(info);
    } catch { /* pagina pode bloquear js injetado */ }
    applyTheme(); // reaplica o tema a cada carregamento do site
  });

  app.on('activate', () => {
    if (win) {
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
});

// Atalhos globais morrem junto com o app
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Nao encerra ao fechar a janela (fica na bandeja); so sai explicitamente
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // nao faz nada — deixa o tray vivo
  }
});

app.on('before-quit', () => {
  quitting = true;
});
