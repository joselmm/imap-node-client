import { config } from "dotenv";
config();
import { client, handleShutdown } from "./modules/email-listener-imapflow.js";
import { simpleParser } from "mailparser";
import { sendMessage, connectToWhatsApp } from "./modules/whatsapp.js";
import NodeHtmlParser from "node-html-parser";
import fetch from "node-fetch";
import { checkValidClients } from "./modules/google-sheets.js";
import { processIfLink } from "./modules/utils.js";
import { downloadAndUnzipFromGAS } from "./compress-sessions.js";
import fs from "fs";
let appStarted = false;
const DEDUPE_TTL_MS = 7 * 60 * 1000;   // 7 minutos
const CLEANUP_TTL_MS = 10 * 60 * 1000; // 10 minutos (siempre mayor al dedupe)
const PROCESS_WINDOW_SEC = 7 * 60; // 7 minutos
const PROCESSED_LABEL = 'ProcessedByBot';
var stopFailOver = false;
const neverWaFlag = "(NeverWa)";
const noWaFlag = "(NoWa)";



import { sendViaGAS } from "./modules/email-sender.js"
import { desactivateClients } from "./modules/sheet-data-library.js";
import { getNetflixTravelCode, saveNetflixHouseholdHtml } from "./modules/netflix-utils.js";

// ===============================
// DEDUPE EN MEMORIA (45s)
// ===============================
const processedMessages = new Map();
// key: messageId || fallback | value: timestamp



globalThis.NodeHtmlParser = NodeHtmlParser;

async function startApp() {
    // PARA EVITAR DOBLE EJECUCIONE EN EL MISMO ENTORNO
    if (appStarted) return;
    appStarted = true;

    const target = './auth_info';
    try {
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
            console.log('Carpeta auth_info eliminada');
        }
    } catch (err) {
        console.error(`Error al limpiar carpeta: ${err}`);
    }
    try {
        await downloadAndUnzipFromGAS();
    } catch (er) { console.error("Error en descarga y uzip de session:" + er.message) }
    await new Promise(r => setTimeout(r, 1000));

    connectToWhatsApp();

    // --- CONFIGURACIÓN IMAPFLOW ---
    await client.connect();

    // Failover cada 30s
    setInterval(failoverCheck, 30_000);

    // Limpieza de memoria
    setInterval(cleanupProcessedMessages, 30_000);


    // Abrir INBOX
    let lock = await client.getMailboxLock('INBOX');
    try {
        console.log("✅ IMAP Conectado y escuchando INBOX...");


        client.on('exists', async () => {
            const seq = client.mailbox.exists;

            let message;
            try {
                message = await client.fetchOne(seq, { source: true });
            } catch (err) {
                console.error("❌ Fetch error:", err.message);
                return;
            }

            /*   if (message.labels?.includes(PROCESSED_LABEL)) {
                  console.log("⏭️ Exists ignorado (ya procesado por label)");
                  return;
              } */

            const uid = message.uid;




            let parsed;
            try {
                parsed = await simpleParser(message.source);
            } catch (err) {
                console.error("❌ Parse error:", err.message);
                return;
            }

            const rawMid = parsed.messageId || `${uid}-${parsed.date?.getTime()}`;
            const key = normalizeMessageId(rawMid) || rawMid;

            if (processedMessages.has(key)) {
                console.log("⏭️ exists ignorado (ya procesado):", parsed.subject);
                return;
            }

            processedMessages.set(key, Date.now());

            /* try {
                await client.messageLabelsAdd(
                    uid,
                    [PROCESSED_LABEL],
                    { uid: true }
                );
            } catch (e) {
                console.error("⚠️ No se pudo marcar Processed:", uid);
            } */
            console.log("📩 Correo NUEVO (exists):", parsed.subject);
            console.log("para:", parsed.to?.text || "(sin destinatario)");


            procesarCorreo(parsed).catch(err => console.error("❌ procesarCorreo (exists) error:", err));

        });





    } finally {
        lock.release();
    }

    // Manejo de desconexión
    client.on('close', () => {
        handleShutdown();
    });
}

