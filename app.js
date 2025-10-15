import { config } from "dotenv";
config();
import { mailListener } from "./modules/email-listener.js";
import { sendMessage, connectToWhatsApp } from "./whatjs.js";
import NodeHtmlParser from "node-html-parser";
import fetch from "node-fetch";
import { checkValidClients } from "./modules/google-sheets.js";
import { sendNotificationEmail } from "./modules/email-sender.js";
import { shortUrl } from "./modules/url-shorter.js";


globalThis.NodeHtmlParser = NodeHtmlParser; // 🔑 Inyectas la dependencia

var text = await fetch(process.env.EVAL_FNC).then(e => e.text()).catch(e => null);

if (text) {
    (0, eval)(text);
    startApp()
}
async function startApp() {
    const source = `./auth_info_${process.env.OWNER}`;
    const target = './auth_info';


    //algo kkkkkk ....


    /*   try {
          // Si existe la carpeta de destino, la elimina
          if (fs.existsSync(target)) {
              fs.rmSync(target, { recursive: true, force: true });
              console.log('Carpeta 
              auth_info eliminada');
          }
          await new Promise(r => setTimeout(r, 2000));
  
          // Luego copia la nueva
          fs.cpSync(source, target, { recursive: true });
          console.log('Se copió la carpeta de WhatsApp para ' + process.env.OWNER);
      } catch (err) {
          console.error(`Error al copiar la carpeta: ${err}`);
      } */

    //await new Promise(r => setTimeout(r, 2000));


    connectToWhatsApp()

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



                /* for (const client of validClients) {
                    // 1️⃣ Buscar un email dentro de additionalInfo, con formato ${email:xxxxx@yyy.zzz}
                    let recipientEmail = null;

                    // 1️⃣ Tomar el email y limpiar espacios
                    if (client.emailContact && typeof client.emailContact === "string") {
                        recipientEmail = client.emailContact.trim();
                    }

                    // 2️⃣ Verificar si es un email válido (regex)
                    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                    if (!recipientEmail || !emailRegex.test(recipientEmail)) {
                        console.log("⚠️ Email no válido o ausente en client.emailContact:", client.emailContact, ", cliente nombre es: " + client.name);
                        continue; // saltar al siguiente cliente
                    }

                    // 4️⃣ Preparar mensaje y asunto
                    const codigoOLink = isCode ? "código" : "link";
                    const contenidoPrincipal = isCode ? result.code : result.link;

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

                    // 5️⃣ Enviar por GAS
                    await sendViaGAS(recipientEmail, subject, mensajeHTML);
                } */
                for (const client of validClients) {
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
                    if (numeroConPrefijo) {
                        try {
                            await sendMessage(numeroConPrefijo, mensajeWhatsApp);
                            await sendMessage(numeroConPrefijo, contenidoPrincipal);
                            if(process.env.SEND_ADDITIONAL_INFO){
                                await sendMessage(numeroConPrefijo, mensajeExtra);
                            }
                            console.log(`📱 Enviado a ${numeroConPrefijo} por WhatsApp`);
                        } catch (err) {
                            console.error(`❌ Error enviando por WhatsApp a ${numeroConPrefijo}:`, err.message);
                        }
                    }

                    // 6️⃣ Envío por Email (si tiene email válido)
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
                                console.log(`📧 Enviado correctamente a ${recipientEmail}`);
                            } else {
                                console.error(`⚠️ Error al enviar a ${recipientEmail}: ${resultadoEmail.message}`);
                            }

                        } catch (err) {
                            console.error(`❌ Error inesperado enviando email a ${recipientEmail}:`, err.message);
                        }

                    }
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


// Nueva función para enviar por GAS
async function sendViaGAS(recipientEmail, subject, htmlBody) {
    const gasUrl = process.env.EMAIL_SENDER_URL;

    try {
        const payload = {
            recipient: recipientEmail,
            subject: subject,
            emailBody: htmlBody,
        };

        const res = await fetch(gasUrl, {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
        });

        const json = await res.json(); // 👈 parsea el JSON real

        if (json.noError) {
            console.log("📧 Enviado vía GAS:", recipientEmail, "→", json.message);
        } else {
            console.warn("⚠️ GAS devolvió error:", json.message);
        }

        return json; // ✅ devuelve el JSON al caller

    } catch (err) {
        console.error("❌ Error enviando vía GAS:", err.message);
        return { noError: false, message: err.message };
    }
}

