import { config } from "dotenv";
config()
import { sendMessage } from "./whatsapp.js";
import { selectRows } from "./supabase.js";


// Cada tabla de Supabase equivale a una "hoja" del backend anterior.
async function leerDatos(TABLES) {

    const result = {};
    for (const table of TABLES) {
        result[table] = await selectRows(table);
    }

    return result;

}

export async function checkValidClients(context) {

    const e = await leerDatos(["platforms", "clients", "platformNames"]);
    const { platforms, clients, platformNames } = e;
    if (!platforms || !clients || !platformNames) return null;

    const keyword = context.keyword.toLowerCase();

    let validPlatforms = platforms.filter(p =>
        platformNames.find(pno => pno.id === p.platformNameId)
            ?.platformName?.toLowerCase()?.includes(keyword) &&
        p.email.toLowerCase().trim() === context.to.toLowerCase().trim() &&
        p.active === "1" &&
        ("" + p.withCredentials) === "1"
    );

    let validPlatformsWithNoCredentials = [];
    if (context.noCredencialsRequired) {
        validPlatformsWithNoCredentials = platforms.filter(p =>
            platformNames.find(pno => pno.id === p.platformNameId)
                ?.platformName?.toLowerCase()?.includes(keyword) &&
            p.email.toLowerCase().trim() === context.to.toLowerCase().trim() &&
            p.active === "1" &&
            ("" + p.withCredentials) === "0"
        ).map(e => { return { ...e, withNoCredentials: true } });
    }

    validPlatforms = [...validPlatforms, ...validPlatformsWithNoCredentials]



    if (validPlatforms.length === 0) return null;

    if (context.sendJustIf) {
        validPlatforms = validPlatforms.filter(p =>
            p.additionalInfo?.toLowerCase().includes(context.sendJustIf)
        );
    }

    const isNetflix = keyword === "netflix";

    // 🔥 Detectar si hay flag enviar_todo_netflix
    const enviarTodoNetflix = isNetflix &&
        validPlatforms.some(p =>
            p.additionalInfo?.toLowerCase().includes("{enviar_todo_netflix}")
        );


    if (validPlatforms.length === 0) return null;

    // 🔐 PERFIL:
    // Se aplica si:
    // - existe profileName
    // - NO estamos en modo enviarTodoNetflix
    if (context.profileName && isNetflix) {

        // Platforms que NO tienen enviar_todo_netflix → flujo original
        let platformsConPerfil = validPlatforms.filter(p =>
            !(
                context.keyword.toLowerCase() === "netflix" &&
                p.additionalInfo?.toLowerCase().includes("{enviar_todo_netflix}")
            )
        );

        // Platforms que SÍ tienen enviar_todo_netflix → se saltan perfil
        let platformsSinPerfil = validPlatforms.filter(p =>
            context.keyword.toLowerCase() === "netflix" &&
            p.additionalInfo?.toLowerCase().includes("{enviar_todo_netflix}")
        );

        // Aplicar compareProfileNames SOLO a las que deben
        if (platformsConPerfil.length > 0) {
            platformsConPerfil = compareProfileNames(platformsConPerfil, context.profileName);
        }

        // Unir ambas
        validPlatforms = [...platformsConPerfil, ...platformsSinPerfil];

        if (validPlatforms.length === 0) {

            var mess =
                "❌ No se pudo enviar el link/codigo en alguna cuenta '" +
                context.keyword + "' (" + context.to.toLowerCase() +
                ") porque no se encontro el perfil '" +
                context.profileName + "' en la base de datos";

            await sendMessage(process.env.WHATSAPP_CONTACT, mess);
            return null;
        }
    }


    const clientsIds = validPlatforms.map(p => p.clientId);
    const uniqueArrayClientIds = [...new Set(clientsIds)];
    if (uniqueArrayClientIds.length === 0) return null;

    // 1. Identificamos qué IDs de clientes vienen de plataformas "sin credenciales"
    const clientesIdsSinCredenciales = new Set(
        validPlatforms
            .filter(p => p.withNoCredentials)
            .map(p => p.clientId)
    );

    /*  const validClients = clients.filter(c =>
         uniqueArrayClientIds.includes(c.id) && c.active === "1"
     );
  */

    const validClients = clients
        .filter(c => uniqueArrayClientIds.includes(c.id) && c.active === "1")
        .map(c => {
            if (clientesIdsSinCredenciales.has(c.id)) {
                return { ...c, withNoCredentials: true };
            }
            return c;
        });
    if (validClients.length === 0) return null;

    return validClients;
}


function compareProfileNames(validPlatforms, profileName) {
    return validPlatforms.filter(po =>
        po.profileName &&
        normalizarTexto(po.profileName).includes(normalizarTexto(profileName))
    );
}



function normalizarTexto(texto) {
    return texto
        .toLowerCase()                     // Convierte a minúsculas
        .normalize("NFD")                   // Separa letra + tilde
        .replace(/[\u0300-\u036f]/g, "")    // Quita diacríticos
        .trim()                             // Quita espacios al inicio y final
        .replace(/\s+/g, " ");              // Espacios múltiples -> uno solo
}


//'checkValidClients().catch(err=>console.log(err))