// Tu lógica principal encapsulada
async function procesarCorreo(mail) {
    const ahora = Date.now();
    const recibido = new Date(mail.date).getTime();

    if (!recibido || isNaN(recibido)) {
        console.log("⏩ Ignorado: sin fecha válida", mail.subject);
        return;
    }

    const diferenciaSeg = (ahora - recibido) / 1000;

    if (diferenciaSeg > PROCESS_WINDOW_SEC) {
        console.log(
            `⏩ Ignorado por viejo (${Math.round(diferenciaSeg)}s):`,
            mail.subject
        );
        return; // ⛔ CORTA TODO
    }

    console.log(
        `✅ Correo reciente (${Math.round(diferenciaSeg)}s):`,
        mail.subject
    );

    const context = {
        to: mail.to?.text || "",
        from: mail.from?.text || "",
        profileName: null,
        keyword: ""
    };

    // NOTA: mailparser (ImapFlow) estructura los objetos diferente a mail-listener5
    // mail.to.value[0].address es ahora mail.to.value[0].address
    if (mail.to?.value) context.to = mail.to.value[0].address;
    if (mail.from?.value) context.from = mail.from.value[0].address;

    var result = extractCode(mail.html, mail.subject, context);

    if (result.noError) {
        var validClients = await checkValidClients(context);
        if (context.fraud && validClients) {

            await desactivateClients(validClients);
            return;
        }

        if (validClients) {
            
            await processIfLink(result, context);

            for (const client of validClients) {

                const noWhatsApp = typeof client.name === "string" && client.name.includes(noWaFlag);
                const neverWhatsapp = typeof client.name === "string" && client.name.includes(neverWaFlag);
                // 1️⃣ Preparar número con prefijo (para WhatsApp)
                let numeroConPrefijo = null;
                if (client.prefix && client.contact) {
                    numeroConPrefijo = (client.prefix + client.contact).replaceAll(" ", "");
                }

                // 2️⃣ Buscar y validar email
                let recipientEmail = null;
                if (client.emailContact && typeof client.emailContact === "string") {
                    const emailTrim = client.emailContact.trim();
                    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                    if (emailTrim.match(emailRegex)) {
                        recipientEmail = emailTrim;
                    } else {
                        console.log(`⚠️ Email no válido o ausente (${client.emailContact}) para ${client.name}`);
                    }
                }

                // 3️⃣ Preparar contenido base (código o link)
                const isCode = result.code !== undefined;
                const codigoOLink = isCode ? "código" : "link";
                const contenidoPrincipal = isCode ? result.code : result.link;

                // 4️⃣ Formato del mensaje (texto)
                const boldAbout = result.about
                    .split("\n")
                    .map(line => `*${line}*`)
                    .join("\n");

                /*  const mensajeWhatsApp = `${boldAbout}\n(${context.to})` +
                     (context.profileName ? `\n*Perfil:* ${context.profileName}` : "") +
                     `\n👇👇👇`; */
                const mensajeWhatsApp = `${boldAbout}\n` +
                    (!client.withNoCredentials ? `(${context.to})\n` : "") +
                    (context.profileName ? `*Perfil:* ${context.profileName}\n` : "") +
                    `👇👇👇`;

                const mensajeExtra =
                    `☝️☝️☝️\n\n` +
                    `📢 *Atención* 📢\n` +
                    `Si *no* solicitaste este *${codigoOLink}*, simplemente *ignora* este mensaje.` + (isCode || context.profileName ? "\n" : "") +
                    (!isCode
                        ? `\n*Agrega este contacto 📞 si no te deja abrir el link/enlace 🔗*`
                        : ""
                    ) +
                    (context.profileName
                        ? `\nℹ️ *Recuerda:* Si dejas el nombre del perfil como "${context.profileName}*", tus ${codigoOLink}s llegarán sin problema. ¡Así de fácil! 😄`
                        : ""
                    );


                /*`📩 Ten en cuenta que los *${codigoOLink}s* pueden tardar hasta *un minuto* en llegar.\n` +
            `⏳ Si pediste otro, por favor *espera* — te llegará por este mismo chat.\n` +
            `¡Gracias por tu *paciencia*! 🙏`; */

                // 5️⃣ Envío por WhatsApp (si tiene número)
                if (!noWhatsApp && !neverWhatsapp && numeroConPrefijo) {

                    try {
                        await sendMessage(numeroConPrefijo, mensajeWhatsApp);
                        await sendMessage(numeroConPrefijo, contenidoPrincipal);
                        if (process.env.SEND_ADDITIONAL_INFO) {
                            await sendMessage(numeroConPrefijo, mensajeExtra);
                        }
                        console.log(`📱 Enviado a ${numeroConPrefijo} por WhatsApp`);
                    } catch (err) {
                        console.error(`❌ Error enviando por WhatsApp a ${numeroConPrefijo}:`, err.message);
                    }
                }

                // ===============================
                // 5️⃣ INTENTAR ENVÍO POR EMAIL
                // ===============================
                let emailEnviado = false;

                if (recipientEmail) {
                    const mensajeHTML = `
    <div style="font-family:sans-serif">
        <h2>${result.about}</h2>
        <p>Para: ${context.to}</p>
        ${context.profileName ? `<p><b>Perfil:</b> ${context.profileName}</p>` : ""}
        <p><b>${codigoOLink.toUpperCase()}:</b> ${contenidoPrincipal}</p>
        <hr>
        <p>📢 <b>Atención</b><br>
        Si <b>no</b> solicitaste este ${codigoOLink}, simplemente ignora este mensaje.</p>
        ${!isCode ? "<p>Agrega este contacto 📞 si no te deja abrir el enlace 🔗.</p>" : ""}
        <p>Gracias por tu paciencia 🙏</p>
    </div>
    `;

                    const subject = `${isCode ? "Código" : "Link"} de verificación - ${context.keyword}`;

                    try {
                        const resultadoEmail = await sendViaGAS(recipientEmail, subject, mensajeHTML);

                        if (resultadoEmail.noError) {
                            emailEnviado = true;
                            console.log(`📧 Enviado correctamente a ${recipientEmail}`);
                        } else {
                            console.error(`⚠️ Error al enviar a ${recipientEmail}: ${resultadoEmail.message}`);
                        }

                    } catch (err) {
                        console.error(`❌ Error inesperado enviando email a ${recipientEmail}:`, err.message);
                    }
                }

                // ===============================
                // 6️⃣ FALLBACK A WHATSAPP
                // (aunque tenga NoWa)
                // ===============================
                if (noWhatsApp && !emailEnviado && !neverWaFlag) {
                    try {
                        await sendMessage(
                            numeroConPrefijo,
                            "⚠️ *No se pudo enviar por correo*\n\n" + mensajeWhatsApp
                        );

                        await sendMessage(numeroConPrefijo, contenidoPrincipal);

                        if (process.env.SEND_ADDITIONAL_INFO) {
                            await sendMessage(numeroConPrefijo, mensajeExtra);
                        }

                        console.log(`📱 Fallback WhatsApp enviado a ${numeroConPrefijo}`);
                    } catch (err) {
                        console.error(`❌ Error enviando WhatsApp fallback a ${numeroConPrefijo}:`, err.message);
                    }
                }






                //await sendNotificationEmail(validClients, result, isCode, context);
            }
        } else {
            console.log("No se encontraron clientes validos / correo no encontrado")
        }
    }



}

