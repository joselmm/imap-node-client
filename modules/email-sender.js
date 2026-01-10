import { sendMessage } from "./whatsapp.js";
import { convert } from "html-to-text";
export async function sendNotificationEmail(clients, info, isCode, context) {

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
        (context.profileName
            ? "<h3>Nombre Perfil: " + context.profileName + "</h3>"
            : ""
        ) +
        "<h3> Correo: " + context.to + "</h3>";


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




// Nueva función para enviar por GAS
export async function sendViaGAS(recipientEmail, subject, htmlBody) {
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
