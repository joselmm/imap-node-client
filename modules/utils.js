import { getNetflixTravelCode } from "./netflix-utils.js"
import { shortUrl } from "./url-shorter.js"
export async function processIfLink(result, context) {
    let isCode = result.code !== undefined;
    if (!isCode && context.netflixTravel) {
        try {
            console.log("✈️✈️✈️ Tratando de extraer codigo de viaje netflix con fetch");
            var travelResult = await getNetflixTravelCode(result.link);
            if (travelResult.noError) {
                delete result.link;
                result.code = travelResult.code;
                if (result.ifIsCodeAbout) {
                    result.about = result.ifIsCodeAbout;
                    delete result.ifIsCodeAbout;
                }
                isCode = true;
            } else {
                throw new Error(travelResult.errorMessage);
            }
        } catch (error) {
            console.warn('✈️✈️✈️ No se pudo extraer codigo estoy de viaje netflix: ' + error.message);
        }
    }

    if (!isCode) {

        var shortenUrl = await shortUrl(result.link);
        //  console.log(shortenUrl)
        if (shortenUrl !== null) {
            result.link = shortenUrl;

            if (context.netflixLinkTv) {
                console.log(shortenUrl);

                result.link = "https://ntv.cuenticas.pro/#" + shortenUrl.split("/").pop();
                console.log(result.link);
            }

            if (context.crunchyAprobarLink) {
                console.log(shortenUrl);
                result.link = "https://ac.cuenticas.com/#" + shortenUrl.split("/").pop();
                console.log(result.link);
            }
        }

    }
}

var cmdRegex = /^\/pass\d*$/;
var numberRegex = /\d+$/;
export function generatePassword(message) {
    try {
        if (!cmdRegex.test(message)) throw new Error("Formato incorrecto, usa /pass o /pass(Numero De Digitos)")
        var nameList = JSON.parse(process.env.NAME_LIST);
        if (numberRegex.test(message)) {
            var number = parseInt(message.match(numberRegex)[0]);
            if (number > 10) throw new Error("Numero muy grande, maximo 10  digitos")
            return (obtenerItemAleatorio(nameList) + generarPin(number));
        }

        return (obtenerItemAleatorio(nameList) + generarPin(4));

    } catch (e) {
        return "Error: " + e.message;
    }
}

function generarPin(n) {
    let pool = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    let resultado = "";
    for (let i = 0; i < n; i++) {
        let idx = Math.floor(Math.random() * pool.length);
        resultado += pool.splice(idx, 1)[0];
    }
    return resultado;
}

function obtenerItemAleatorio(lista) {
    if (!lista || lista.length === 0) return "User"; // Valor por defecto si falla la lista
    const indiceAleatorio = Math.floor(Math.random() * lista.length);
    return lista[indiceAleatorio];
}

export async function procesarCalculo(msg, sock) {
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    
    // Captura 'cc' o 'c' en el primer grupo, y la operación en el segundo.
    // Ojo: 'cc' va antes de 'c' en el regex para que no se confunda.
    const regex = /(cc|c)\s*\(([^)]+)\)/i;
    const match = text.match(regex);
    
    if (!match) return false;

    const tipoComando = match[1].toLowerCase(); // Puede ser 'c' o 'cc'
    const operacion = match[2];

    try {
        // Filtro de seguridad para el eval
        if (/[^0-9+\-*/(). ]/.test(operacion)) return false;

        // Calculamos con redondeo a 2 decimales
        let resultado = eval(operacion);
        resultado = Math.round(resultado * 100) / 100;

        // --- LÓGICA DE DETECCIÓN DE COMANDO ---
        let textoReemplazo = "";
        if (tipoComando === "c") {
            textoReemplazo = `${operacion} = ${resultado}`; // Ej: "1+2 = 3"
        } else {
            textoReemplazo = resultado.toString();          // Ej: "3"
        }

        const jid = msg.key.remoteJid;

        if (msg.key.fromMe) {
            // Edita tu propio mensaje con el formato elegido
            await sock.sendMessage(jid, { text: text.replace(regex, textoReemplazo), edit: msg.key });
        } else {
            // Si te lo envían, responde con el formato elegido
            await sock.sendMessage(jid, { text: textoReemplazo });
        }
        return true;
    } catch (e) {
        return false;
    }
}