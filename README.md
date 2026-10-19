# WhatsApp Web para Windows (wrapper Electron)

Um "WhatsApp Desktop" caseiro pra Windows que dispensa a Microsoft Store:
janela própria, ícone, bandeja (tray), badge de não-lidas, notifications nativas
e suporte a ligações com áudio/vídeo — carregando o WhatsApp Web oficial.

> ⚠️ Projeto de uso pessoal. Não é afiliado ao WhatsApp/Meta.
> O ícone e o nome do WhatsApp pertencem a eles; usados só pra identificar o app.

## Por quê?

A versão de desktop do WhatsApp hoje só se distribui via Microsoft Store (MSIX).
Este projeto empacota o WhatsApp Web num Electron standalone, e resolve o
"porteiro" do site que bloqueia navegadores não-reconhecidos (detalhe abaixo).

## Funcões

- **Janela própria** com ícone do WhatsApp (ícone gerado a partir do SVG oficial)
- **Notificações nativas** do Windows + **badge** de não-lidas na taskbar
  (lê o "(3)" do título da página e vira `app.setBadgeCount`)
- **Alerta visual** (flashe) na taskbar quando chega mensagem sem focus
- **Bandeja de sistema**: fechar (X) esconde; reabre pelo tray ou pelo atalho global
- **Ligações funcionam**: microphone/camera liberados via `setPermissionRequestHandler`
- **Instância única** (não abre duplicado)
- Links externos abrem no navegador do sistema; a janela nunca sai do WhatsApp

## O truque do "porteiro" (a parte interessante)

O WhatsApp Web decide se o navegador é "Chrome 100+" com base nos **client hints
HTTP** (`sec-ch-ua`, `sec-ch-ua-platform` etc.), não só no `User-Agent`.
O Chromium do Electron manda `"Electron";v="44"` nessas hints e aí o site serve
uma página pedindo pra atualizar o Chrome.

A solução tem duas camadas (`main.js` + `preload.js`):

1. **No fio HTTP** — `webRequest.onBeforeSendHeaders` reescreve os headers
   em todas as requests a `*.whatsapp.com` / `*.whatsapp.net`:

   ```
   sec-ch-ua: "Not A(Brand";v="99", "Chromium";v="152", "Google Chrome";v="152"
   ```

2. **No JS da página** — preload roda antes de qualquer script do site e
   redefine `navigator.userAgent`, `appVersion` e `userAgentData`
   (brands sem "Electron", `getHighEntropyValues` coerente).

Importante: usamos o **número real do Chromium embutido**
(`process.versions.chrome`) para o disfarce não mentir sobre capacidades.

## Como rodar / empacotar

Requisitos: Node.js 18+. O empacotamento funciona no Linux/WSL gerando o
binário de Windows (não precisa de Node na máquina Windows):

```bash
# empacota pra Windows x64
npm install --save-dev @electron/packager
npx electron-packager . "WhatsApp Web" \
  --platform=win32 --arch=x64 \
  --icon=icon.ico \
  --app-bundle-id=com.seuusuario.whatsappweb \
  --electron-version=44.9.0 \
  --overwrite \
  --ignore="^/node_modules"
```

O resultado sai em `dist/` como `WhatsApp Web-win32-x64/WhatsApp Web.exe`.
Rodar no Linux (com display) pra testar: `npm install` + `npm start`
(confira `package.json`).

## Ajustes firmais

Passe o electron version sempre pra versão atual:

```bash
npm view electron version
```

Também é possível trocar o nome do produto, ícone (`icon.ico` com
16/24/32/44/48/64/90/120/128/256) e atalhos em `main.js`.

## Debug

Diagnóstico do app: após o carregamento, `/etc` gravado
em `C:\Users\Public\wap-debug.log` (href, userAgent, brands).

## Licença

MIT — veja LICENSE. O WhatsApp e o logo são marcas do WhatsApp LLC / Meta.
