import makeWASocket, { useMultiFileAuthState, Browsers,DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";

const port = process.env.PORT || 3000;
const app = express();
app.use(cors());

// Variable para almacenar el último QR
let qrCodeBase64 = "";
let pairingCode = "";
let sock = null;

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

/** Inicia sesión de WhatsApp */
export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // ahora se maneja manualmente
    browser: Browsers.windows('Browser'),
    markOnlineOnConnect: false,
    syncFullHistory:false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, receivedPendingNotifications, isNewLogin, pairingCode: code } = update;

    if (qr) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(qr);
        pairingCode = "";
        console.log("📱 Escanea el QR en: http://localhost:" + port + "/qr");
      } catch (err) {
        console.error("Error generando QR:", err);
      }
    }

    if (code) {
      pairingCode = code;
      qrCodeBase64 = "";
      console.log(`🔢 Código de vinculación: ${code}`);
      console.log("➡️ En tu WhatsApp: Ajustes → Dispositivos vinculados → Vincular con código");
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");
      qrCodeBase64 = "";
      pairingCode = "";
    } else if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ Desconectado.", shouldReconnect ? "Reconectando..." : "Sesión cerrada.");
      if (shouldReconnect) await connectToWhatsApp();
    }
  });
}

/** Enviar mensaje */
export async function sendMessage(numeroConPrefijo, texto) {
  if (!sock) throw new Error("❌ No conectado");
  const jid = numeroConPrefijo.replace(/^\+/, "") + "@s.whatsapp.net";
  await sock.sendMessage(jid, { text: texto });
  console.log(`📤 Mensaje enviado a ${numeroConPrefijo}`);
}

export function getQRCode() {
  return qrCodeBase64 || pairingCode || null;
}



