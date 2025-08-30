// module.js
//import makeWASocket from "baileys";
import { useMultiFileAuthState, makeWASocket } from "baileys";
import QRCode from "qrcode";
import express from "express"
import cors from "cors";
const port = process.env.PORT || 3000;
const app = express();
app.use(cors())

// --- CONFIG: lee modo de autenticación desde variable de entorno ---
// AUTH_MODE puede ser "qr" o "otp" (otp = pairing code)
const AUTH_MODE = (process.env.AUTH_MODE || "qr").toLowerCase();
// número para emparejar cuando AUTH_MODE === "otp", ejemplo: "573001234567"
const PAIR_NUMBER = process.env.PAIR_NUMBER || "";

app.get('/qr', (req, res) => {
  // Si estamos en modo OTP, mostramos el número de pairing (si existe)
  if (AUTH_MODE === "otp") {
    if (!pairingCode) {
      return res.send("Pairing code no disponible, espera un momento...");
    }
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Pairing Code</title>
        </head>
        <body>
          <h1>Código de emparejamiento (pairing code)</h1>
          <p style="font-size:2rem; font-weight:700;">${pairingCode}</p>
          <p>Introduce este código en WhatsApp: Ajustes → Dispositivos vinculados → Vincular un dispositivo → Introducir código</p>
        </body>
      </html>`;
    return res.send(html);
  }

  // Modo por defecto (qr)
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
// variable añadida: guarda el pairing code cuando AUTH_MODE === "otp"
let pairingCode = "";

/**
 * Inicia la sesión de WhatsApp y genera QR cuando sea necesario.
 */
export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  // Ajuste mínimo: activar/desactivar impresión de QR en terminal según el modo
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: AUTH_MODE === "qr", // <-- modificado para respetar AUTH_MODE
    markOnlineOnConnect:false
  });

  // Guarda credenciales automáticamente
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (msg) => {
    const m = msg.messages[0];
    // Si el mensaje es enviado por el propio bot, ignorarlo
    if (m.key.fromMe) return

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
    if (qr && AUTH_MODE === "qr") {
      // Genera Data URL para frontend (solo en modo QR)
      qrCodeBase64 = await QRCode.toDataURL(qr);
      console.log("🔶 QR actualizado");
    }

    // Si estamos en modo OTP, intentamos pedir pairing code (una vez)
    if (AUTH_MODE === "otp" && !pairingCode) {
      if (!PAIR_NUMBER) {
        console.warn("AUTH_MODE=otp pero no se proporcionó PAIR_NUMBER en env.");
      } else {
        try {
          // requestPairingCode es la función de Baileys para generar el código
          pairingCode = await sock.requestPairingCode(PAIR_NUMBER);
          console.log("🔶 Pairing code generado:", pairingCode);
        } catch (err) {
          console.error("Error al solicitar pairing code:", err?.message || err);
        }
      }
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");
    } else if (connection === "close") {
      console.log("⚠️ Desconectado. Reconectando...");
      // Reconectar: nota que si usas pairing code puede fallar según la versión/
      // estado de la sesión — esto es comportamiento de la librería.
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
