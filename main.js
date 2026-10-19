// WhatsApp Web wrapper pra Windows — Electron
// Janela propria, notifications, audio/video pra ligacoes, bandeja (tray) e badge.

const { app, BrowserWindow, Menu, Tray, shell, nativeImage, session } = require('electron');
const path = require('path');

const WEB_URL = 'https://web.whatsapp.com';
const ICON = path.join(__dirname, 'icon-256.png');
const ICON_512 = path.join(__dirname, 'icon-512.png');
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const CHROME_FULL = process.versions.chrome;

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
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// Toasts de notification do Windows: usa o proprio exe como AppUserModelID
app.setAppUserModelId(process.execPath);

let win = null;
let tray = null;
let quitting = false;

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
  const menu = Menu.buildFromTemplate([
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
  Menu.setApplicationMenu(menu);

  createWindow();
  createTray();

  win.webContents.on('did-finish-load', async () => {
    try {
      const info = await win.webContents.executeJavaScript(
        `JSON.stringify({ href: location.href, ua: navigator.userAgent, brands: (navigator.userAgentData ? navigator.userAgentData.brands : null) })`
      );
      trace(info);
    } catch { /* pagina pode bloquear js injetado */ }
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

// Nao encerra ao fechar a janela (fica na bandeja); so sai explicitamente
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // nao faz nada — deixa o tray vivo
  }
});

app.on('before-quit', () => {
  quitting = true;
});
