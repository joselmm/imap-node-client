import makeWASocket, { useMultiFileAuthState, Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { uploadFolderZipToGAS } from "../compress-sessions.js";
import { consultarCodigo, obtenerNumeroLocal } from "./consultarCodigo.js";

import { generatePassword, procesarCalculo, procesarPago } from "./utils.js"
import { asignarPlataformas, queryData } from "./platformFunctions.js"
import { renewMultiplePlatforms } from "./renewPlatform.js"
import { remplazarEtiquetas, fetchPlatformTemplate } from "./waTemplate.js"
const port = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());


let qrCodeBase64 = "";
let pairingCode = "";
let sock = null;
let codeModoAdmin = false;
let emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const CONTACT_ESPOSA = "3227715717";
const CONTACT_MARIDO = "3045768265";

let lastTimeConected = null;
let backupTimer = null;
let isBackingUp = false;
let reconnectDelay = 2000;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const AUTH_FOLDER = "./auth_info";
const netflixHouseHoldPath = "./netflix_house.html"

function isAuthorized(remoteJid, rawSenderContact, isMe) {
  if (isMe) return true;
  if (rawSenderContact === CONTACT_ESPOSA || rawSenderContact === CONTACT_MARIDO) return true;
  return !remoteJid.endsWith('@g.us');
}

// 🔧 Función auxiliar para borrar y reiniciar
function resetAuthFolder() {
  try {
    const authPath = path.resolve(AUTH_FOLDER);
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log("🗑️ Carpeta auth_info eliminada correctamente.");
    }
  } catch (err) {
    console.error("❌ Error eliminando carpeta auth_info:", err);
  }
  reconnectAttempts = 0;
  reconnectDelay = 2000;
  console.log("🔄 Reiniciando conexión desde cero...");
  connectToWhatsApp(); // reinicia limpio
}

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



app.get("/netflix-house", (req, res) => {
  // Verificamos si la variable tiene una ruta válida
  if (fs.existsSync(netflixHouseHoldPath)) {

    // Es buena práctica usar path.resolve para rutas absolutas
    res.sendFile(path.resolve(netflixHouseHoldPath));

  } else {
    // Si no existe o la variable no está definida
    res.status(404).send("No se encontró el archivo");
  }
});

app.get("/refresh-functions", async (req, res) => {
  try {
    const text = await fetch(process.env.EVAL_FNC)
      .then(e => e.text())
      .catch(() => null);

    if (!text) {
      return res.status(500).send("No se pudo obtener el script remoto");
    }

    // Eval global del código remoto
    (0, eval)(text);

    res.send("Funciones refrescadas (sin reiniciar la app):\n\n" + text);

  } catch (err) {
    console.error("Error en /refresh-functions:", err);
    res.status(500).send("Error al refrescar funciones");
  }
});

app.get("/save-session", async (req, res) => {
  try {
    await uploadFolderZipToGAS();
    res.status(200).send("Se guardo correctamente la sesion de wa en la nube")

  } catch (err) {
    console.error("Error en /refresh-functions:", err);
    res.status(500).send("Error al guardar la sesion de wa en la nube");
  }
});

app.post('/send', async (req, res) => {
  var responseObject = {
    noError: true
  }

  try {
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
      return res.status(400).json({ error: 'Faltan parámetros: numero o mensaje' });
    }

    const resultado = await sendMessage(numero, mensaje);
    responseObject.waResponse = resultado;

  } catch (error) {
    responseObject.noError = false;
    responseObject.errorMessage = error.message
  } finally {
    res.json(responseObject);

  }



});

app.listen(port, () => console.log("📡 Servidor QR en puerto " + port));


