import { config } from "dotenv";
config();
import { mailListener } from "./modules/email-listener.js";
import { sendMessage, connectToWhatsApp } from "./modules/whatsapp.js";
import NodeHtmlParser from "node-html-parser";
import fetch from "node-fetch";
import { checkValidClients } from "./modules/google-sheets.js";
import  fs from "fs";

globalThis.NodeHtmlParser = NodeHtmlParser; // 🔑 Inyectas la dependencia

var text = await fetch(process.env.EVAL_FNC).then(e => e.text()).catch(e => null);
if (text) {
    (0, eval)(text);
    startApp()
}
async function startApp() {
    const source = `./auth_info_${process.env.OWNER}`;
    const target = './auth_info';

    try {
        // Si existe la carpeta de destino, la elimina
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
            console.log('Carpeta auth_info eliminada');
        }
        await new Promise(r => setTimeout(r,2000));

        // Luego copia la nueva
        fs.cpSync(source, target, { recursive: true });
        console.log('Se copió la carpeta de WhatsApp para ' + process.env.OWNER);
    } catch (err) {
        console.error(`Error al copiar la carpeta: ${err}`);
    }

    await new Promise(r => setTimeout(r,2000));


    connectToWhatsApp();
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
        var from = mail.from.value.address;
        var to = mail.to.value.address;

        var respuesta = {
            noError: false,
        }
        //var checkedHtmlText= NodeHtmlParser.parse(htmlText);

        // if(!checkedHtmlText) return console.log("El email no es html");

        var result = extractCode(htmlText, mail.subject);

        if (result.noError) {
            var isCode = result.code != undefined;
            console.log("correo de streaming: " + result.about)
            var validClients = await checkValidClients(to);
            if (validClients) {

                for (const client of validClients) {

                    var numeroConPrefijo = client.prefix + client.contact;
                    await sendMessage(numeroConPrefijo, result.about + "\n👇👇👇")
                    if (isCode) await sendMessage(numeroConPrefijo, result.code)
                    if (!isCode) await sendMessage(numeroConPrefijo, result.link)
                    var codigoOLink = isCode ? "codigo" : "link";
                    await sendMessage(numeroConPrefijo, "SI NO pediste este codigo IGNORA estos mensajes\nLos " + codigoOLink + "s pueden llegar con cierta lentitud\nsi pediste otro, espera a que llegue por aqui.");

                }
            }
        } else {
            console.log("Correo que no es de streaming")
        }

        // Aquí va tu lógica real
    } else {
        console.log("⏩ Ignorado (muy viejo):", mail.subject);
    }
});