import { google } from 'googleapis';
import fs from "fs";
import { config } from "dotenv";
config()
import { sendMessage } from "./whatsapp.js";


// Nombre de la hoja y rango (por ejemplo: 'Hoja1!A1:C5')
const RANGE = 'platforms!A:F';

async function leerDatos(RANGES) {


    const auth = new google.auth.GoogleAuth({
        keyFile: "./credentials.json",
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: process.env.SS_ID,
        ranges: RANGES
    });
//la cocacola
    const matricesDeObjetos = res.data.valueRanges.map((rango) => {
        const valores = rango.values || [];

        if (valores.length < 2) return []; // si no hay datos o solo headers

        const headers = valores[0]; // primera fila = encabezados
        const filas = valores.slice(1);

        // Convertir cada fila en un objeto usando los headers
        const objetos = filas.map((fila) => {
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = fila[i] !== undefined ? fila[i] : null;
            });
            return obj;
        });

        return objetos;
    });

    // console.log(matricesDeObjetos.length)
    var result = {}
    let i = 0;
    for (var range of RANGES) {
        result[range.split("!")[0]] = matricesDeObjetos[i];
        i++;
    }
    //console.log(JSON.stringify(result, null, 2));


    return result

}

export async function checkValidClients(context) {

    const e = await leerDatos(["platforms!A:T", "clients!A:H", "platformNames!A:B"]);
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

    if (validPlatforms.length === 0) return null;

    const isNetflix = keyword === "netflix";

    // 🔥 Detectar si hay flag enviar_todo_netflix
    const enviarTodoNetflix = isNetflix &&
        validPlatforms.some(p =>
            p.additionalInfo?.toLowerCase().includes("{enviar_todo_netflix}")
        );

    // Disney (sin cambios)
    if (keyword === "disney") {
        validPlatforms = validPlatforms.filter(p =>
            p.additionalInfo?.toLowerCase().includes("{enviar_codigos_disney}")
        );
    }

    // Netflix:
    if (isNetflix) {
        if (enviarTodoNetflix) {
            // 🔓 Enviar TODO (no filtrar por perfil)
            validPlatforms = validPlatforms.filter(p =>
                p.additionalInfo?.toLowerCase().includes("{enviar_todo_netflix}")
            );
        }
        // ❗ Si NO tiene el flag → NO tocamos nada (flujo original)
    }

    if (validPlatforms.length === 0) return null;

    // 🔐 PERFIL:
    // Se aplica si:
    // - existe profileName
    // - NO estamos en modo enviarTodoNetflix
    if (context.profileName && !enviarTodoNetflix) {

        validPlatforms = compareProfileNames(validPlatforms, context.profileName);

        if (validPlatforms.length === 0) {

            const mess =
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

    const validClients = clients.filter(c =>
        uniqueArrayClientIds.includes(c.id) && c.active === "1"
    );

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