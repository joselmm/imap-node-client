import {getNetflixTravelCode} from "./netflix-utils.js"
import {shortUrl} from "./url-shorter.js"
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