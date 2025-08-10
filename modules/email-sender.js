import { sendMessage } from "./whatsapp.js";
import { convert } from "html-to-text";
export async function sendNotificationEmail(clients, info, isCode) {

    var codigoOLink = isCode ? "codigo" : "link";
    var variosOUno = clients.length > 1 ? "varios clientes" : "un cliente"
    var subject = "Se envio un " + codigoOLink + " a " + variosOUno;

    var emailBody =
        "<h3>El " + (isCode
            ? codigoOLink + " (" + info.code + ")"
            : "<a href='" + info.link + "'>" + codigoOLink + "</a>"
        ) + " fue enviado a: <h3>\n" +
        "<ul>" +
        clients.map(c => "<li>" + c.name + " (" + c.prefix + " " + c.contact + ")" + "</i>").join("") +
        "</ul>" +
        "<h3>" + info.about + "</h3>" +
        (globalThis.profileName
            ? "<h3>Nombre Perfil: " + globalThis.profileName + "</h3>"
            : ""
        ) +
        "<h3> Correo: " + globalThis.to + "</h3>";


    if (process.env.OWNER === "leiner") {
        await sendMessage(process.env.WHATSAPP_CONTACT, convert(emailBody))
    }

    return fetch(process.env.EMAIL_SENDER_URL,
        {
            headers: {
                "Content-Type": "text/plain; charset=utf-8"
            },
            method: "POST",
            body: JSON.stringify({
                recipient: process.env.NOTIFICATION_EMAIL,
                emailBody,
                subject
            })
        }
    )
        .then(e => console.log("Se envio el email a " + process.env.NOTIFICATION_EMAIL))
        .catch(e => console.log(e));
}
