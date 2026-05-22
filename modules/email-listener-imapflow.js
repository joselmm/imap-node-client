import { ImapFlow } from "imapflow";
import { config } from "dotenv";
import { uploadFolderZipToGAS } from "../compress-sessions.js";

config();
//algo para actualizar
export function createImapClient() {
    return new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASS,
        },
        logger: false, // Cambia a console.log si quieres ver todo el tráfico
        tls: { rejectUnauthorized: false }
    });
}

export let client = createImapClient();

export function resetImapClient() {
    const previousClient = client;

    if (previousClient) {
        previousClient.removeAllListeners();

        if (!previousClient.isClosed) {
            try {
                previousClient.close();
            } catch (err) {
                console.error("Error cerrando cliente IMAP anterior: " + err.message);
            }
        }
    }

    client = createImapClient();
    return client;
}

// Función para procesar la subida y cierre
export async function handleShutdown(reason = "📧 Se cerro conexion con servidor IMAP", options = {}) {
    const { exit = false } = options;

    console.log(reason + ", subiendo sesión...");

    try {
        await uploadFolderZipToGAS();
        console.log("Se subió el archivo de sesión a GAS");
    } catch (err) {
        console.error("Error subiendo archivo sesión: " + err.message);
    }

    if (exit) {
        setTimeout(() => process.exit(0), 5000);
    }
}

// El inicio de la conexión se hará desde app.js