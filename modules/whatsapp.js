// module.js
//import makeWASocket from "baileys";
import { useMultiFileAuthState, makeWASocket } from "baileys";
import QRCode from "qrcode";
import express from "express"
import cors from "cors";
const port = process.env.PORT || 3000;
const app = express();
app.use(cors())

app.get('/qr', (req, res) => {
  if (!qrCodeBase64) {
    return res.send("QR no disponible, espera un momento...");
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>QR Code</title>
      </head>
      <body>
        <h1>Escanea este código QR para conectar WhatsApp</h1>
        <img src="${qrCodeBase64}" alt="QR Code" />
      </body>
    </html>`;

  res.send(html);
});

app.listen(port, () => { console.log("servidor qr escuchando en puerto " + port) })



// Estado interno
let sock = null;
let qrCodeBase64 = "";

/**
 * Inicia la sesión de WhatsApp y genera QR cuando sea necesario.
 */
export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  sock = makeWASocket({ auth: state, printQRInTerminal: true });

  // Guarda credenciales automáticamente
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (msg) => {
    const m = msg.messages[0];
    // Si el mensaje es enviado por el propio bot, ignorarlo
    if (m.key.fromMe) {
      if(!(m==="@")) return;

      await sock.sendMessage(
          msg.messages[0].key.remoteJid,
          {
            text: `Si sigo vivo 🤖 987287460247924`
          }

        );

    };

    if (msg.messages[0].key.remoteJid.endsWith("@g.us")) return //ignora grupos

      if (process.env.OWNER === "leiner") {
        await sock.sendMessage(
          msg.messages[0].key.remoteJid,
          {
            text: `📢 *Atención*

Este número no gestiona ventas. Este número *solo se usa para enviar códigos y links de verificación (no lo borres de tus contactos)*.

Si estás interesado en adquirir plataformas de streaming, comunícate directamente con nuestro vendedor:  
👇👇👇  
https://wa.me/573058588651`
          }

        );
      }
    // Enviar mensaje solicitando un email


  });

  // Cada vez que haya un update de conexión o QR:
  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      // Genera Data URL para frontend
      qrCodeBase64 = await QRCode.toDataURL(qr);
      // console.log("🔶 QR actualizado");
    }
    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");
    } else if (connection === "close") {
      console.log("⚠️ Desconectado. Reconectando...");
      await connectToWhatsApp();
    }
  });
}

/**
 * Devuelve el último QR generado como Data URL (base64).
 * Ideal para servir en un endpoint o mostrar en tu UI.
 */
export function getQRCode() {
  return qrCodeBase64;
}

/**
 * Envía un mensaje de texto a un número con prefijo internacional.
 * @param {string} numeroConPrefijo Ej: "+584123456789"
 * @param {string} texto            Texto a enviar
 */
export async function sendMessage(numeroConPrefijo, texto) {
  if (!sock) {
    throw new Error("❌ No conectado: llama primero a `conectarse()`.");
  }
  const jid = numeroConPrefijo.replace(/^\+/, "") + "@s.whatsapp.net";
  await sock.sendMessage(jid, { text: texto });
  console.log(`📤 Mensaje enviado a ${numeroConPrefijo}`);
}
