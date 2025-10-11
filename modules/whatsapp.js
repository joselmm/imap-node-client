// module.js
import { useMultiFileAuthState, makeWASocket } from "baileys";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "node:path";

const port = process.env.PORT || 3000;
const app = express();
app.use(cors());

let sock = null;
let qrCodeBase64 = "";
let reconnectAttempts = 0;
const MAX_RETRIES = 10;

app.get("/qr", (req, res) => {
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

app.listen(port, () => {
  console.log("Servidor QR escuchando en puerto " + port);
});

/**
 * Inicia la sesión de WhatsApp en el path indicado y genera QR cuando sea necesario.
 * @param {string} authPath - Ruta a la carpeta de autenticación (por defecto ./auth_info)
 */
export async function connectToWhatsApp(authPath = "./auth_info") {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    sock = makeWASocket({
      auth: state,
      markOnlineOnConnect: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (msg) => {
      const m = msg.messages[0];
      if (m.key.fromMe) return;
      if (m.key.remoteJid.endsWith("@g.us")) return;

      if (process.env.OWNER === "leiner") {
        await sock.sendMessage(m.key.remoteJid, {
          text: `📢 *Atención*\n\nEste número no gestiona ventas. Solo se usa para enviar códigos y links de verificación.\n\nPara ventas, contacta al vendedor:\n👇👇👇\nhttps://wa.me/573058588651`,
        });
      }
    });

    sock.ev.on("connection.update", async ({ connection, qr }) => {
      if (qr) {
        qrCodeBase64 = await QRCode.toDataURL(qr);
        console.log("🔶 QR actualizado");
      }

      if (connection === "open") {
        console.log("✅ Conectado a WhatsApp");
        reconnectAttempts = 0; // reiniciar contador
      } else if (connection === "close") {
        reconnectAttempts++;
        console.log(`⚠️ Desconectado (intento ${reconnectAttempts}/${MAX_RETRIES})`);

        if (reconnectAttempts >= MAX_RETRIES) {
          console.log("❌ Límite de reintentos alcanzado. Eliminando carpeta auth_info...");
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log("🧹 Carpeta auth_info eliminada. Se generará un nuevo QR.");
          } catch (err) {
            console.error("Error al eliminar la carpeta:", err);
          }
          reconnectAttempts = 0;
        }

        // Esperar 2 segundos antes de intentar reconectar
        await new Promise((r) => setTimeout(r, 2000));
        await connectToWhatsApp(authPath);
      }
    });
  } catch (err) {
    console.error("❌ Error en connectToWhatsApp:", err);
  }
}

/**
 * Devuelve el último QR generado en base64.
 */
export function getQRCode() {
  return qrCodeBase64;
}

/**
 * Envía un mensaje de texto.
 */
export async function sendMessage(numeroConPrefijo, texto) {
  if (!sock) {
    throw new Error("❌ No conectado: llama primero a connectToWhatsApp().");
  }
  const jid = numeroConPrefijo.replace(/^\+/, "") + "@s.whatsapp.net";
  await sock.sendMessage(jid, { text: texto });
  console.log(`📤 Mensaje enviado a ${numeroConPrefijo}`);
}