// --- CONEXIÓN A WHATSAPP ---
export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Usando versión de WA v${version.join('.')}, isLatest: ${isLatest}`);
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows("Browser"),
    markOnlineOnConnect: false,
    version,
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
      if (backupTimer) clearTimeout(backupTimer);

      // Backup tras 10 segundos
      backupTimer = setTimeout(async () => {
        if (isBackingUp) return console.log("⏳ Backup ya en progreso, cancelado.");

        if (lastTimeConected && Date.now() - lastTimeConected >= 30_000) {
          isBackingUp = true;
          try {
            console.log("🗄️ Pasaron 30 segundos — guardando sesión en Drive...");
            await uploadFolderZipToGAS();
            console.log("✅ Sesión subida a Google Apps Script");
          } catch (err) {
            console.error("❌ Error subiendo sesión:", err?.message || err);
          } finally {
            isBackingUp = false;
          }
        }
      }, 30_000);

      qrCodeBase64 = "";
      pairingCode = "";
      reconnectDelay = 2000;
      reconnectAttempts = 0;
    }

    // Desconectado
    if (connection === "close") {
      if (backupTimer) clearTimeout(backupTimer);
      lastTimeConected = null;
      isBackingUp = false;

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("⚠️ Desconectado.", shouldReconnect ? "Intentando reconectar..." : "Sesión cerrada.");

      reconnectAttempts++;
      console.log(`🔁 Intento de reconexión #${reconnectAttempts}`);

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn(`❌ Se superaron ${MAX_RECONNECT_ATTEMPTS} intentos o sesión inválida.`);
        return resetAuthFolder();
      }

      if (shouldReconnect) {
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 60000);
          connectToWhatsApp().catch(err => console.error("Error reconectando:", err));
        }, reconnectDelay);
      } else {
        // Si no debe reconectar, igual resetea
        resetAuthFolder();
      }
    }
  });


  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    // --- NUEVA LÍNEA: Intentar procesar cálculo primero ---
    if (await procesarCalculo(msg, sock)) return;
    if (await procesarPago(msg, sock)) return;
    // -----------------------------------------------------

    // 1. IDENTIFICACIÓN (Limpieza de JID)
    let jidReal = msg.key.remoteJid;
    if (jidReal.includes('@lid') && msg.key.remoteJidAlt) {
      jidReal = msg.key.remoteJidAlt;
    }
    const remoteJid = jidReal.split(':')[0];

    // Detectar grupo y obtener remitente real
    const isGroup = remoteJid.endsWith('@g.us');
    const senderJid = isGroup ? (msg.key.participant || remoteJid) : remoteJid;
    const senderJidClean = senderJid.includes(':') ? senderJid.split(':')[0] : senderJid;
    const rawSenderContact = obtenerNumeroLocal(senderJidClean);
    const senderContact = rawSenderContact === CONTACT_ESPOSA ? CONTACT_MARIDO : rawSenderContact;

    // VARIABLE CLAVE: ¿Es el dueño del bot?
    const isMe = msg.key.fromMe;

    // Extraer texto limpio
    const messageContent = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    const messageLower = messageContent.toLowerCase();

    // --- BLOQUE 1: SOLO PARA EL DUEÑO (ADMIN) ---
    if (isMe) {
      if (messageLower.startsWith("/pass")) {
        return await sock.sendMessage(remoteJid, { text: generatePassword(messageLower) });
      }

      // Control del interruptor global (opcional)
      if (messageLower === "/admin_mode") {
        global.modoAdminCode = true;
        return await sock.sendMessage(remoteJid, { text: "👑 MODO ADMIN: ACTIVADO" });
      }

      if (messageLower === "//admin_mode") {
        global.modoAdminCode = false;
        return await sock.sendMessage(remoteJid, { text: "🔒 MODO ADMIN: DESACTIVADO" });
      }

      // Si tú envías UN CORREO DIRECTO (sin el "consultar:") y el modo está activo
      if (global.modoAdminCode && emailRegex.test(messageLower)) {
        return ejecutarConsulta(messageLower, process.env.SUPERADMIN_MASTER_KEY, remoteJid, true);
      }

      // ── /renovar: Renovar una o varias plataformas por email ──
      if (messageLower.startsWith("/renovar")) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const textAfterCommand = messageContent.slice("/renovar".length).trim();
        let emails = textAfterCommand.match(emailRegex) || [];

        if (emails.length === 0) {
          const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (quotedMsg) {
            const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
            emails = quotedText.match(emailRegex) || [];
          }
        }

        let clientIdFilter = null;
        if (emails.length > 0) {
          const isGroup = remoteJid.endsWith('@g.us');
          if (!isGroup) {
            const chatNumber = obtenerNumeroLocal(remoteJid);
            const ownerNumber = obtenerNumeroLocal(process.env.WHATSAPP_CONTACT + '@s.whatsapp.net');
            if (chatNumber !== ownerNumber) {
              const clientRes = await queryData('clients', `@contact@ == '${chatNumber}'`);
              if (clientRes.noError && clientRes.data?.length > 0) {
                clientIdFilter = clientRes.data[0].id;
              }
            }
          }
        }

        if (emails.length === 0) {
          return await sock.sendMessage(remoteJid, {
            text: "⚠️ Usa: `/renovar email1@correo.com, email2@correo.com`\nO responde a un mensaje que contenga correos con `/renovar`"
          });
        }

        const statusKey = (await sock.sendMessage(remoteJid, { text: `🔍 Buscando plataforma(s)...` })).key;

        try {
          let platforms;

          if (emails.length > 0) {
            const emailCondition = emails.map(e => `@email@ == '${e}'`).join(' || ');
            const platRes = await queryData('platforms', emailCondition);
            if (!platRes.noError || !platRes.data || platRes.data.length === 0) {
              await sock.sendMessage(remoteJid, { text: `❌ No se encontraron plataformas con esos emails`, edit: statusKey });
              return;
            }
            platforms = clientIdFilter
              ? platRes.data.filter(p => p.clientId === clientIdFilter)
              : platRes.data;
          }

          if (!platforms || platforms.length === 0) {
            await sock.sendMessage(remoteJid, { text: `❌ No se encontraron plataformas`, edit: statusKey });
            return;
          }

          const allCondition = `@id@ != ''`;
          const [platNamesRes, clientsRes] = await Promise.all([
            queryData('platformNames', allCondition),
            queryData('clients', allCondition),
          ]);
          const platformNames = platNamesRes.data || [];
          const clients = clientsRes.data || [];
          const template = await fetchPlatformTemplate();

          const allPlatforms = await renewMultiplePlatforms(platforms);

          let renovadasCount = 0;
          let errores = [];

          for (let i = 0; i < platforms.length; i++) {
            const plat = platforms[i];
            const platActualizada = allPlatforms.find(p => p.id === plat.id);

            if (!platActualizada) {
              errores.push(plat.email);
              if (i === 0) {
                await sock.sendMessage(remoteJid, { text: `❌ ${plat.email}\nNo se encontró en la respuesta`, edit: statusKey });
              }
              continue;
            }

            renovadasCount++;
            const client = clients.find(c => c.id === platActualizada.clientId);
            const platName = platformNames.find(pn => pn.id === platActualizada.platformNameId)?.platformName || platActualizada.email;
            const msg = (client && template) ? remplazarEtiquetas(platActualizada, client, template, 'renewal', platformNames) : '';

            if (i === 0) {
              await sock.sendMessage(remoteJid, { text: msg || `✅ *${platName}* renovada`, edit: statusKey });
            } else {
              await sock.sendMessage(remoteJid, { text: msg || `✅ *${platName}* renovada` });
            }
          }

          let resumen = `✅ ${renovadasCount} de ${platforms.length} plataforma(s) renovada(s)`;
          if (errores.length > 0) {
            resumen += `\n❌ ${errores.length} error(es): ${errores.join(', ')}`;
          }
          await sock.sendMessage(remoteJid, { text: resumen });

        } catch (e) {
          console.error("Error en /renovar:", e);
          await sock.sendMessage(remoteJid, { text: `❌ Error: ${e.message}`, edit: statusKey });
        }
        return;
      }

    }

    // --- BLOQUE 2: PARA TODOS (USUARIOS Y ADMIN) ---
    if (messageLower.startsWith("consultar:")) {
      if (!isAuthorized(remoteJid, rawSenderContact, isMe)) {
        return await sock.sendMessage(remoteJid, { text: "❌ Este comando solo está disponible en chats privados." });
      }

      const email = messageContent.split(":")[1]?.trim();

      if (!emailRegex.test(email)) {
        return await sock.sendMessage(remoteJid, { text: "⚠️ Formato: `consultar:correo@ejemplo.com`" });
      }

      const llave = isMe ? process.env.SUPERADMIN_MASTER_KEY : senderContact;

      return ejecutarConsulta(email, llave, remoteJid, false);
    }

    if (messageLower.startsWith("asignar:") || messageLower.startsWith("asignar: ")) {
      const parts = messageContent.split(":");
      const clienteEmail = parts[1]?.trim();

      let plataformasEmails = [];
      if (parts.length === 3) {
        plataformasEmails = parts[2].split(/[,;\n]+/).map(e => e.trim()).filter(e => e);
      } else if (parts.length > 3) {
        plataformasEmails = parts.slice(2).map(e => e.trim()).filter(e => e);
      }

      if (!emailRegex.test(clienteEmail) || plataformasEmails.length === 0) {
        return await sock.sendMessage(remoteJid, {
          text: "⚠️ *Formato:* `asignar:correocliente@ejemplo.com:correoplataforma@ejemplo.com`\n\nPara varias plataformas:\n`asignar:correo@ej.com:correo1@ej.com,correo2@ej.com`"
        });
      }

      await sock.sendMessage(remoteJid, { text: `🔄 Asignando plataformas a *${clienteEmail}*...` });
      await sock.sendPresenceUpdate('composing', remoteJid);

      try {
        const resultado = await asignarPlataformas(clienteEmail, plataformasEmails, senderContact, isMe);
        await sock.sendPresenceUpdate('paused', remoteJid);

        let respuesta = "";
        if (resultado.noError) {
          const r = resultado.results;
          respuesta = `✅ *ASIGNACIÓN COMPLETADA*\n\n👤 *Cliente:* ${resultado.clienteEmail}\n\n`;
          if (r.asignadas.length > 0) {
            respuesta += `✅ *Asignadas:* ${r.asignadas.length}\n${r.asignadas.map(e => `• ${e}`).join('\n')}\n\n`;
          }
          if (r.yaAsignadas.length > 0) {
            respuesta += `⚠️ *Ya estaban asignadas:* ${r.yaAsignadas.length}\n${r.yaAsignadas.map(e => `• ${e}`).join('\n')}\n\n`;
          }
          if (r.inactivas.length > 0) {
            respuesta += `💤 *Inactivas (saltadas):* ${r.inactivas.length}\n${r.inactivas.map(e => `• ${e}`).join('\n')}\n\n`;
          }
          if (r.noEncontradas.length > 0) {
            respuesta += `❌ *No encontradas:* ${r.noEncontradas.length}\n${r.noEncontradas.map(e => `• ${e}`).join('\n')}\n\n`;
          }
        } else {
          respuesta = `❌ *ERROR*\n\n⚠️ ${resultado.errorMessage}`;
        }

        return await sock.sendMessage(remoteJid, { text: respuesta });
      } catch (e) {
        await sock.sendPresenceUpdate('paused', remoteJid);
        console.error("Error en asignar:", e);
        return await sock.sendMessage(remoteJid, { text: `❌ *ERROR*\n\n⚠️ ${e.message}` });
      }
    }
  });

  // --- FUNCIÓN DE CONSULTA (Para no repetir código) ---
  async function ejecutarConsulta(email, identificador, jid, esModoAdminDirecto) {
    if (!sock) return;
    try {
      await sock.sendMessage(jid, { text: `🔎 Buscando para *${email}*...` });

      await sock.sendPresenceUpdate('composing', jid);
      const resultado = await consultarCodigo(email, identificador);
      await sock.sendPresenceUpdate('paused', jid);

      let respuesta = "";

      if (resultado.noError) {
        if (esModoAdminDirecto) {
          // ⚡ FORMATO CORTO (Solo para ti)
          respuesta = `✅ *CONSULTA EXITOSA*\n\n` +
            `*Servicio:* ${resultado.about}\n` +
            (resultado.profileName ? `\n👤 *Perfil:* ${resultado.profileName}\n` : "") +
            (resultado.code ? `\n🔑 *Código:* \`${resultado.code}\`\n\n` : "") + // <--- Doble \n antes y después
            (resultado.link ? `\n🔗 *Enlace:* ${resultado.link}\n\n` : "") + // <--- Doble \n antes y después
            (resultado.estimatedTimeAgo ? `🕒 *Recibido:* ${resultado.estimatedTimeAgo}\n` : "");


        } else {
          // 📝 FORMATO LARGO (Para consultar:)
          respuesta = `✅ *CONSULTA EXITOSA*\n\n` +
            `*Servicio:* ${resultado.about}\n` +
            (resultado.profileName ? `\n👤 *Perfil:* ${resultado.profileName}\n` : "") +
            (resultado.code ? `\n🔑 *Código:* \`${resultado.code}\`\n\n` : "") + // <--- Doble \n antes y después
            (resultado.link ? `\n🔗 *Enlace:* ${resultado.link}\n\n` : "") + // <--- Doble \n antes y después
            (resultado.estimatedTimeAgo ? `🕒 *Recibido:* ${resultado.estimatedTimeAgo}\n` : "") +
            `\n${process.env.ADMIN_DOMAIN || ""}`;
        }
      } else {
        respuesta = `❌ *ERROR*\n\n⚠️ ${resultado.message}`;
      }

      await sock.sendMessage(jid, { text: respuesta });
    } catch (e) {
      console.error("Error en consulta:", e);
      await sock.sendMessage(jid, { text: "🤯 Error en el servidor." });
    }
  }
}


// --- ENVIAR MENSAJE ---
export async function sendMessage(numeroConPrefijo, texto) {
  if (!sock) throw new Error("❌ No conectado");
  const jid = numeroConPrefijo.replace(/^\+/, "") + "@s.whatsapp.net";
  var resWa = await sock.sendMessage(jid, { text: texto })
  console.log(`📤 Mensaje enviado a ${numeroConPrefijo}`);
  return resWa;
}


// --- OBTENER QR O CODE ---
export function getQRCode() {
  return qrCodeBase64 || pairingCode || null;
}
