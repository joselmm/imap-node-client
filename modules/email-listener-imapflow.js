import { ImapFlow } from "imapflow";
import { config } from "dotenv";
import { uploadFolderZipToGAS } from "../compress-sessions.js";
import { simpleParser } from "mailparser"; // ImapFlow usa mailparser para el contenido

config();

export const client = new ImapFlow({
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

// Función para procesar la subida y cierre
export async function handleShutdown() {
    console.log("📧 Se cerro conexion con servidor IMAP, subiendo sesión...");
    try {
        await uploadFolderZipToGAS();
        console.log("Se subió el archivo de sesión a GAS");
    } catch (err) {
        console.error("Error subiendo archivo sesión: " + err.message);
    }
    setTimeout(() => process.exit(0), 5000);
}

// Evento de error
client.on("error", err => {
    console.error("Hubo un error en IMAP:", err);
});

// El inicio de la conexión se hará desde app.js