import fetch from "node-fetch";
import fs from "node:fs"

export async function shortUrl(url) {
    try {

        var response = await fetch("https://is.gd/create.php", {
            "headers": {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "en-US,en;q=0.9,es-CO;q=0.8,es-ES;q=0.7,es;q=0.6",
                "cache-control": "max-age=0",
                "content-type": "application/x-www-form-urlencoded",
                "priority": "u=0, i",
                "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
                "sec-ch-ua-arch": "\"x86\"",
                "sec-ch-ua-bitness": "\"64\"",
                "sec-ch-ua-full-version": "\"140.0.7339.185\"",
                "sec-ch-ua-full-version-list": "\"Chromium\";v=\"140.0.7339.185\", \"Not=A?Brand\";v=\"24.0.0.0\", \"Google Chrome\";v=\"140.0.7339.185\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-model": "\"\"",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-ch-ua-platform-version": "\"10.0.0\"",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                
                "Referer": "https://is.gd/"
            },
            "body": "url="+encodeURIComponent(url)+"&shorturl=&opt=0",
            "method": "POST"
        });
        // console.log(response)
        var text = await response.text();
        fs.writeFileSync("./short.txt", text)

        //console.log(text)
        var match = text.match(/"https:\/\/is.gd\/[^"]+"/g);
        var result = match !== null ? match[0].slice(1, -1) : null;
        console.log("resultado de acortador: " + result)
        return result
    } catch (error) {
        return null
    }

}

//shortUrl("https://mail.google.com/mail/mu/mp/217/#tl/priority/%5Esmartlabel_personal")

