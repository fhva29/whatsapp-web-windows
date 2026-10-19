// Roda ANTES do site carregar, no mesmo mundo do JS da pagina,
// pra forjar uma identidade Chrome pro porteiro do WhatsApp Web.
const chromeFull = process.versions.chrome; // ex: "152.0.7704.5"
const major = chromeFull.split('.')[0];

const chromeUA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;

// 1) navigator.userAgent / appVersion
for (const [prop, value] of [
  ['userAgent', chromeUA],
  ['appVersion', chromeUA.replace(/^Mozilla\//, '')],
]) {
  try {
    Object.defineProperty(Navigator.prototype, prop, { value, configurable: true });
  } catch { /* ignora se nao rolar */ }
}

// 2) navigator.userAgentData (brands sem "Electron" — era isso que o porteiro via)
const brands = [
  { brand: 'Not A(Brand', version: '99' },
  { brand: 'Chromium', version: major },
  { brand: 'Google Chrome', version: major },
];
const userAgentData = {
  brands,
  mobile: false,
  platform: 'Windows',
  getHighEntropyValues: async (hints) => {
    const data = { brands, mobile: false, platform: 'Windows' };
    if (hints.includes('platformVersion')) data.platformVersion = '10.0.0.0';
    if (hints.includes('architecture') || hints.includes('bitness')) {
      data.architecture = 'x86';
      data.bitness = '64';
    }
    if (hints.includes('uaFullVersion')) data.uaFullVersion = chromeFull;
    if (hints.includes('model')) data.model = '';
    if (hints.includes('platform') || hints.includes('wow64')) data.wow64 = false;
    return data;
  },
  toJSON() {
    return { brands, mobile: false };
  },
};
try {
  Object.defineProperty(Navigator.prototype, 'userAgentData', {
    value: userAgentData,
    configurable: true,
  });
} catch { /* ignora */ }
