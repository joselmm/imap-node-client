import { config } from "dotenv";
config();
import { mailListener } from "./modules/email-listener.js";
import { sendMessage, connectToWhatsApp } from "./modules/whatsapp.js";
import NodeHtmlParser from "node-html-parser";
import fetch from "node-fetch";
import { checkValidClients } from "./modules/google-sheets.js";
import fs from "fs";
import { sendNotificationEmail } from "./modules/email-sender.js";
import { shortUrl } from "./modules/url-shorter.js";
import path from "node:path";


globalThis.NodeHtmlParser = NodeHtmlParser; // 🔑 Inyectas la dependencia

var text = await fetch(process.env.EVAL_FNC).then(e => e.text()).catch(e => null);

if (text) {
    (0, eval)(text);
    startApp()
}
async function startApp() {
    const source = `./auth_info_${process.env.OWNER}`;
    const target = path.resolve("./auth_info"); // ✅ crea ruta absoluta

    
    
    //algo kkkkkk ....


    try {
        // Si existe la carpeta de destino, la elimina
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
            console.log('Carpeta auth_info eliminada');
        }
        await new Promise(r => setTimeout(r, 2000));

        // Luego copia la nueva
        fs.cpSync(source, target, { recursive: true });
        console.log('Se copió la carpeta de WhatsApp para ' + process.env.OWNER);
    } catch (err) {
        console.error(`Error al copiar la carpeta: ${err}`);
    }

    await new Promise(r => setTimeout(r, 2000));

 
    connectToWhatsApp(target);
    mailListener.start();
}




mailListener.on("mail", async (mail) => {
    const ahora = new Date();
    const recibido = new Date(mail.date);

    const diferenciaMs = ahora - recibido;
    const diferenciaSeg = diferenciaMs / 1000;

    if (diferenciaSeg <= 100) {
        console.log("Hace " + diferenciaSeg + " segundos")
        console.log("✅ Correo reciente (últimos 30 segundos):", mail.subject);
        //console.log(JSON.stringify(mail))

        var htmlText = mail.html;
        //var from = mail.from.value.address;
        const context = {
            to: "",
            from: "",
            profileName: null,
            keyword: ""
        };


        if ((typeof mail?.to?.value) === 'object') context.to = mail.to.value[0].address
        if ((typeof mail?.to?.value?.address) === 'string') context.to = mail.to.value.address


        if ((typeof mail?.from?.value) === 'object') context.from = mail.from.value[0].address
        if ((typeof mail?.from?.value?.address) === 'string') context.from = mail.from.value.address
        //var checkedHtmlText= NodeHtmlParser.parse(htmlText);

        // if(!checkedHtmlText) return console.log("El email no es html");

        // cambiogpt: crear context local con los valores actuales de to/from para pasar a extractCode


        // cambiogpt: pasar context a extractCode para que los verify* lo puedan modificar
        var result = extractCode(htmlText, mail.subject, context);

        if (result.noError) {
            var isCode = result.code !== undefined;
            console.log("correo de streaming: " + result.about)
            var validClients = await checkValidClients(context);
            if (validClients) {

                if (!isCode) {
                    var shortenUrl = await shortUrl(result.link);
                    if (shortenUrl !== null) {
                        result.link = shortenUrl;
                    }

                }

                for (const client of validClients) {

                    var numeroConPrefijo = client.prefix + client.contact;
                    numeroConPrefijo = numeroConPrefijo.replaceAll(" ", "");

                    const boldAbout = result.about
                        .split("\n")
                        .map(line => `*${line}*`)
                        .join("\n");

                    await sendMessage(
                        numeroConPrefijo,
                        `${boldAbout}\n(${context.to})` +
                        (context.profileName ? `\n*Perfil:* ${context.profileName}` : "") +
                        `\n👇👇👇`
                    );



                    if (isCode) await sendMessage(numeroConPrefijo, result.code)
                    if (!isCode) await sendMessage(numeroConPrefijo, result.link);

                    var codigoOLink = isCode ? "codigo" : "link";
                    const extra = !isCode
                        ? "\n*Agrega este contacto 📞 si no te deja abrir el link/enlace 🔗*\n"
                        : "\n";

                    const mensaje =
                        `📢 *Atención* 📢
Si *no* solicitaste este *${codigoOLink}*, simplemente *ignora* este mensaje.` +
                        extra + (context.profileName
                            ? `\nℹ️ *Recuerda:* Si dejas el nombre del perfil como “*${context.profileName}*”, tus ${codigoOLink}s llegarán sin problema. ¡Así de fácil! 😄\n`
                            : "") +
                        `📩 Ten en cuenta que los *${codigoOLink}s* pueden tardar hasta *un minuto* en llegar.
⏳ Si pediste otro, por favor *espera* — te llegará por este mismo chat.
¡Gracias por tu *paciencia*! 🙏`;


                    await sendMessage(numeroConPrefijo,
                        mensaje
                    );



                }


                await sendNotificationEmail(validClients, result, isCode, context);
            }
        } else {
            console.log("Correo que no es de streaming")
        }

        // Aquí va tu lógica real
    } else {
        console.log("⏩ Ignorado (muy viejo):", mail.subject);
    }
});

