import fetch from "node-fetch";
import fs from "node:fs"

export async function shortUrl(url) {
    try {
        // Usamos la URL de tu subdominio con SSL
        // El endpoint que creamos es GET /short?url=...
        const baseUrl = "https://a.cuenticas.com"; 
        const response = await fetch(`${baseUrl}/short?url=${encodeURIComponent(url)}`);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        // Verificamos el booleano noError que implementamos en el servidor
        if (data.noError) {
            console.log("resultado de mi acortador: " + data.shortUrl);
            return data.shortUrl;
        }

        return null;
    } catch (error) {
        console.error("Error al acortar con mi servicio:", error);
        return null;
    }
}

//shortUrl("https://mail.google.com/mail/mu/mp/217/#tl/priority/%5Esmartlabel_personal")

