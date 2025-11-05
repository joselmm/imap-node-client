import makeWASocket, { useMultiFileAuthState, Browsers, DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";
import { uploadFolderZipToGAS } from "../compress-sessions.js";

const port = process.env.PORT || 3000;
const app = express();
app.use(cors());

let qrCodeBase64 = "";
let pairingCode = "";
let sock = null;

let lastTimeConected = null;
let backupTimer = null;
let isBackingUp = false;
let reconnectDelay = 2000; // ms (backoff)

// --- SERVIDOR QR ---
app.get("/qr", (req, res) => {
  let html = `
  <html>
  <head><meta charset="utf-8"><title>QR WhatsApp</title></head>
  <body style="font-family:sans-serif; text-align:center; margin-top:3rem;">
    <h2>Conecta tu WhatsApp</h2>
  `;
  if (qrCodeBase64)
    html += `<img src="${qrCodeBase64}" alt="QR" width="300"/>`;
  else if (pairingCode)
    html += `<h3>🔢 Código de vinculación: ${pairingCode}</h3>`;
  else
    html += `<p>Esperando QR o código...</p>`;

  html += "</body></html>";
  res.send(html);
});

app.listen(port, () => console.log("📡 Servidor QR en puerto " + port));


// --- CONEXIÓN A WHATSAPP ---
export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows('Browser'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, pairingCode: code } = update;

    // QR
    if (qr) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(qr);
        pairingCode = "";
        console.log("📱 Escanea el QR en: http://localhost:" + port + "/qr");
      } catch (err) {
        console.error("Error generando QR:", err);
      }
    }

    // Código de vinculación
    if (code) {
      pairingCode = code;
      qrCodeBase64 = "";
      console.log(`🔢 Código de vinculación: ${code}`);
      console.log("➡️ En tu WhatsApp: Ajustes → Dispositivos vinculados → Vincular con código");
    }

    // Conectado
    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");

      lastTimeConected = Date.now();

      // Cancelar timer previo si existe
      if (backupTimer) clearTimeout(backupTimer);

      // Backup cuando hayan pasado 10s sin desconexión
      backupTimer = setTimeout(async () => {
        if (isBackingUp) return console.log("⏳ Backup ya en progreso, cancelado.");

        if (lastTimeConected && (Date.now() - lastTimeConected) >= 10000) {
          isBackingUp = true;
          try {
            console.log("🗄️ Pasaron 10 segundos — guardando sesión en Drive...");
            await uploadFolderZipToGAS();
            console.log("✅ Sesión subida a Google Apps Script");
          } catch (err) {
            console.error("❌ Error subiendo sesión:", err?.message || err);
          } finally {
            isBackingUp = false;
          }
        }
      }, 10000);

      qrCodeBase64 = "";
      pairingCode = "";
      reconnectDelay = 2000; // reset del backoff
    }

    // Desconectado
    if (connection === "close") {
      if (backupTimer) clearTimeout(backupTimer);
      lastTimeConected = null;
      isBackingUp = false;

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("⚠️ Desconectado.", shouldReconnect ? "Intentando reconectar..." : "Sesión cerrada.");

      if (shouldReconnect) {
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 60000);
          connectToWhatsApp().catch(err => console.error("Error reconectando:", err));
        }, reconnectDelay);
      }
    }
  });
}


// --- ENVIAR MENSAJE ---
export async function sendMessage(numeroConPrefijo, texto) {
  if (!sock) throw new Error("❌ No conectado");
  const jid = numeroConPrefijo.replace(/^\+/, "") + "@s.whatsapp.net";
  await sock.sendMessage(jid, { text: texto });
  console.log(`📤 Mensaje enviado a ${numeroConPrefijo}`);
}


// --- OBTENER QR O CODE ---
export function getQRCode() {
  return qrCodeBase64 || pairingCode || null;
}
