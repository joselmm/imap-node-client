import { google } from 'googleapis';
import fs from "fs";
import { config } from "dotenv";
config()


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

export async function checkValidClients(email = "yorvenivegapadilla@gmail.com", keyword) {
    var e = await leerDatos(["platforms!A:G", "clients!A:F", "platformNames!A:B"]);
    var { platforms, clients, platformNames } = e;
    if (!platforms || !clients || !platformNames) return null;

    var validPlatforms = platforms.filter(p => platformNames.find(pno => pno.id === p.platformNameId)?.platformName?.toLowerCase()?.includes(keyword) && p.email.toLowerCase() === email.toLowerCase() && p.active === "1");
    if (!validPlatforms) return null;

    if (globalThis.profileName) {
        validPlatforms = compareProfileNames(validPlatforms);
        if (validPlatforms.length === 0) return null;
    }



    var clientsIds = validPlatforms.map(p => p.clientId);
    var uniqueArrayClientIds = [...new Set(clientsIds)];
    if (!uniqueArrayClientIds) return null;
    var validClients = clients.filter(c => uniqueArrayClientIds.includes(c.id) && c.active === "1");
    if (validClients.length === 0) return null;
    return validClients;
}


function compareProfileNames(validPlatforms) {
  return validPlatforms.filter(po => 
    po.profileName && 
    normalizarTexto(po.profileName).includes(normalizarTexto(globalThis.profileName))
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