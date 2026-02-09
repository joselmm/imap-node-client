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
// 👉 índice global: última URL que funcionó
// Variable global en el módulo para recordar el estado
let lastIndexUsed = 0;

export async function sendViaGAS(recipientEmail, subject, htmlBody) {
    const rawUrls = process.env.EMAIL_SENDER_URL || "";
    const urls = rawUrls.split(",").map(u => u.trim()).filter(Boolean);

    if (!urls.length) {
        return { noError: false, message: "No hay URLs configuradas" };
    }

    const payload = { recipient: recipientEmail, subject, emailBody: htmlBody };

    // 1. Creamos un array con todos los índices disponibles: [0, 1, 2, ...]
    const indices = urls.map((_, i) => i);

    // 2. Reorganizamos para que empiece desde 'lastIndexUsed'
    // Ejemplo: si lastIndex era 2 y hay 5 URLs, el orden será [2, 3, 4, 0, 1]
    const sequence = [
        ...indices.slice(lastIndexUsed),
        ...indices.slice(0, lastIndexUsed)
    ];

    for (const index of sequence) {
        const gasUrl = urls[index];

        try {
            const res = await fetch(gasUrl, {
                method: "POST",
                body: JSON.stringify(payload),
                headers: { "Content-Type": "application/json" },
                // Añadimos un pequeño timeout para que no se quede colgado si una URL no responde
                signal: AbortSignal.timeout(10000) 
            });

            const json = await res.json();

            if (json.noError) {
                // ✅ ÉXITO: El próximo inicio será el siguiente índice
                lastIndexUsed = (index + 1) % urls.length;
                console.log(`📧 Enviado vía GAS [${index}] - Siguiente inicio: ${lastIndexUsed}`);
                return json;
            }

            console.warn(`⚠️ GAS respondió error [${index}] →`, json.message);
        } catch (err) {
            console.error(`❌ Error de conexión [${index}] →`, err.message);
        }
    }

    // Si llegamos aquí, todas fallaron en esta vuelta.
    // Avanzamos uno manualmente para que la próxima llamada no repita el primer error inmediatamente.
    lastIndexUsed = (lastIndexUsed + 1) % urls.length;

    return { noError: false, message: "Todas las URLs fallaron" };
}

