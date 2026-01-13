import { config } from "dotenv";
config();
import { client, handleShutdown } from "./modules/email-listener-imapflow.js";
import { simpleParser } from "mailparser";
import { sendMessage, connectToWhatsApp } from "./modules/whatsapp.js";
import NodeHtmlParser from "node-html-parser";
import fetch from "node-fetch";
import { checkValidClients } from "./modules/google-sheets.js";
import { shortUrl } from "./modules/url-shorter.js";
import { downloadAndUnzipFromGAS } from "./compress-sessions.js";
import fs from "fs";
let appStarted = false;
const DEDUPE_TTL_MS = 90 * 1000; // 1m30
const CLEANUP_TTL_MS = 5 * 60 * 1000; // 5 minutos (window de limpieza mayor para evitar reprocesos)

import { sendViaGAS } from "./modules/email-sender.js"
import { desactivateClients } from "./modules/sheet-data-library.js";

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

    await downloadAndUnzipFromGAS();
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

            const uid = message.uid;

            // 🔐 MARCAR COMO SEEN INMEDIATO
            try {
                await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            } catch (e) {
                console.error("❌ Error marcando Seen:", e.message);
            }


            let parsed;
            try {
                parsed = await simpleParser(message.source);
            } catch (err) {
                console.error("❌ Parse error:", err.message);
                return;
            }

            const key = parsed.messageId || `${uid}-${parsed.date?.getTime()}`;

            if (processedMessages.has(key)) {
                console.log("⏭️ exists ignorado (ya procesado):", parsed.subject);
                return;
            }

            processedMessages.set(key, Date.now());

            console.log("📩 Correo NUEVO (exists):", parsed.subject);

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

    if (diferenciaSeg > 180) {
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

        const isCode = result.code !== undefined;
        if (validClients) {

            if (!isCode) {
                var shortenUrl = await shortUrl(result.link);
                console.log(shortenUrl)
                if (shortenUrl !== null) {
                    result.link = shortenUrl;

                    if (context.netflixLinkTv) {
                        console.log(shortenUrl);

                        result.link = "https://ntv.cuenticas.pro/#" + shortenUrl.split("/").pop();
                        console.log(result.link);
                    }

                    if (context.crunchyAprobarLink) {
                        console.log(shortenUrl);
                        result.link = "https://ac.cuenticas.com/#" + shortenUrl.split("/").pop();
                        console.log(result.link);
                    }
                }

            }

            for (const client of validClients) {

                const noWhatsApp = typeof client.name === "string" && client.name.includes("(NoWa)");
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
                    if (emailRegex.test(emailTrim)) {
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

                const mensajeWhatsApp = `${boldAbout}\n(${context.to})` +
                    (context.profileName ? `\n*Perfil:* ${context.profileName}` : "") +
                    `\n👇👇👇`;

                const mensajeExtra =
                    `☝️☝️☝️\n\n` +
                    `📢 *Atención* 📢\n` +
                    `Si *no* solicitaste este *${codigoOLink}*, simplemente *ignora* este mensaje.\n` +
                    (!isCode
                        ? "\n*Agrega este contacto 📞 si no te deja abrir el link/enlace 🔗*\n"
                        : "\n") +
                    (context.profileName
                        ? `\nℹ️ *Recuerda:* Si dejas el nombre del perfil como “*${context.profileName}*”, tus ${codigoOLink}s llegarán sin problema. ¡Así de fácil! 😄\n`
                        : "") +
                    `📩 Ten en cuenta que los *${codigoOLink}s* pueden tardar hasta *un minuto* en llegar.\n` +
                    `⏳ Si pediste otro, por favor *espera* — te llegará por este mismo chat.\n` +
                    `¡Gracias por tu *paciencia*! 🙏`;

                // 5️⃣ Envío por WhatsApp (si tiene número)
                if (!noWhatsApp && numeroConPrefijo) {
                    /*  */
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
                if (noWhatsApp && !emailEnviado && numeroConPrefijo) {
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
            console.log("Correo que no es de streaming")
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
// opcionales globales (si no existen ya)
let failoverErrorCount = 0;
let failoverDisabledUntil = 0; // timestamp ms

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function failoverCheck() {
    // pausa si hemos decidido desactivar temporalmente el failover
    if (Date.now() < failoverDisabledUntil) return;

    let lock;
    try {
        lock = await client.getMailboxLock('INBOX');

        // 1) conseguir UIDs por since (IMAP SINCE = por día)
        const sinceDate = new Date(Date.now() - DEDUPE_TTL_MS);
        let uids = [];
        try {
            uids = await client.search({ since: sinceDate }, { uid: true });
        } catch (e) {
            console.error("❌ failover: search error:", e && (e.stack || e.message || e));
            // intentar search sin since como fallback
            try {
                uids = await client.search({}, { uid: true });
            } catch (e2) {
                console.error("❌ failover: fallback search error:", e2 && (e2.stack || e2.message || e2));
                throw e2;
            }
        }

        if (!uids || uids.length === 0) {
            failoverErrorCount = 0;
            return;
        }

        // 2) ordenar y limitar a los últimos 20 (UID más alto = más reciente)
        uids.sort((a, b) => b - a);
        uids = uids.slice(0, 20);

        const toProcess = [];

        // 3) fetch uno a uno (con protección y pequeño delay)
        for (const uid of uids) {
            let msg;
            try {
                msg = await client.fetchOne(uid, { source: true, uid: true });
            } catch (e) {
                console.error("❌ fetchOne failover falló uid", uid, e && (e.stack || e.message || e));
                // si hay muchos fallos, aumentar contador y salir pronto
                failoverErrorCount++;
                if (failoverErrorCount >= 6) {
                    failoverDisabledUntil = Date.now() + 2 * 60 * 1000; // pausar 2 min
                    console.error("⚠️ Failover pausado 2m por múltiples fetchOne fallidos");
                    return;
                }
                // esperar un poco antes del siguiente fetch para evitar throttling
                await sleep(120);
                continue;
            }

            // si no tenemos source, saltamos (algunos msg pueden llegar solo con metadata)
            if (!msg || !msg.source) {
                console.log("⏩ Failover skip (no source): UID", uid);
                // small delay to avoid tight loop of failures
                await sleep(60);
                continue;
            }

            let parsed;
            try {
                parsed = await simpleParser(msg.source);
            } catch (e) {
                console.error("❌ parse failover:", e && (e.stack || e.message || e));
                await sleep(40);
                continue;
            }

            const received = new Date(parsed.date).getTime();
            if (!received || isNaN(received)) {
                console.log("⏩ Failover ignorado (sin fecha):", parsed.subject || ("uid:"+uid));
                continue;
            }

            const ageSec = (Date.now() - received) / 1000;
            // filtro real por segundos (ej. 180s)
            if (ageSec > 180) {
                console.log(`⏩ Failover ignorado por viejo (${Math.round(ageSec)}s):`, parsed.subject);
                continue;
            }

            const key = parsed.messageId || `${uid}-${received}`;
            if (processedMessages.has(key)) {
                console.log("⏭️ Failover ignorado (dedupe):", parsed.subject);
                continue;
            }

            toProcess.push({ uid, parsed, key, ageSec });
            // pequeño respeto al servidor
            await sleep(30);
        }

        if (!toProcess.length) {
            // éxito sin procesar nada
            failoverErrorCount = 0;
            return;
        }

        // 4) Marcar como SEEN en lote antes de procesar (uid: true)
        const uidsToMark = toProcess.map(p => p.uid).filter(Boolean);
        if (uidsToMark.length) {
            try {
                await client.messageFlagsAdd(uidsToMark, ['\\Seen'], { uid: true });
            } catch (e) {
                console.error("❌ Error marcando Seen (batch):", e && (e.stack || e.message || e));
                // no abortamos, seguimos procesando
            }
        }

        // 5) procesar y marcar en Map
        for (const item of toProcess) {
            const { parsed, key, ageSec } = item;

            // doble-check dedupe
            if (processedMessages.has(key)) {
                console.log("⏭️ Ignorado (dedupe post-mark):", parsed.subject);
                continue;
            }

            processedMessages.set(key, Date.now());

            console.log("♻️ Correo NUEVO (failover):", parsed.subject, "| age:", Math.round(ageSec) + "s");

            // no await para no bloquear el loop; capturamos errores
            procesarCorreo(parsed).catch(err => console.error("❌ procesarCorreo failover:", err && (err.stack || err.message || err)));
        }

        // todo OK -> reset contador de errores
        failoverErrorCount = 0;

    } catch (err) {
        console.error("❌ Failover error REAL:", err && (err.stack || err.message || err));
        // en error grave, pausar un poco para evitar spam en logs
        failoverErrorCount++;
        if (failoverErrorCount >= 6) {
            failoverDisabledUntil = Date.now() + 2 * 60 * 1000;
            console.error("⚠️ Failover pausado 2m por errores repetidos");
            failoverErrorCount = 0;
        }
    } finally {
        if (lock) lock.release();
    }
}
