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

// arriba del todo (globales)
let failoverErrorCount = 0;
let failoverDisabledUntil = 0; // ms timestamp

async function failoverCheck() {
    // protección por si hubo muchos errores seguidos
    if (Date.now() < failoverDisabledUntil) {
        // opcional: log muy ligero para saber que está en pausa
        // console.log("Failover en pausa hasta", new Date(failoverDisabledUntil).toISOString());
        return;
    }

    let lock;
    try {
        lock = await client.getMailboxLock('INBOX');

        // 1) Intentos seguros de fetchAll con rango (últimos 20)
        // probamos un par de variantes que algunos servidores aceptan
        let messages = null;
        const tryRanges = [':-20', '*:-20']; // '-:20' variante y '*:-20'
        for (const range of tryRanges) {
            try {
                messages = await client.fetchAll(range, {
                    source: true,
                    uid: true
                    // envelope: true // opcional si quieres metadatos
                });

                if (messages && messages.length) break;
            } catch (errRange) {
                // loguea el fallo de intento específico (no termina todo aún)
                console.error(`❗ fetchAll rango "${range}" falló:`, errRange && (errRange.stack || errRange.message || errRange));
                // seguir al siguiente intento
            }
        }

        // 2) Si no obtuvimos mensajes con fetchAll, fallback seguro: search + slice(0,20)
        if (!messages || messages.length === 0) {
            try {
                // sigue usando sinceDate si quieres, pero como IMAP SINCE es por día,
                // lo usamos solo para acotar; luego ordenamos por UID y tomamos 20
                const sinceDate = new Date(Date.now() - DEDUPE_TTL_MS);
                let uids = await client.search({ since: sinceDate }, { uid: true });
                if (!uids || !uids.length) {
                    // si no hay uids por since, intentamos traer todos y limitar por UID
                    uids = await client.search({}, { uid: true });
                }

                if (!uids || !uids.length) {
                    // nada que procesar
                    failoverErrorCount = 0;
                    return;
                }

                // ordenar descendente por UID y tomar los 20 más recientes
                uids.sort((a, b) => b - a);
                const take = uids.slice(0, 20);

                // fetch individualmente los que necesitamos (fetchOne es seguro)
                messages = [];
                for (const uid of take) {
                    try {
                        const msg = await client.fetchOne(uid, { source: true, uid: true });
                        if (msg) messages.push(msg);
                    } catch (errFetchOne) {
                        console.error("❌ fetchOne en fallback falló para uid", uid, errFetchOne && (errFetchOne.stack || errFetchOne.message || errFetchOne));
                    }
                }
            } catch (errSearch) {
                throw errSearch; // sube para el catch general
            }
        }

        if (!messages || messages.length === 0) {
            failoverErrorCount = 0;
            return;
        }

        // 3) Parsear y seleccionar los que realmente queremos procesar
        const toProcess = []; // { uid, parsed, received, key, ageSec }
        for (const msg of messages) {
            // msg.uid debería existir si pediste uid: true
            const uid = msg.uid ?? msg.uid; // por claridad

            let parsed;
            try {
                parsed = await simpleParser(msg.source);
            } catch (errParse) {
                console.error("❌ Failover parse error (skip):", errParse && (errParse.stack || errParse.message || errParse));
                continue;
            }

            const received = new Date(parsed.date).getTime();
            if (!received || isNaN(received)) {
                console.log("⏩ Failover ignorado (sin fecha):", parsed.subject);
                continue;
            }

            const ageSec = (Date.now() - received) / 1000;

            // filtro real por segundos (p. ej. 180s)
            if (ageSec > 180) {
                console.log(`⏩ Failover ignorado por viejo (${Math.round(ageSec)}s):`, parsed.subject);
                continue;
            }

            const key = parsed.messageId || `${uid}-${received}`;
            if (processedMessages.has(key)) {
                console.log("⏭️ Failover ignorado (dedupe):", parsed.subject);
                continue;
            }

            toProcess.push({ uid, parsed, received, key, ageSec });
        }

        if (!toProcess.length) {
            failoverErrorCount = 0;
            return;
        }

        // 4) Marcar como SEEN en lote (si falla, lo tratamos y seguimos)
        const uidsToMark = toProcess.map(p => p.uid).filter(Boolean);
        if (uidsToMark.length) {
            try {
                await client.messageFlagsAdd(uidsToMark, ['\\Seen'], { uid: true });
            } catch (errMark) {
                console.error("❌ Error marcando Seen (batch):", errMark && (errMark.stack || errMark.message || errMark));
                // no abortamos; continuamos para procesar lo que tengamos
            }
        }

        // 5) Procesar y marcar en map (dedupe)
        for (const item of toProcess) {
            const { uid, parsed, key, ageSec } = item;

            if (processedMessages.has(key)) {
                console.log("⏭️ Ignorado (dedupe post-mark):", parsed.subject);
                continue;
            }

            processedMessages.set(key, Date.now());

            console.log("♻️ Correo NUEVO (failover):", parsed.subject, "| age:", Math.round(ageSec) + "s", "| messageId:", parsed.messageId);

            // procesarCorreo puede retornar promesa; capturamos errores
            procesarCorreo(parsed).catch(err => console.error("❌ procesarCorreo (failover) error:", err && (err.stack || err.message || err)));
        }

        // todo bien -> reset contador de errores
        failoverErrorCount = 0;
    } catch (err) {
        // LOG MUY DETALLADO para entender el "Command failed"
        console.error("❌ Failover error (DETALLADO):", {
            msg: err && (err.message || err.toString()),
            stack: err && err.stack,
            // algunos errores IMAP llevan propiedades adicionales:
            response: err?.response,
            command: err?.command,
            server: err?.server
        });

        // mecanismo de pausa si hay repetidos fallos
        failoverErrorCount++;
        if (failoverErrorCount >= 5) {
            failoverDisabledUntil = Date.now() + 2 * 60 * 1000; // pausar 2 minutos
            console.error("⚠️ Failover deshabilitado temporalmente por múltiples errores. Reintentará en 2 min.");
            failoverErrorCount = 0; // reset para próxima vez
        }
    } finally {
        if (lock) lock.release();
    }
}

