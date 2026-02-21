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
            if(number>10) throw new Error("Numero muy grande, maximo 10  digitos")
            return (obtenerItemAleatorio(nameList) + generarPin(number));
        }
        
        return (obtenerItemAleatorio(nameList) + generarPin(4));

    } catch (e) {
        return "Error: " + e.message;
    }
}

function generarPin(n) {
    let pin = "";
    for (let i = 0; i < n; i++) {
        pin += Math.floor(Math.random() * 10);
    }
    return pin;
}

function obtenerItemAleatorio(lista) {
    if (!lista || lista.length === 0) return "User"; // Valor por defecto si falla la lista
    const indiceAleatorio = Math.floor(Math.random() * lista.length);
    return lista[indiceAleatorio];
}