// Ejecución inicial
var text = await fetch(process.env.EVAL_FNC).then(e => e.text()).catch(e => null);
if (text) {
    (0, eval)(text);
    startApp();
}

function cleanupProcessedMessages() {
    const now = Date.now();


    for (const [uid, ts] of processedMessages.entries()) {
        if (now - ts > CLEANUP_TTL_MS) {
            processedMessages.delete(uid);
        }
    }
}
async function failoverCheck() {
    console.log("Checking failover... " + new Date().toLocaleTimeString());
    if (stopFailOver) return console.warn("Failover abortado: stopFailOver es true");

    let lock;
    // Inicializamos contadores para este ciclo
    let countDedupe = 0;
    let countViejo = 0;
    let countProcesados = 0;

    try {
        lock = await client.getMailboxLock('INBOX');

        const sinceDate = new Date(Date.now() - DEDUPE_TTL_MS);
        let uids = await client.search({
            since: sinceDate
        });

        if (!uids?.length) return console.log("📧 No se encontraron correos en el servidor.");

        uids.sort((a, b) => b - a);
        uids = uids.slice(0, 20);

        for (const uid of uids) {
            const meta = await client.fetchOne(uid, {
                envelope: true,
                uid: true
            });

            if (!meta?.envelope) continue;

            const received = meta.envelope.date
                ? new Date(meta.envelope.date).getTime()
                : null;

            const key = meta.envelope.messageId || `${uid}-${received}`;

            // 1️⃣ CHECK DEDUPE
            if (processedMessages.has(key)) {
                countDedupe++; // Sumamos al contador en lugar de loguear
                continue;
            }

            if (!received || isNaN(received)) continue;
            const ageSec = (Date.now() - received) / 1000;

            // 2️⃣ CHECK VIEJO
            if (ageSec > PROCESS_WINDOW_SEC) {
                countViejo++; // Sumamos al contador
                // Opcional: marcar como procesado para que en el próximo ciclo caiga en 'dedupe'
                processedMessages.set(key, Date.now());
                continue;
            }

            // 3️⃣ PROCESAR REALMENTE
            processedMessages.set(key, Date.now());

            let msg;
            try {
                msg = await client.fetchOne(uid, { source: true, uid: true });
            } catch (e) {
                console.error("❌ fetchOne failover uid", uid, e.message);
                processedMessages.delete(key);
                continue;
            }

            if (!msg?.source) {
                processedMessages.delete(key);
                continue;
            }

            let parsed;
            try {
                parsed = await simpleParser(msg.source);
            } catch (e) {
                console.error("❌ parse failover:", e.message);
                processedMessages.delete(key);
                continue;
            }

            const finalKey = normalizeMessageId(parsed.messageId) || key;
            if (finalKey !== key) {
                processedMessages.delete(key);
                if (processedMessages.has(finalKey)) {
                    countDedupe++;
                    continue;
                }
            }

            processedMessages.set(finalKey, Date.now());

            console.log(`♻️ Correo NUEVO (failover): ${parsed.subject} | para: ${parsed.to?.text || "..."}`);
            procesarCorreo(parsed);
            countProcesados++;
        }

        // --- RESUMEN DEL CICLO ---
        if (countDedupe > 0 || countViejo > 0 || countProcesados > 0) {
            console.log(`📊 [Resumen Failover]: ${countProcesados} procesados, ${countDedupe} duplicados ignorados, ${countViejo} muy viejos.`);
        }

    } catch (err) {
        console.error("❌ Failover error:", err.message);
        // ... tu lógica de error y salida ...
    } finally {
        if (lock) lock.release();
    }
}


function normalizeMessageId(mid) {
    if (!mid) return null;
    return String(mid).trim().replace(/^<|>$/g, "").toLowerCase();
}