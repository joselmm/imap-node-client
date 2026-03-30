import fetch from "node-fetch";
import fs from "node:fs"

export async function shortUrl(url) {
    try {
        const baseUrl = "https://a.cuenticas.com"; 
        
        // Configuramos la petición como POST
        const response = await fetch(`${baseUrl}/short`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: url }) // Enviamos la URL en el cuerpo
        });

        if (!response.ok) {
            console.error("Error en la respuesta del servidor:", response.status);
            return null;
        }

        const data = await response.json();

        if (data.noError) {
            console.log("Resultado de mi acortador: " + data.shortUrl);
            return data.shortUrl;
        }

        return null;
    } catch (error) {
        console.error("Error al acortar con mi servicio:", error);
        return null;
    }
}

//shortUrl("https://mail.google.com/mail/mu/mp/217/#tl/priority/%5Esmartlabel_personal")

